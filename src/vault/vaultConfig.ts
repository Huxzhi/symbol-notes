// 职责：vault 本地配置（.symbol-notes/）的唯一协调层。
// 配置 IO 经 FileSystemAdapter 直读直写，绕开 io.ts 的 contentCache 与索引层；
// vault 外的 meta（路径 / 是否拒绝）存 IndexedDB。
import { createSignal } from 'solid-js'
import { get, set } from 'idb-keyval'
import type { FileSystemAdapter } from './fs/types'
import type { SettingsState, WorkspaceState } from '../stores/types'

export const DEFAULT_CONFIG_PATH = '.symbol-notes'

const META_KEY = 'sn-vault-config-meta'
const WORKSPACE_FILE = 'workspace.json'
const SETTINGS_FILE = 'settings.json'
const SAVE_DEBOUNCE_MS = 800

export type VaultConfigStatus = 'active' | 'declined' | 'unknown'
export interface VaultConfigMeta {
  path: string
  status: VaultConfigStatus
}

const [meta, setMeta] = createSignal<VaultConfigMeta>({
  path: DEFAULT_CONFIG_PATH,
  status: 'unknown',
})
/** 响应式 meta（供设置页读取状态/路径）。 */
export const vaultConfigMeta = meta

let _adapter: FileSystemAdapter | null = null

export function setAdapter(a: FileSystemAdapter | null): void {
  _adapter = a
}
export function metaStatus(): VaultConfigStatus {
  return meta().status
}
export function configPath(): string {
  return meta().path
}
export function isConfigActive(): boolean {
  return meta().status === 'active' && _adapter !== null
}

// ── 纯函数（可单测） ───────────────────────────────────────────────────────────

/** 把相对 base 与配置文件名拼成 vault 内路径；去掉首尾多余斜杠。 */
export function joinConfigPath(base: string, file: string): string {
  const b = base.replace(/^\/+|\/+$/g, '')
  return b ? `${b}/${file}` : file
}

/** workspace.json 形状校验（与原 sn-workspace 校验一致）。 */
export function validateWorkspace(v: unknown): v is WorkspaceState {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.layouts === 'object' &&
    o.layouts !== null &&
    !Array.isArray(o.layouts) &&
    typeof o.activeLayoutId === 'string'
  )
}

/** settings.json 宽松解析：是非数组对象即返回（按字段与默认值合并由 store 负责）。 */
export function parseSettings(v: unknown): Partial<SettingsState> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  return v as Partial<SettingsState>
}

// ── meta 持久化与状态迁移 ──────────────────────────────────────────────────────

async function persistMeta(): Promise<void> {
  await set(META_KEY, meta())
}

/** restore 路径：从 IndexedDB 读回 meta（非法值回退 unknown/默认路径）。 */
export async function loadMeta(): Promise<void> {
  const m = await get<VaultConfigMeta>(META_KEY)
  if (
    m &&
    typeof m.path === 'string' &&
    (m.status === 'active' || m.status === 'declined' || m.status === 'unknown')
  ) {
    setMeta(m)
  } else {
    setMeta({ path: DEFAULT_CONFIG_PATH, status: 'unknown' })
  }
}

/** open 路径：选了新 vault → 重置为 unknown + 默认路径。 */
export async function resetMeta(): Promise<void> {
  setMeta({ path: DEFAULT_CONFIG_PATH, status: 'unknown' })
  await persistMeta()
}

export async function decline(): Promise<void> {
  setMeta((m) => ({ ...m, status: 'declined' }))
  await persistMeta()
}

export async function markActive(): Promise<void> {
  setMeta((m) => ({ ...m, status: 'active' }))
  await persistMeta()
}

// ── 配置文件读取 ───────────────────────────────────────────────────────────────

/** 探测：settings.json 能读到即认为配置文件夹存在。 */
export async function configFolderExists(): Promise<boolean> {
  if (!_adapter) return false
  try {
    await _adapter.readText(joinConfigPath(meta().path, SETTINGS_FILE))
    return true
  } catch {
    return false
  }
}

/** 读两份配置；缺失或解析失败的那份返回 null（不抛）。 */
export async function readConfigFiles(): Promise<{
  workspace: WorkspaceState | null
  settings: Partial<SettingsState> | null
}> {
  if (!_adapter) return { workspace: null, settings: null }
  const path = meta().path
  let workspace: WorkspaceState | null = null
  let settings: Partial<SettingsState> | null = null
  try {
    const raw = await _adapter.readText(joinConfigPath(path, WORKSPACE_FILE))
    const parsed = JSON.parse(raw) as unknown
    if (validateWorkspace(parsed)) workspace = parsed
  } catch {
    /* 缺失/损坏 → null */
  }
  try {
    const raw = await _adapter.readText(joinConfigPath(path, SETTINGS_FILE))
    settings = parseSettings(JSON.parse(raw) as unknown)
  } catch {
    /* 缺失/损坏 → null */
  }
  return { workspace, settings }
}

// ── 创建 / 迁移 / 防抖保存 ─────────────────────────────────────────────────────

/** 创建配置文件夹并写入种子内容（当前 store 状态），置 active。 */
export async function createConfigFolder(
  ws: WorkspaceState,
  settings: SettingsState,
): Promise<void> {
  if (!_adapter) return
  const path = meta().path
  await _adapter.createDirectory(path)
  await _adapter.writeText(joinConfigPath(path, WORKSPACE_FILE), JSON.stringify(ws, null, 2))
  await _adapter.writeText(joinConfigPath(path, SETTINGS_FILE), JSON.stringify(settings, null, 2))
  setMeta((m) => ({ ...m, status: 'active' }))
  await persistMeta()
}

/** 改相对路径并把当前配置写到新路径（置 active）。 */
export async function migratePath(
  newPath: string,
  ws: WorkspaceState,
  settings: SettingsState,
): Promise<void> {
  setMeta((m) => ({ ...m, path: newPath }))
  await createConfigFolder(ws, settings)
}

let wsTimer: ReturnType<typeof setTimeout> | null = null
let settingsTimer: ReturnType<typeof setTimeout> | null = null

export function saveWorkspace(ws: WorkspaceState): void {
  if (!isConfigActive()) return
  if (wsTimer) clearTimeout(wsTimer)
  wsTimer = setTimeout(() => {
    void _adapter?.writeText(
      joinConfigPath(meta().path, WORKSPACE_FILE),
      JSON.stringify(ws, null, 2),
    )
  }, SAVE_DEBOUNCE_MS)
}

export function saveSettings(s: SettingsState): void {
  if (!isConfigActive()) return
  if (settingsTimer) clearTimeout(settingsTimer)
  settingsTimer = setTimeout(() => {
    void _adapter?.writeText(
      joinConfigPath(meta().path, SETTINGS_FILE),
      JSON.stringify(s, null, 2),
    )
  }, SAVE_DEBOUNCE_MS)
}
