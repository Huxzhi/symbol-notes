// 职责：vault 的写操作编排——所有文件 CRUD 与单文件 reindex 的唯一入口。
// 契约：先落盘（fs/io）→ 再增量更新 store 与各索引 → 必要时改写反链。
// 不要绕过 fileActions 直接 setVaultStore。
import { produce } from 'solid-js/store'
import type { ParseResult } from '../lib/parseMarkdown'
import { parseMarkdown } from '../lib/parseMarkdown'
import type { FileCache, FileEntry } from '../stores/types'
import { buildContentFields, type ContentFields } from '../metadata/parse/fileMeta'
import { vaultStore, setVaultStore } from '../vault/store'
import {
  metadataStore,
  setMetadataStore,
  beginIndexTask,
  endIndexTask,
} from '../metadata/store'
import {
  getFile,
  setFileCache,
  removeFileCache,
  EMPTY_CACHE,
} from '../metadata/cache'
import {
  applyFileBacklinks,
  removeFileBacklinks,
  resolveNewFile,
  invalidateLinkIndexes,
} from '../metadata/indexes/backlinks'
import { deleteFileStatEntry, setFileStatEntry } from '../vault/statCache'
import { getCachedMeta, setCachedMeta } from '../metadata/parsedCache'
import { hashContent } from '../lib/contentHash'
import {
  createDirectory,
  deleteEntry,
  getFileMtime,
  invalidatePrefix,
  isReady,
  readFile,
  writeFile,
} from '../vault/fs/io'
import { applyFileTags, removeFileTags } from '../metadata/indexes/tags'
import { applyFileTasks, removeFileTasks } from '../metadata/indexes/tasks'
import { applyFileCalendar, removeFileCalendar } from '../metadata/indexes/calendar'
import {
  bumpStruct,
  insertNode,
  removeNode,
  renameNode,
  moveNode,
} from '../vault/fileTree'

// ── 单文件 reindex / 删除 / 链接 remap ─────────────────────────────────────────

/** 单文件保存后：解析内容 → 更新 FileMeta → 增量更新三个索引 */
export async function reindexFile(
  path: string,
  content: string,
  cmParsed?: ParseResult,
  persistStat = false,
): Promise<void> {
  beginIndexTask()
  try {
    const hash = hashContent(content)
    const cached = await getCachedMeta(hash)
    let fields: ContentFields
    if (cached && Array.isArray(cached.lists)) {
      fields = cached
    } else {
      const existingMtime = vaultStore.files[path]?.mtime ?? Date.now()
      fields = buildContentFields(content, cmParsed ?? parseMarkdown(content), existingMtime)
      await setCachedMeta(hash, fields)
    }

    const prev = getFile(path) // 合并视图(改前),供索引读旧 outLinks/tags
    setVaultStore('files', path, 'hash', hash) // hash 属 stat
    setFileCache(path, fields) // 解析内容落 metadata
    applyFileBacklinks(
      path,
      (prev?.outLinks ?? []).map((l) => l.target),
      fields.outLinks.map((l) => l.target),
    )
    applyFileTags(path, prev?.tags ?? [], fields.tags)
    applyFileTasks(path, fields.lists)
    applyFileCalendar(path, prev, getFile(path))

    if (persistStat) {
      const entry = vaultStore.files[path]
      if (entry?.kind === 'file')
        await setFileStatEntry(path, {
          size: entry.size,
          mtime: entry.mtime,
          hash,
        })
    }
  } finally {
    endIndexTask()
  }
}

/** 文件删除：从 fileMap、解析内容和所有索引中移除 */
export function removeVaultEntry(path: string): void {
  const file = getFile(path)
  if (!file) return
  removeFileBacklinks(path, file)
  removeFileTags(path, file.tags)
  removeFileTasks(path)
  removeFileCalendar(path, file)
  setVaultStore('files', path, undefined as unknown as FileEntry)
  removeFileCache(path)
  invalidateLinkIndexes()
}

/** 某个文件内的 wiki 链接指向从 oldTarget 重命名为 newTarget */
export function remapFileLink(
  filePath: string,
  oldTarget: string,
  newTarget: string,
): void {
  const content = metadataStore.cache[filePath]
  if (!content) return
  const prevOutLinks = content.outLinks
  const nextOutLinks = prevOutLinks.map((l) =>
    l.target === oldTarget ? { ...l, target: newTarget } : l,
  )
  setMetadataStore('cache', filePath, 'outLinks', nextOutLinks)
  applyFileBacklinks(
    filePath,
    prevOutLinks.map((l) => l.target),
    nextOutLinks.map((l) => l.target),
  )
}

// ── Wiki 链接重写（改名 / 移动时改写指向本文件的反链） ─────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceWikiLinks(
  content: string,
  oldPath: string,
  newPath: string,
): string {
  const oldBase = oldPath.replace(/\.md$/, '')
  const newBase = newPath.replace(/\.md$/, '')
  const oldStem = oldBase.split('/').pop()!
  const newStem = newBase.split('/').pop()!
  const pairs: [string, string][] = []
  if (oldBase !== oldStem) {
    pairs.push([`${oldBase}.md`, `${newBase}.md`])
    pairs.push([oldBase, newBase])
  }
  pairs.push([`${oldStem}.md`, `${newStem}.md`])
  pairs.push([oldStem, newStem])
  let result = content
  for (const [old, next] of pairs) {
    result = result.replace(
      new RegExp(`\\[\\[${escapeRegex(old)}(\\|[^\\]]*)?\\]\\]`, 'g'),
      (_, alias) => `[[${next}${alias ?? ''}]]`,
    )
  }
  return result
}

async function updateBacklinks(
  oldPath: string,
  newPath: string,
): Promise<void> {
  const backlinks = metadataStore.backlinkMap[oldPath] ?? []
  for (const bPath of backlinks) {
    try {
      const content = await readFile(bPath)
      const updated = replaceWikiLinks(content, oldPath, newPath)
      if (updated !== content) {
        await writeFile(bPath, updated)
        remapFileLink(bPath, oldPath, newPath)
      }
    } catch {
      /* skip unreadable files */
    }
  }
}

// ── CRUD 公共小工具 ────────────────────────────────────────────────────────────

const EPOCH = new Date(0).toISOString().slice(0, 10)

/** 新建文件/目录的空 fileMap 条目（仅 stat）。 */
function blankEntry(
  name: string,
  path: string,
  kind: 'file' | 'directory',
  parent: string | null,
): FileEntry {
  return { name, path, kind, parent, size: 0, mtime: 0, hash: '' }
}

/** 新建文件的空解析内容（日期占位为 epoch）。 */
function blankContent(): FileCache {
  return { ...EMPTY_CACHE, created: EPOCH, dated: EPOCH }
}

/** 从 fileMap 与 cache 一次性删掉若干 path（单次响应式更新）。 */
function removeFilesFromStore(paths: string[]): void {
  setVaultStore(
    'files',
    produce((m: Record<string, FileEntry>) => {
      for (const p of paths) delete m[p]
    }),
  )
  setMetadataStore(
    'cache',
    produce((c: Record<string, FileCache>) => {
      for (const p of paths) delete c[p]
    }),
  )
}

/** 把单个文件从 oldPath 搬到 newPath：落盘 → 改 store/树 → reindex → 改写反链。
 *  改名与移动只差「目标路径推导 + 树操作」，其余流程完全一致。 */
async function relocateFile(
  oldPath: string,
  newPath: string,
  parent: string | null,
  applyNode: () => void,
): Promise<void> {
  const oldContent = await readFile(oldPath)
  await writeFile(newPath, oldContent)
  await deleteEntry(oldPath)
  await deleteFileStatEntry(oldPath)
  removeVaultEntry(oldPath)
  removeFilesFromStore([oldPath])
  setVaultStore(
    'files',
    newPath,
    blankEntry(newPath.split('/').pop()!, newPath, 'file', parent),
  )
  setFileCache(newPath, blankContent())
  applyNode()
  bumpStruct()
  invalidateLinkIndexes()
  const { workspaceActions } = await import('../stores/workspaceStore')
  workspaceActions.renameLeafPath(oldPath, newPath)
  await reindexFile(newPath, oldContent)
  await updateBacklinks(oldPath, newPath)
}

// ── File CRUD ─────────────────────────────────────────────────────────────────

export const fileActions = {
  readFile(path: string): Promise<string> {
    return readFile(path)
  },

  async saveFile(
    path: string,
    content: string,
    cmParsed?: ParseResult,
  ): Promise<void> {
    await writeFile(path, content)
    const mtime = await getFileMtime(path)
    setVaultStore('files', path, 'mtime', mtime)
    await reindexFile(path, content, cmParsed, true)
  },

  async createFile(name: string): Promise<string | null> {
    if (!isReady()) return null
    const parts = name.includes('/') ? name.split('/') : [name]
    const fileName = parts.pop()!
    const finalName = fileName.endsWith('.md') ? fileName : `${fileName}.md`
    if (parts.length > 0) await createDirectory(parts.join('/'))
    const path =
      parts.length > 0 ? `${parts.join('/')}/${finalName}` : finalName
    await writeFile(path, '')
    const parent = parts.length > 0 ? parts.join('/') : null
    setVaultStore('files', path, blankEntry(finalName, path, 'file', parent))
    setFileCache(path, blankContent())
    insertNode({ name: finalName, path, kind: 'file', parent })
    bumpStruct()
    applyFileCalendar(path, undefined, getFile(path))
    invalidateLinkIndexes()
    resolveNewFile(path)
    return path
  },

  async createFolder(name: string): Promise<void> {
    if (!isReady()) return
    await createDirectory(name)
    const parts = name.split('/')
    const dirName = parts[parts.length - 1]
    const parent = parts.length > 1 ? parts.slice(0, -1).join('/') : null
    setVaultStore('files', name, blankEntry(dirName, name, 'directory', parent))
    insertNode({ name: dirName, path: name, kind: 'directory', parent, children: [] })
    bumpStruct()
    invalidateLinkIndexes()
  },

  async renameFile(oldPath: string, newName: string): Promise<void> {
    if (!isReady()) return
    const dir = oldPath.includes('/')
      ? oldPath.slice(0, oldPath.lastIndexOf('/'))
      : ''
    const finalName = newName.endsWith('.md') ? newName : `${newName}.md`
    const newPath = dir ? `${dir}/${finalName}` : finalName
    if (newPath !== oldPath && vaultStore.files[newPath])
      throw new Error(`已存在同名文件：${finalName}`)
    await relocateFile(oldPath, newPath, dir || null, () =>
      renameNode(oldPath, finalName),
    )
  },

  async deleteFile(path: string): Promise<void> {
    if (!isReady()) return
    await deleteEntry(path)
    await deleteFileStatEntry(path)
    removeVaultEntry(path)
    removeFilesFromStore([path])
    removeNode(path)
    bumpStruct()
    invalidateLinkIndexes()
  },

  async deleteFolder(path: string): Promise<void> {
    if (!isReady()) return
    const toRemove = Object.values(vaultStore.files).filter(
      (e) => e.path === path || e.path.startsWith(path + '/'),
    )
    await deleteEntry(path, { recursive: true })
    invalidatePrefix(path)
    for (const entry of toRemove) {
      if (entry.kind === 'file') {
        await deleteFileStatEntry(entry.path)
        removeVaultEntry(entry.path)
      }
    }
    removeFilesFromStore(toRemove.map((e) => e.path))
    removeNode(path)
    bumpStruct()
    invalidateLinkIndexes()
  },

  async moveFile(srcPath: string, destDirPath: string | null): Promise<void> {
    if (!isReady()) return
    const name = srcPath.split('/').pop()!
    const newPath = destDirPath ? `${destDirPath}/${name}` : name
    if (newPath === srcPath) return
    if (vaultStore.files[newPath])
      throw new Error(`目标位置已存在同名文件：${name}`)
    await relocateFile(srcPath, newPath, destDirPath ?? null, () =>
      moveNode(srcPath, destDirPath),
    )
  },

  async moveFolder(srcPath: string, destDirPath: string | null): Promise<void> {
    if (!isReady()) return
    const folderName = srcPath.split('/').pop()!
    const newFolderPath = destDirPath
      ? `${destDirPath}/${folderName}`
      : folderName
    if (newFolderPath === srcPath || newFolderPath.startsWith(srcPath + '/'))
      return
    if (vaultStore.files[newFolderPath])
      throw new Error(`目标位置已存在同名文件夹：${folderName}`)
    const descendants = Object.values(vaultStore.files).filter(
      (e) => e.path === srcPath || e.path.startsWith(srcPath + '/'),
    )
    const fileEntries = descendants.filter((e) => e.kind === 'file')
    const dirEntries = descendants.filter((e) => e.kind === 'directory')
    const allNewDirs = [
      newFolderPath,
      ...dirEntries.map((e) => newFolderPath + e.path.slice(srcPath.length)),
    ].sort((a, b) => a.split('/').length - b.split('/').length)
    for (const dirPath of allNewDirs) await createDirectory(dirPath)
    const fileContents = new Map<string, string>()
    for (const entry of fileEntries) {
      const content = await readFile(entry.path)
      fileContents.set(entry.path, content)
      const newFilePath = newFolderPath + entry.path.slice(srcPath.length)
      await writeFile(newFilePath, content)
    }
    await deleteEntry(srcPath, { recursive: true })
    invalidatePrefix(srcPath)
    for (const entry of fileEntries) await deleteFileStatEntry(entry.path)
    for (const entry of fileEntries) removeFileCalendar(entry.path, getFile(entry.path))
    removeFilesFromStore(descendants.map((e) => e.path))
    for (const entry of descendants) {
      const newEntryPath = newFolderPath + entry.path.slice(srcPath.length)
      const newParent = newEntryPath.includes('/')
        ? newEntryPath.slice(0, newEntryPath.lastIndexOf('/'))
        : null
      setVaultStore('files', newEntryPath, {
        ...entry,
        path: newEntryPath,
        parent: newParent,
        hash: '',
      })
    }
    moveNode(srcPath, destDirPath)
    bumpStruct()
    invalidateLinkIndexes()
    const { workspaceActions } = await import('../stores/workspaceStore')
    for (const entry of fileEntries) {
      const newFilePath = newFolderPath + entry.path.slice(srcPath.length)
      const content = fileContents.get(entry.path) ?? ''
      workspaceActions.renameLeafPath(entry.path, newFilePath)
      await reindexFile(newFilePath, content)
      await updateBacklinks(entry.path, newFilePath)
    }
  },

  async moveEntry(srcPath: string, destDirPath: string | null): Promise<void> {
    const entry = vaultStore.files[srcPath]
    if (!entry) return
    if (entry.kind === 'directory') {
      await fileActions.moveFolder(srcPath, destDirPath)
    } else {
      await fileActions.moveFile(srcPath, destDirPath)
    }
  },
}
