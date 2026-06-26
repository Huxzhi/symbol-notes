// 职责：vault 接入生命周期——打开/恢复 vault、配置文件夹编排、扫描+解析+建索引管线。
// 这是把磁盘上的 vault「装进」store 的编排层，写操作（CRUD）见 fileActions.ts。
import { produce } from 'solid-js/store'
import { clearEmbedUrlCache } from '../lib/cm6/embedExtension'
import type { FileCache, FileEntry } from '../stores/types'
import {
  vaultStore,
  setVaultStore,
  setVaultFs,
} from './store'
import {
  setMetadataStore,
  beginIndexTask,
  endIndexTask,
  markInitialized,
} from '../metadata/store'
import { seedCache, allFiles, EMPTY_CACHE } from '../metadata/cache'
import { buildBacklinks } from '../metadata/indexes/backlinks'
import { buildTags } from '../metadata/indexes/tags'
import { buildTasks } from '../metadata/indexes/tasks'
import { buildCalendar } from '../metadata/indexes/calendar'
import { LocalAdapter } from './fs/LocalAdapter'
import { ui } from '../stores/ui'
import { loadAllFileStats, pruneFileStatCache } from './statCache'
import { pruneCache } from '../metadata/parsedCache'
import { isReady, initFileIO, statFiles } from './fs/io'
import { buildScan } from './scan'
import { parseAll } from '../metadata/parse/parseAll'
import { setFileTree } from './fileTree'
import * as vaultConfig from './vaultConfig'

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
  await connectVaultConfig() // 读配置 + hydrate
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
  await connectVaultConfig()
  await parseAndIndex(mid)
}

// ── Vault 配置编排 ─────────────────────────────────────────────────────────────

/** 读 workspace/settings/theme 注入 store；再并行 hydrate 各插件 data.json。 */
async function hydrateVaultConfig(): Promise<void> {
  const { workspace, settings, theme } = await vaultConfig.readConfigFiles()
  const { hydrateWorkspace } = await import('../stores/workspaceStore')
  const { hydrateSettings, hydrateTheme } = await import('../stores/settingsStore')
  if (workspace) hydrateWorkspace(workspace)
  if (settings) hydrateSettings(settings)
  if (theme) hydrateTheme(theme)
  await hydrateAllPluginData()
}

/** 对所有已注册插件并行读 data.json 并注入内存 store（含未启用插件）。 */
async function hydrateAllPluginData(): Promise<void> {
  const { getRegisteredPlugins } = await import('../lib/pluginRegistry')
  const { hydratePluginData } = await import('../lib/pluginData')
  await Promise.all(
    getRegisteredPlugins().map(async (p) => {
      const data = await vaultConfig.readPluginData(p.id)
      if (data) hydratePluginData(p.id, data)
    }),
  )
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

/** 收集各已注册插件当前内存配置（非空者）作为创建配置文件夹的种子。 */
async function snapshotPluginData(): Promise<Record<string, Record<string, unknown>>> {
  const { getRegisteredPlugins } = await import('../lib/pluginRegistry')
  const { getPluginConfig } = await import('../lib/pluginData')
  const out: Record<string, Record<string, unknown>> = {}
  for (const p of getRegisteredPlugins()) {
    const cfg = getPluginConfig(p.id)
    if (Object.keys(cfg).length > 0) out[p.id] = cfg
  }
  return out
}

/** 用当前 store 状态创建配置文件夹。 */
async function createVaultConfigFromStores(): Promise<void> {
  const { ws, settings, theme } = await snapshotStores()
  const pluginData = await snapshotPluginData()
  await vaultConfig.createConfigFolder(ws, settings, theme, pluginData)
}

/** 弹窗询问是否创建配置文件夹。 */
function promptCreateVaultConfig(): void {
  ui.confirm({
    title: '配置文件夹',
    message: `在此 vault 顶层创建 ${vaultConfig.configPath()}/ 用于保存布局与设置？`,
    buttons: [
      {
        label: '不创建',
        variant: 'ghost',
        onClick: () => {
          ui.closeConfirm()
          void vaultConfig.decline()
        },
      },
      {
        label: '创建',
        variant: 'primary',
        onClick: () => {
          ui.closeConfirm()
          void createVaultConfigFromStores()
        },
      },
    ],
  })
}

/** 扫描后接入配置（读配置 + hydrate）：
 *  active / unknown+exists → hydrate；
 *  declined → 跳过；unknown 无配置 → 弹窗询问是否创建。 */
async function connectVaultConfig(): Promise<void> {
  const status = vaultConfig.metaStatus()
  if (status === 'declined') return
  if (status === 'active') {
    await hydrateVaultConfig()
    return
  }
  // unknown
  if (await vaultConfig.configFolderExists()) {
    await vaultConfig.markActive()
    await hydrateVaultConfig()
    return
  }
  promptCreateVaultConfig()
}

// ── Orchestration ─────────────────────────────────────────────────────────────

interface Session {
  cancelled: boolean
}
let currentSession: Session | null = null

export interface ScanMid {
  session: Session
  activePaths: Set<string>
}

/** Phase1（reveal 前，串行）：只建结构树 → 入 store + 画树。不抓 stat、不撤遮罩。
 *  size/mtime 与变更检测、解析全部下放到 parseAndIndex（reveal 后台），首屏不等 getFile。 */
export async function scanPhase1(): Promise<ScanMid | null> {
  if (currentSession) currentSession.cancelled = true
  const session: Session = { cancelled: false }
  currentSession = session

  if (!isReady()) return null
  beginIndexTask()

  const { entries, activePaths, tree } = await buildScan()
  if (session.cancelled) {
    endIndexTask()
    return null
  }

  // 仅结构的 fileMap（size/mtime=0）入 store + 建树 → 立刻可画
  setVaultStore('files', entries)
  setFileTree(tree)
  return { session, activePaths }
}

/** Phase2/3（reveal 后，后台）：解析 → 合并完整 FileMeta → 建跨文件索引。 */
export async function parseAndIndex(mid: ScanMid): Promise<void> {
  const { session, activePaths } = mid
  try {
    // 阶段 1.5：后台补 stat（复用扫描时缓存的句柄）→ 回填 fileMap + 播种临时内容
    const filePaths = [...activePaths]
    const [stats, idbStats] = await Promise.all([
      statFiles(filePaths),
      loadAllFileStats(),
    ])
    if (session.cancelled) return

    // 变更检测：size/mtime 与 idb stat 缓存一致 → 复用 hash（跳过重解析）
    const MAX_PARSE_BYTES = 20 * 1024 * 1024
    const mdUnchanged: string[] = []
    const mdChanged: string[] = []
    const reuseHash = new Map<string, string>()
    for (const path of filePaths) {
      if (!path.endsWith('.md')) continue
      const s = stats.get(path)
      if (!s || s.size > MAX_PARSE_BYTES) continue
      const cached = idbStats.get(path)
      if (cached && cached.size === s.size && cached.mtime === s.mtime) {
        mdUnchanged.push(path)
        reuseHash.set(path, cached.hash)
      } else {
        mdChanged.push(path)
      }
    }

    setVaultStore(
      'files',
      produce((fs: Record<string, FileEntry>) => {
        for (const [path, s] of stats) {
          const e = fs[path]
          if (e) {
            e.size = s.size
            e.mtime = s.mtime
          }
        }
        for (const [path, hash] of reuseHash) {
          const e = fs[path]
          if (e) e.hash = hash
        }
      }),
    )
    setMetadataStore('cache', seedCache(vaultStore.files))

    // 阶段 2：后台解析（不写 store）。进度走 metadata.inProgressTaskCount。
    const activeHashes = new Set<string>()
    const results = await parseAll(session, mdUnchanged, mdChanged, activeHashes)

    if (session.cancelled) return

    // 阶段 2.5：一次性合并——hash 落 vault.fileMap，解析内容落 metadata.content
    setVaultStore(
      'files',
      produce((fs: Record<string, FileEntry>) => {
        for (const [path, fields] of results) {
          if (fs[path] && fields.hash !== undefined) fs[path].hash = fields.hash
        }
      }),
    )
    setMetadataStore(
      'cache',
      produce((cs: Record<string, FileCache>) => {
        for (const [path, fields] of results) {
          const { hash: _h, ...content } = fields
          cs[path] = { ...EMPTY_CACHE, ...content }
        }
      }),
    )

    // 阶段 3：构建跨文件索引（用合并视图）
    const merged = allFiles()
    const mdFiles = Object.fromEntries(
      Object.entries(merged).filter(([p]) => p.endsWith('.md')),
    )
    buildBacklinks(mdFiles)
    buildTags(mdFiles)
    buildTasks(mdFiles)
    buildCalendar(merged)
    pruneFileStatCache(activePaths).catch(() => {})
    pruneCache(activeHashes).catch(() => {})

    if (currentSession === session) markInitialized()
  } finally {
    endIndexTask()
  }
}

/** Back-compat 包装：扫描后直接后台解析（无配置编排）。 */
export async function scanAndIndex(): Promise<void> {
  const mid = await scanPhase1()
  if (!mid) return
  await parseAndIndex(mid)
}

// ── 配置 actions（供设置页） ────────────────────────────────────────────────────

export const vaultConfigActions = {
  /** 设置页「启用配置文件夹」：用当前 store 状态创建。 */
  async enable(): Promise<void> {
    await createVaultConfigFromStores()
  },
  /** 设置页改相对路径：迁移并写到新路径。 */
  async setPath(path: string): Promise<void> {
    const { ws, settings, theme } = await snapshotStores()
    const pluginData = await snapshotPluginData()
    await vaultConfig.migratePath(path, ws, settings, theme, pluginData)
  },
}
