// 职责：vault 接入生命周期——打开/恢复 vault、配置文件夹编排、扫描+解析+建索引管线。
// 这是把磁盘上的 vault「装进」store 的编排层，写操作（CRUD）见 fileActions.ts。
import { produce } from 'solid-js/store'
import { clearEmbedUrlCache } from '../lib/cm6/embedExtension'
import type { FileMeta } from '../stores/types'
import {
  vaultStore,
  setVaultStore,
  setVaultFs,
  setIsIndexing,
} from './store'
import { buildBacklinks } from './indexes/backlinks'
import { buildTags } from './indexes/tags'
import { buildTasks } from './indexes/tasks'
import { buildCalendar } from './indexes/calendar'
import { LocalAdapter } from './fs/LocalAdapter'
import {
  beginLoadProgress,
  endLoadProgress,
  endScanOverlay,
  incDetected,
} from './loadProgress'
import { showToast, updateToast, dismissToast } from '../stores/toastStore'
import {
  loadAllFileStats,
  pruneCache,
  pruneFileStatCache,
} from './indexStorage'
import { isReady, initFileIO } from './fs/io'
import { buildScan, parseAll } from './scan'
import { setFileTree } from './fileTree'
import * as vaultConfig from './vaultConfig'
import { showModal, closeModal } from '../stores/modalStore'

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
