// 职责：vault 的写操作编排——所有文件 CRUD 与单文件 reindex 的唯一入口。
// 契约：先落盘（fs/io）→ 再增量更新 store 与各索引 → 必要时改写反链。
// 不要绕过 fileActions 直接 setVaultStore。
import { produce } from 'solid-js/store'
import type { ParseResult } from '../lib/parseMarkdown'
import { parseMarkdown } from '../lib/parseMarkdown'
import type { FileMeta } from '../stores/types'
import { buildContentFields, type ContentFields } from './parse/fileMeta'
import { vaultStore, setVaultStore } from './store'
import {
  applyFileBacklinks,
  removeFileBacklinks,
  resolveNewFile,
  invalidateStemIndex,
} from './indexes/backlinks'
import {
  deleteFileStatEntry,
  getCachedMeta,
  hashContent,
  setCachedMeta,
  setFileStatEntry,
} from './indexStorage'
import {
  createDirectory,
  deleteEntry,
  getFileMtime,
  invalidatePrefix,
  isReady,
  readFile,
  writeFile,
} from './fs/io'
import { applyFileTags, removeFileTags } from './indexes/tags'
import { applyFileTasks, removeFileTasks } from './indexes/tasks'
import { applyFileCalendar, removeFileCalendar } from './indexes/calendar'
import {
  bumpStruct,
  insertNode,
  removeNode,
  renameNode,
  moveNode,
} from './fileTree'

// ── 单文件 reindex / 删除 / 链接 remap ─────────────────────────────────────────

/** 单文件保存后：解析内容 → 更新 FileMeta → 增量更新三个索引 */
export async function reindexFile(
  path: string,
  content: string,
  cmParsed?: ParseResult,
  persistStat = false,
): Promise<void> {
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

  const prev = vaultStore.files[path]
  setVaultStore('files', path, (f: FileMeta) => ({ ...f, hash, ...fields }))
  applyFileBacklinks(
    path,
    (prev?.outLinks ?? []).map((l) => l.target),
    fields.outLinks.map((l) => l.target),
  )
  applyFileTags(path, prev?.tags ?? [], fields.tags)
  applyFileTasks(path, fields.lists)
  applyFileCalendar(path, prev, vaultStore.files[path])

  if (persistStat) {
    const entry = vaultStore.files[path]
    if (entry?.kind === 'file')
      await setFileStatEntry(path, {
        size: entry.size,
        mtime: entry.mtime,
        hash,
      })
  }
}

/** 文件删除：从 FileMeta 和所有索引中移除 */
export function removeVaultEntry(path: string): void {
  const file = vaultStore.files[path]
  if (!file) return
  removeFileBacklinks(path, file)
  removeFileTags(path, file.tags)
  removeFileTasks(path)
  removeFileCalendar(path, file)
  setVaultStore('files', path, undefined as unknown as FileMeta)
  invalidateStemIndex()
}

/** 某个文件内的 wiki 链接指向从 oldTarget 重命名为 newTarget */
export function remapFileLink(
  filePath: string,
  oldTarget: string,
  newTarget: string,
): void {
  const file = vaultStore.files[filePath]
  if (!file) return
  const prevOutLinks = file.outLinks
  const nextOutLinks = prevOutLinks.map((l) =>
    l.target === oldTarget ? { ...l, target: newTarget } : l,
  )
  setVaultStore('files', filePath, 'outLinks', nextOutLinks)
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
  const backlinks = vaultStore.backlinkMap[oldPath] ?? []
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
    const entry: FileMeta = {
      name: finalName,
      path,
      kind: 'file',
      parent,
      size: 0,
      mtime: 0,
      hash: '',
      frontmatter: {},
      outLinks: [],
      etags: [],
      tags: [],
      aliases: [],
      created: new Date(0).toISOString().slice(0, 10),
      updated: null,
      dated: new Date(0).toISOString().slice(0, 10),
      lists: [],
    }
    setVaultStore('files', path, entry)
    insertNode({ name: finalName, path, kind: 'file', parent })
    bumpStruct()
    applyFileCalendar(path, undefined, entry)
    invalidateStemIndex()
    resolveNewFile(path)
    return path
  },

  async createFolder(name: string): Promise<void> {
    if (!isReady()) return
    await createDirectory(name)
    const parts = name.split('/')
    const dirName = parts[parts.length - 1]
    const parent = parts.length > 1 ? parts.slice(0, -1).join('/') : null
    const entry: FileMeta = {
      name: dirName,
      path: name,
      kind: 'directory',
      parent,
      size: 0,
      mtime: 0,
      hash: '',
      frontmatter: {},
      outLinks: [],
      etags: [],
      tags: [],
      aliases: [],
      created: new Date(0).toISOString().slice(0, 10),
      updated: null,
      dated: new Date(0).toISOString().slice(0, 10),
      lists: [],
    }
    setVaultStore('files', name, entry)
    insertNode({ name: dirName, path: name, kind: 'directory', parent, children: [] })
    bumpStruct()
    invalidateStemIndex()
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
    const oldContent = await readFile(oldPath)
    await writeFile(newPath, oldContent)
    await deleteEntry(oldPath)
    await deleteFileStatEntry(oldPath)
    removeVaultEntry(oldPath)
    setVaultStore(
      'files',
      produce((m: Record<string, FileMeta>) => {
        delete m[oldPath]
      }),
    )
    const parent = dir || null
    const entry: FileMeta = {
      name: finalName,
      path: newPath,
      kind: 'file',
      parent,
      size: 0,
      mtime: 0,
      hash: '',
      frontmatter: {},
      outLinks: [],
      etags: [],
      tags: [],
      aliases: [],
      created: new Date(0).toISOString().slice(0, 10),
      updated: null,
      dated: new Date(0).toISOString().slice(0, 10),
      lists: [],
    }
    setVaultStore('files', newPath, entry)
    renameNode(oldPath, finalName)
    bumpStruct()
    invalidateStemIndex()
    const { workspaceActions } = await import('../stores/workspaceStore')
    workspaceActions.renameLeafPath(oldPath, newPath)
    await reindexFile(newPath, oldContent)
    await updateBacklinks(oldPath, newPath)
  },

  async deleteFile(path: string): Promise<void> {
    if (!isReady()) return
    await deleteEntry(path)
    await deleteFileStatEntry(path)
    removeVaultEntry(path)
    setVaultStore(
      'files',
      produce((m: Record<string, FileMeta>) => {
        delete m[path]
      }),
    )
    removeNode(path)
    bumpStruct()
    invalidateStemIndex()
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
    setVaultStore(
      'files',
      produce((m: Record<string, FileMeta>) => {
        for (const entry of toRemove) delete m[entry.path]
      }),
    )
    removeNode(path)
    bumpStruct()
    invalidateStemIndex()
  },

  async moveFile(srcPath: string, destDirPath: string | null): Promise<void> {
    if (!isReady()) return
    const name = srcPath.split('/').pop()!
    const newPath = destDirPath ? `${destDirPath}/${name}` : name
    if (newPath === srcPath) return
    if (vaultStore.files[newPath])
      throw new Error(`目标位置已存在同名文件：${name}`)
    const oldContent = await readFile(srcPath)
    await writeFile(newPath, oldContent)
    await deleteEntry(srcPath)
    await deleteFileStatEntry(srcPath)
    removeVaultEntry(srcPath)
    setVaultStore(
      'files',
      produce((m: Record<string, FileMeta>) => {
        delete m[srcPath]
      }),
    )
    const entry: FileMeta = {
      name,
      path: newPath,
      kind: 'file',
      parent: destDirPath ?? null,
      size: 0,
      mtime: 0,
      hash: '',
      frontmatter: {},
      outLinks: [],
      etags: [],
      tags: [],
      aliases: [],
      created: new Date(0).toISOString().slice(0, 10),
      updated: null,
      dated: new Date(0).toISOString().slice(0, 10),
      lists: [],
    }
    setVaultStore('files', newPath, entry)
    moveNode(srcPath, destDirPath)
    bumpStruct()
    invalidateStemIndex()
    const { workspaceActions } = await import('../stores/workspaceStore')
    workspaceActions.renameLeafPath(srcPath, newPath)
    await reindexFile(newPath, oldContent)
    await updateBacklinks(srcPath, newPath)
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
    for (const entry of fileEntries) removeFileCalendar(entry.path, entry)
    setVaultStore(
      'files',
      produce((m: Record<string, FileMeta>) => {
        for (const entry of descendants) delete m[entry.path]
      }),
    )
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
    invalidateStemIndex()
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
