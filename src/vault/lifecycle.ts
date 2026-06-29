// 职责：vault 接入生命周期——打开/恢复 vault、配置文件夹编排、扫描+补 stat+置就绪信号。
// 解析/建索引不在此：由 metadata/derive 订阅 scanReady 自行派生（派生优先，vault 不依赖 metadata）。
// 这是把磁盘上的 vault「装进」store 的编排层，写操作（CRUD）见 fileActions.ts。
import { produce } from 'solid-js/store'
import { clearEmbedUrlCache } from '../lib/cm6/embedExtension'
import type { FileEntry } from '../stores/types'
import { markScanReady, setVaultFs, setVaultStore } from './store'
import { beginIndexTask, endIndexTask } from '../metadata/store'
import { LocalAdapter } from './fs/LocalAdapter'
import { ui } from '../stores/ui'
import { initFileIO, isReady, statFiles } from './fs/io'
import { buildScan } from './scan'
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
  await statAndSignal(mid)
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
  await statAndSignal(mid)
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
 *  size/mtime 补 stat 见 statAndSignal；变更检测与解析下放到 metadata/derive.buildAll。 */
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

/** Phase2（reveal 后，后台）：补 stat 回填 fileMap → 置就绪信号。
 *  解析 / 建索引已下放到 metadata/derive.buildAll（订阅 scanReady 触发，派生优先）。
 *  进度任务：scanPhase1 开启的任务在此关闭；markScanReady 同步触发 buildAll 自己的任务，
 *  两段衔接无空窗，启动遮罩不闪。 */
export async function statAndSignal(mid: ScanMid): Promise<void> {
  const { session, activePaths } = mid
  let ok = false
  try {
    const stats = await statFiles([...activePaths])
    if (session.cancelled) return
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
      }),
    )
    ok = true
  } finally {
    endIndexTask()
  }
  if (ok) markScanReady()
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
