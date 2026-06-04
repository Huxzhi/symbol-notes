import { createSignal } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import type { FileSystemAdapter } from '../services/fs/types'
import { parseFrontmatter } from '../lib/parseFrontmatter'
import { parseMarkdown } from '../lib/parseMarkdown'
import type { ParseResult } from '../lib/parseMarkdown'
import {
  hashContent, getCachedMeta, setCachedMeta, setFileStatEntry,
  loadAllFileStats, pruneCache, pruneFileStatCache, deleteFileStatEntry,
} from '../services/indexStorage'
import {
  extractTags, extractAliases, mergeTagsWithBody, extractDateString, buildStemIndex,
} from '../lib/knowledgeUtils'
import type { VaultState, FileMeta, TaskItem } from '../stores/types'
import { clearEmbedUrlCache } from '../lib/cm6/embedExtension'
import { LocalAdapter } from '../services/fs/LocalAdapter'
import { buildScan, runPhase1 } from './scan'
import { buildBacklinks, applyFileBacklinks, removeFileBacklinks, resolveNewFile } from './backlinks'
import { buildTags, applyFileTags, removeFileTags } from './tags'
import { buildTasks, applyFileTasks, removeFileTasks } from './tasks'
import {
  initFileIO, isReady,
  readFile, writeFile, getFileMtime,
  deleteEntry, invalidatePrefix, createDirectory, invalidateFile,
} from './io'

// ── Vault connection signal ───────────────────────────────────────────────────

const [_vaultFs, setVaultFs] = createSignal<FileSystemAdapter | null>(null)
export const vaultFs = _vaultFs
export { setVaultFs }

// ── Reactive state ────────────────────────────────────────────────────────────

const [vaultStore, setVaultStore] = createStore<VaultState>({
  files: {},
  backlinkMap: {},
  unresolvedMap: {},
  tagMap: {},
  taskMap: {},
})

export { vaultStore, setVaultStore }

// ── Stem index (lazy cache) ───────────────────────────────────────────────────

let _stemIndex: Map<string, string[]> | null = null

export function invalidateStemIndex(): void {
  _stemIndex = null
}

export function getStemIndex(): Map<string, string[]> {
  if (!_stemIndex) _stemIndex = buildStemIndex(vaultStore.files)
  return _stemIndex
}

// ── Scan status ───────────────────────────────────────────────────────────────

export const [isIndexing, setIsIndexing] = createSignal(false)

// ── Connection ────────────────────────────────────────────────────────────────

export async function openVault(): Promise<void> {
  clearEmbedUrlCache()
  const adapter = await LocalAdapter.open()
  initFileIO(adapter)
  setVaultFs(adapter)
  const { workspaceActions } = await import('../stores/workspaceStore')
  workspaceActions.clearAllLeaves()
  await scanAndIndex()
}

export async function restoreVault(): Promise<void> {
  const adapter = await LocalAdapter.restore()
  if (!adapter) return
  initFileIO(adapter)
  setVaultFs(adapter)
  await scanAndIndex()
}

// ── Orchestration ─────────────────────────────────────────────────────────────

interface Session { cancelled: boolean }
let currentSession: Session | null = null

/** 打开 vault 后全量扫描：Phase1 填充 FileMeta → Phase2 重建三个索引 */
export async function scanAndIndex(): Promise<void> {
  if (currentSession) currentSession.cancelled = true
  const session: Session = { cancelled: false }
  currentSession = session

  if (!isReady()) return
  setIsIndexing(true)

  const [{ files, activePaths }, idbStats] = await Promise.all([
    buildScan(),
    loadAllFileStats(),
  ])

  if (session.cancelled) return

  const MAX_PARSE_BYTES = 20 * 1024 * 1024
  const mdUnchanged: string[] = []
  const mdChanged: string[] = []

  for (const [path, file] of Object.entries(files)) {
    if (file.kind !== 'file' || !path.endsWith('.md')) continue
    if (file.size > MAX_PARSE_BYTES) continue
    const stat = idbStats.get(path)
    if (stat && stat.size === file.size && stat.mtime === file.mtime) {
      files[path] = { ...file, hash: stat.hash }
      mdUnchanged.push(path)
    } else {
      mdChanged.push(path)
    }
  }

  setVaultStore('files', files)

  const activeHashes = new Set<string>()
  await runPhase1(session, mdUnchanged, mdChanged, activeHashes)

  if (!session.cancelled) {
    const mdFiles = Object.fromEntries(
      Object.entries(vaultStore.files).filter(([p]) => p.endsWith('.md')),
    )
    buildBacklinks(mdFiles)
    buildTags(mdFiles)
    buildTasks(mdFiles)
    pruneFileStatCache(activePaths).catch(() => {})
    pruneCache(activeHashes).catch(() => {})
  }

  if (currentSession === session) setIsIndexing(false)
}

type ContentFields = Pick<FileMeta, 'frontmatter' | 'outLinks' | 'tags' | 'aliases' | 'created' | 'updated' | 'dated' | 'tasks'>

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
  if (cached) {
    fields = cached
  } else {
    const { frontmatter } = parseFrontmatter(content)
    const { outLinks, inlineTags, tasks: rawTasks } = cmParsed ?? parseMarkdown(content)
    const existingMtime = vaultStore.files[path]?.mtime ?? Date.now()
    const created = extractDateString(frontmatter.created)
                 ?? new Date(existingMtime).toISOString().slice(0, 10)
    const updated = extractDateString(frontmatter.updated) ?? null
    const dated = extractDateString(frontmatter.dated) ?? created
    const tasks: TaskItem[] = rawTasks.map(t => ({
      ...t,
      dueDate: t.dueDate ?? dated,
      completedDate: t.checked ? (t.completedDate ?? dated) : null,
    }))
    fields = {
      frontmatter,
      outLinks,
      tags: mergeTagsWithBody(extractTags(frontmatter.tags), inlineTags),
      aliases: extractAliases(frontmatter.aliases),
      created, updated, dated, tasks,
    }
    await setCachedMeta(hash, fields)
  }

  const prev = vaultStore.files[path]
  setVaultStore('files', path, (f: FileMeta) => ({ ...f, hash, ...fields }))
  applyFileBacklinks(path, prev?.outLinks ?? [], fields.outLinks)
  applyFileTags(path, prev?.tags ?? [], fields.tags)
  applyFileTasks(path, fields.tasks)

  if (persistStat) {
    const entry = vaultStore.files[path]
    if (entry?.kind === 'file')
      await setFileStatEntry(path, { size: entry.size, mtime: entry.mtime, hash })
  }
}

/** 文件删除：从 FileMeta 和所有索引中移除 */
export function removeVaultEntry(path: string): void {
  const file = vaultStore.files[path]
  if (!file) return
  removeFileBacklinks(path, file)
  removeFileTags(path, file.tags)
  removeFileTasks(path)
  setVaultStore('files', path, undefined as unknown as FileMeta)
  invalidateStemIndex()
}

/** 某个文件内的 wiki 链接指向从 oldTarget 重命名为 newTarget */
export function remapFileLink(filePath: string, oldTarget: string, newTarget: string): void {
  const file = vaultStore.files[filePath]
  if (!file) return
  const prevOutLinks = file.outLinks
  const nextOutLinks = prevOutLinks.map(l => l === oldTarget ? newTarget : l)
  setVaultStore('files', filePath, 'outLinks', nextOutLinks)
  applyFileBacklinks(filePath, prevOutLinks, nextOutLinks)
}

export { resolveNewFile }

// ── File CRUD helpers ─────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceWikiLinks(content: string, oldPath: string, newPath: string): string {
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

async function updateBacklinks(oldPath: string, newPath: string): Promise<void> {
  const backlinks = vaultStore.backlinkMap[oldPath] ?? []
  for (const bPath of backlinks) {
    try {
      const content = await readFile(bPath)
      const updated = replaceWikiLinks(content, oldPath, newPath)
      if (updated !== content) {
        await writeFile(bPath, updated)
        remapFileLink(bPath, oldPath, newPath)
      }
    } catch { /* skip unreadable files */ }
  }
}

// ── File CRUD ─────────────────────────────────────────────────────────────────

export const fileActions = {
  readFile(path: string): Promise<string> {
    return readFile(path)
  },

  async saveFile(path: string, content: string, cmParsed?: ParseResult): Promise<void> {
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
    const path = parts.length > 0 ? `${parts.join('/')}/${finalName}` : finalName
    await writeFile(path, '')
    const parent = parts.length > 0 ? parts.join('/') : null
    const entry: FileMeta = {
      name: finalName, path, kind: 'file', parent,
      size: 0, mtime: 0, hash: '', frontmatter: {}, outLinks: [], tags: [], aliases: [],
      created: new Date(0).toISOString().slice(0, 10),
      updated: null, dated: new Date(0).toISOString().slice(0, 10), tasks: [],
    }
    setVaultStore('files', path, entry)
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
      name: dirName, path: name, kind: 'directory', parent,
      size: 0, mtime: 0, hash: '', frontmatter: {}, outLinks: [], tags: [], aliases: [],
      created: new Date(0).toISOString().slice(0, 10),
      updated: null, dated: new Date(0).toISOString().slice(0, 10), tasks: [],
    }
    setVaultStore('files', name, entry)
    invalidateStemIndex()
  },

  async renameFile(oldPath: string, newName: string): Promise<void> {
    if (!isReady()) return
    const dir = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : ''
    const finalName = newName.endsWith('.md') ? newName : `${newName}.md`
    const newPath = dir ? `${dir}/${finalName}` : finalName
    if (newPath !== oldPath && vaultStore.files[newPath])
      throw new Error(`已存在同名文件：${finalName}`)
    const oldContent = await readFile(oldPath)
    await writeFile(newPath, oldContent)
    await deleteEntry(oldPath)
    await deleteFileStatEntry(oldPath)
    removeVaultEntry(oldPath)
    setVaultStore('files', produce((m: Record<string, FileMeta>) => { delete m[oldPath] }))
    const parent = dir || null
    const entry: FileMeta = {
      name: finalName, path: newPath, kind: 'file', parent,
      size: 0, mtime: 0, hash: '', frontmatter: {}, outLinks: [], tags: [], aliases: [],
      created: new Date(0).toISOString().slice(0, 10),
      updated: null, dated: new Date(0).toISOString().slice(0, 10), tasks: [],
    }
    setVaultStore('files', newPath, entry)
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
    setVaultStore('files', produce((m: Record<string, FileMeta>) => { delete m[path] }))
    invalidateStemIndex()
  },

  async deleteFolder(path: string): Promise<void> {
    if (!isReady()) return
    const toRemove = Object.values(vaultStore.files).filter(
      e => e.path === path || e.path.startsWith(path + '/'),
    )
    await deleteEntry(path, { recursive: true })
    invalidatePrefix(path)
    for (const entry of toRemove) {
      if (entry.kind === 'file') {
        await deleteFileStatEntry(entry.path)
        removeVaultEntry(entry.path)
      }
    }
    setVaultStore('files', produce((m: Record<string, FileMeta>) => {
      for (const entry of toRemove) delete m[entry.path]
    }))
    invalidateStemIndex()
  },

  async moveFile(srcPath: string, destDirPath: string | null): Promise<void> {
    if (!isReady()) return
    const name = srcPath.split('/').pop()!
    const newPath = destDirPath ? `${destDirPath}/${name}` : name
    if (newPath === srcPath) return
    if (vaultStore.files[newPath]) throw new Error(`目标位置已存在同名文件：${name}`)
    const oldContent = await readFile(srcPath)
    await writeFile(newPath, oldContent)
    await deleteEntry(srcPath)
    await deleteFileStatEntry(srcPath)
    removeVaultEntry(srcPath)
    setVaultStore('files', produce((m: Record<string, FileMeta>) => { delete m[srcPath] }))
    const entry: FileMeta = {
      name, path: newPath, kind: 'file', parent: destDirPath ?? null,
      size: 0, mtime: 0, hash: '', frontmatter: {}, outLinks: [], tags: [], aliases: [],
      created: new Date(0).toISOString().slice(0, 10),
      updated: null, dated: new Date(0).toISOString().slice(0, 10), tasks: [],
    }
    setVaultStore('files', newPath, entry)
    invalidateStemIndex()
    const { workspaceActions } = await import('../stores/workspaceStore')
    workspaceActions.renameLeafPath(srcPath, newPath)
    await reindexFile(newPath, oldContent)
    await updateBacklinks(srcPath, newPath)
  },

  async moveFolder(srcPath: string, destDirPath: string | null): Promise<void> {
    if (!isReady()) return
    const folderName = srcPath.split('/').pop()!
    const newFolderPath = destDirPath ? `${destDirPath}/${folderName}` : folderName
    if (newFolderPath === srcPath || newFolderPath.startsWith(srcPath + '/')) return
    if (vaultStore.files[newFolderPath]) throw new Error(`目标位置已存在同名文件夹：${folderName}`)
    const descendants = Object.values(vaultStore.files).filter(
      e => e.path === srcPath || e.path.startsWith(srcPath + '/'),
    )
    const fileEntries = descendants.filter(e => e.kind === 'file')
    const dirEntries = descendants.filter(e => e.kind === 'directory')
    const allNewDirs = [newFolderPath, ...dirEntries.map(
      e => newFolderPath + e.path.slice(srcPath.length),
    )].sort((a, b) => a.split('/').length - b.split('/').length)
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
    setVaultStore('files', produce((m: Record<string, FileMeta>) => {
      for (const entry of descendants) delete m[entry.path]
    }))
    for (const entry of descendants) {
      const newEntryPath = newFolderPath + entry.path.slice(srcPath.length)
      const newParent = newEntryPath.includes('/')
        ? newEntryPath.slice(0, newEntryPath.lastIndexOf('/'))
        : null
      setVaultStore('files', newEntryPath, { ...entry, path: newEntryPath, parent: newParent, hash: '' })
    }
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

// ── IO re-exports ─────────────────────────────────────────────────────────────

export { initFileIO, isReady, readFile, writeFile, getFileMtime, invalidateFile, getFile } from './io'
