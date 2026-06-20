import { createSignal } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import { clearEmbedUrlCache } from '../lib/cm6/embedExtension'
import { parseFrontmatter } from '../lib/parseFrontmatter'
import type { ParseResult } from '../lib/parseMarkdown'
import { parseMarkdown } from '../lib/parseMarkdown'
import type { FileMeta, VaultState } from '../stores/types'
import {
  applyFileBacklinks,
  buildAliasIndex,
  buildBacklinks,
  buildStemIndex,
  removeFileBacklinks,
  resolveNewFile,
} from './backlinks'
import { LocalAdapter } from './fs/LocalAdapter'
import type { FileSystemAdapter } from './fs/types'
import {
  beginLoadProgress,
  endLoadProgress,
  endScanOverlay,
  incDetected,
} from './loadProgress'
import { showToast, updateToast, dismissToast } from '../stores/toastStore'
import {
  deleteFileStatEntry,
  getCachedMeta,
  hashContent,
  loadAllFileStats,
  pruneCache,
  pruneFileStatCache,
  setCachedMeta,
  setFileStatEntry,
} from './indexStorage'
import {
  createDirectory,
  deleteEntry,
  getFileMtime,
  initFileIO,
  invalidatePrefix,
  isReady,
  readFile,
  writeFile,
} from './io'
import {
  buildScan,
  extractAliases,
  extractDateString,
  extractTags,
  mergeTagsWithBody,
  parseAll,
  resolveDatedField,
} from './scan'
import { applyFileTags, buildTags, removeFileTags } from './tags'
import { applyFileTasks, buildTasks, removeFileTasks } from './tasks'
import { applyFileCalendar, buildCalendar, removeFileCalendar } from './calendarIndex'
import {
  setFileTree, bumpStruct,
  insertNode, removeNode, renameNode, moveNode,
} from './fileTree'
import * as vaultConfig from './vaultConfig'
import { showModal, closeModal } from '../stores/modalStore'

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
  calendarByDate: {},
})

export { setVaultStore, vaultStore }

// ── Stem index (lazy cache) ───────────────────────────────────────────────────

let _stemIndex: Map<string, string[]> | null = null
let _aliasIndex: Map<string, string[]> | null = null

export function invalidateStemIndex(): void {
  _stemIndex = null
  _aliasIndex = null
}

export function getStemIndex(): Map<string, string[]> {
  if (!_stemIndex) _stemIndex = buildStemIndex(vaultStore.files)
  return _stemIndex
}

export function getAliasIndex(): Map<string, string[]> {
  if (!_aliasIndex) _aliasIndex = buildAliasIndex(vaultStore.files)
  return _aliasIndex
}

// ── Scan status ───────────────────────────────────────────────────────────────

export const [isIndexing, setIsIndexing] = createSignal(false)

// ── Connection ────────────────────────────────────────────────────────────────

export async function openVault(): Promise<void> {
  clearEmbedUrlCache()
  const adapter = await LocalAdapter.open()
  initFileIO(adapter)
  setVaultFs(adapter)
  vaultConfig.setAdapter(adapter)
  await vaultConfig.resetMeta() // 新 vault → unknown + 默认路径
  const { workspaceActions } = await import('../stores/workspaceStore')
  workspaceActions.clearAllLeaves()
  const mid = await scanPhase1()
  if (!mid) return
  await connectVaultConfig(mid.session) // 读配置 + hydrate，并按状态揭开遮罩
  await parseAndIndex(mid)
}

export async function restoreVault(): Promise<void> {
  const adapter = await LocalAdapter.restore()
  if (!adapter) return
  initFileIO(adapter)
  setVaultFs(adapter)
  vaultConfig.setAdapter(adapter)
  await vaultConfig.loadMeta()
  const mid = await scanPhase1()
  if (!mid) return
  await connectVaultConfig(mid.session)
  await parseAndIndex(mid)
}

// ── Vault 配置编排 ─────────────────────────────────────────────────────────────

/** 读两份配置注入 store；任一缺失则跳过那份（保持默认）。 */
async function hydrateVaultConfig(): Promise<void> {
  const { workspace, settings } = await vaultConfig.readConfigFiles()
  if (!workspace && !settings) return
  const { hydrateWorkspace } = await import('../stores/workspaceStore')
  const { hydrateSettings } = await import('../stores/settingsStore')
  if (workspace) hydrateWorkspace(workspace)
  if (settings) hydrateSettings(settings)
}

/** 取当前 store 状态作为创建配置文件夹的种子（主题/非主题分开）。 */
async function snapshotStores(): Promise<{
  ws: import('../stores/types').WorkspaceState
  settings: import('../stores/types').VaultSettings
  theme: import('../stores/types').ThemeSettings
}> {
  const { workspaceStore } = await import('../stores/workspaceStore')
  const { settingsStore } = await import('../stores/settingsStore')
  return {
    ws: {
      layouts: workspaceStore.layouts,
      activeLayoutId: workspaceStore.activeLayoutId,
    },
    settings: {
      pluginStates: settingsStore.pluginStates,
      autoTimestamps: settingsStore.autoTimestamps,
      showOtherFiles: settingsStore.showOtherFiles,
    },
    theme: {
      theme: settingsStore.theme,
      customThemes: settingsStore.customThemes,
      customCSS: settingsStore.customCSS,
    },
  }
}

/** 用当前 store 状态创建配置文件夹。 */
async function createVaultConfigFromStores(): Promise<void> {
  const { ws, settings, theme } = await snapshotStores()
  await vaultConfig.createConfigFolder(ws, settings, theme)
}

/** 弹窗询问是否创建配置文件夹。 */
function promptCreateVaultConfig(): void {
  showModal({
    title: '配置文件夹',
    message: `在此 vault 顶层创建 ${vaultConfig.configPath()}/ 用于保存布局与设置？`,
    buttons: [
      {
        label: '不创建',
        variant: 'ghost',
        onClick: () => {
          closeModal()
          void vaultConfig.decline()
        },
      },
      {
        label: '创建',
        variant: 'primary',
        onClick: () => {
          closeModal()
          void createVaultConfigFromStores()
        },
      },
    ],
  })
}

/** 扫描后接入配置并决定揭开遮罩的时机：
 *  active / unknown+exists → 先 hydrate 再 reveal；
 *  declined / unknown 无配置 → 先 reveal 再走原逻辑（不卡在弹窗前）。 */
async function connectVaultConfig(session: Session): Promise<void> {
  const status = vaultConfig.metaStatus()
  if (status === 'declined') {
    endScanOverlay(session)
    return
  }
  if (status === 'active') {
    await hydrateVaultConfig()
    endScanOverlay(session)
    return
  }
  // unknown
  if (await vaultConfig.configFolderExists()) {
    await vaultConfig.markActive()
    await hydrateVaultConfig()
    endScanOverlay(session)
    return
  }
  endScanOverlay(session)
  promptCreateVaultConfig()
}

// ── Orchestration ─────────────────────────────────────────────────────────────

interface Session {
  cancelled: boolean
}
let currentSession: Session | null = null

export interface ScanMid {
  session: Session
  mdUnchanged: string[]
  mdChanged: string[]
  activePaths: Set<string>
}

/** Phase1（reveal 前，串行）：扫描 → 填仅含 stat 的 FileMeta → 建树。不撤遮罩。 */
export async function scanPhase1(): Promise<ScanMid | null> {
  if (currentSession) currentSession.cancelled = true
  const session: Session = { cancelled: false }
  currentSession = session

  if (!isReady()) return null
  setIsIndexing(true)
  beginLoadProgress(session)

  const [{ files, activePaths, tree }, idbStats] = await Promise.all([
    buildScan(incDetected),
    loadAllFileStats(),
  ])

  if (session.cancelled) return null

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

  // 阶段 1：仅 stat 的 FileMeta 入 store + 建树（撤遮挡交给调用方，在 hydrate 后）
  setVaultStore('files', files)
  setFileTree(tree)
  return { session, mdUnchanged, mdChanged, activePaths }
}

/** Phase2/3（reveal 后，后台）：解析 → 合并完整 FileMeta → 建跨文件索引。 */
export async function parseAndIndex(mid: ScanMid): Promise<void> {
  const { session, mdUnchanged, mdChanged, activePaths } = mid
  try {
    // 阶段 2：后台解析（不写 store），右上角 toast 进度
    const total = mdUnchanged.length + mdChanged.length
    const toastId =
      total > 0
        ? showToast(`解析 0 / ${total}（双链/任务暂不完整）`, { requireClick: true })
        : -1
    let done = 0
    const activeHashes = new Set<string>()
    const results = await parseAll(
      session,
      mdUnchanged,
      mdChanged,
      activeHashes,
      () => {
        done++
        if (toastId >= 0 && (done === total || done % 20 === 0)) {
          updateToast(toastId, `解析 ${done} / ${total}（双链/任务暂不完整）`)
        }
      },
    )

    if (session.cancelled) {
      if (toastId >= 0) dismissToast(toastId)
      return
    }

    // 阶段 2.5：一次性就地合并完整 FileMeta（单次响应式更新）
    setVaultStore(
      'files',
      produce((fs: Record<string, FileMeta>) => {
        for (const [path, fields] of results) {
          const f = fs[path]
          if (f) Object.assign(f, fields)
        }
      }),
    )

    // 阶段 3：构建跨文件索引
    const mdFiles = Object.fromEntries(
      Object.entries(vaultStore.files).filter(([p]) => p.endsWith('.md')),
    )
    buildBacklinks(mdFiles)
    buildTags(mdFiles)
    buildTasks(mdFiles)
    buildCalendar(vaultStore.files)
    pruneFileStatCache(activePaths).catch(() => {})
    pruneCache(activeHashes).catch(() => {})

    if (toastId >= 0) {
      dismissToast(toastId)
      showToast('解析完成', { duration: 2000 })
    }
  } finally {
    if (currentSession === session) {
      setIsIndexing(false)
      endLoadProgress(session)
    }
  }
}

/** Back-compat 包装：扫描后立即撤遮罩再后台解析（无配置编排）。 */
export async function scanAndIndex(): Promise<void> {
  const mid = await scanPhase1()
  if (!mid) return
  endScanOverlay(mid.session)
  await parseAndIndex(mid)
}

type ContentFields = Pick<
  FileMeta,
  | 'frontmatter'
  | 'outLinks'
  | 'etags'
  | 'tags'
  | 'aliases'
  | 'created'
  | 'updated'
  | 'dated'
  | 'lists'
>

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
    const { frontmatter } = parseFrontmatter(content)
    const { outLinks, inlineTags, lists } = cmParsed ?? parseMarkdown(content)
    const existingMtime = vaultStore.files[path]?.mtime ?? Date.now()
    const created =
      extractDateString(frontmatter.created) ??
      new Date(existingMtime).toISOString().slice(0, 10)
    const updated = extractDateString(frontmatter.updated) ?? null
    const dated = resolveDatedField(frontmatter.dated, created)
    const fmTags = extractTags(frontmatter.tags)
    fields = {
      frontmatter,
      outLinks,
      etags: [...new Set([...fmTags, ...inlineTags])],
      tags: mergeTagsWithBody(fmTags, inlineTags),
      aliases: extractAliases(frontmatter.aliases),
      created,
      updated,
      dated,
      lists,
    }
    await setCachedMeta(hash, fields)
  }

  const prev = vaultStore.files[path]
  setVaultStore('files', path, (f: FileMeta) => ({ ...f, hash, ...fields }))
  applyFileBacklinks(path, prev?.outLinks ?? [], fields.outLinks)
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
    l === oldTarget ? newTarget : l,
  )
  setVaultStore('files', filePath, 'outLinks', nextOutLinks)
  applyFileBacklinks(filePath, prevOutLinks, nextOutLinks)
}

export { resolveNewFile }

// ── File CRUD helpers ─────────────────────────────────────────────────────────

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

// ── Re-exports ────────────────────────────────────────────────────────────────

export {
  getFile,
  getFileMtime,
  initFileIO,
  invalidateFile,
  isReady,
  readFile,
  writeFile,
} from './io'

// For non-vault consumers (pluginRegistry, EditorViewer, tests)
export { buildLinkMaps, buildStemIndex, buildAliasIndex, resolveLink } from './backlinks'
export { extractDateFromName } from './scan'

// Vault 配置（供设置页）
export { vaultConfigMeta } from './vaultConfig'

export const vaultConfigActions = {
  /** 设置页「启用配置文件夹」：用当前 store 状态创建。 */
  async enable(): Promise<void> {
    await createVaultConfigFromStores()
  },
  /** 设置页改相对路径：迁移并写到新路径。 */
  async setPath(path: string): Promise<void> {
    const { ws, settings, theme } = await snapshotStores()
    await vaultConfig.migratePath(path, ws, settings, theme)
  },
}
