// 职责：vault 本地配置（.symbol-notes/）的唯一协调层。
// 配置 IO 经 FileSystemAdapter 直读直写，绕开 io.ts 的 contentCache 与索引层；
// vault 外的 meta（路径 / 是否拒绝）存 IndexedDB。
import type { SettingsState, WorkspaceState } from '../stores/types'

export const DEFAULT_CONFIG_PATH = '.symbol-notes'

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
