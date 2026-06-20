// 职责：把当前生效的 ThemeSpec 镜像到 IndexedDB，并在启动时读回，
// 使首帧（含 loading 遮罩）即正确着色。themeHydrated 闸门见 App 的应用 effect。
import { createSignal } from 'solid-js'
import { get, set } from 'idb-keyval'
import type { ThemeSpec } from './theme'

const CACHE_KEY = 'sn-theme-cache'

/** ThemeSpec 形状校验（缓存可能被外部写脏，读回时必须校验）。 */
export function isThemeSpec(v: unknown): v is ThemeSpec {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (o.kind === 'preset') return typeof o.id === 'string'
  if (o.kind === 'custom') {
    return (
      (o.mode === 'light' || o.mode === 'dark') &&
      typeof o.vars === 'object' &&
      o.vars !== null &&
      !Array.isArray(o.vars)
    )
  }
  return false
}

/** 启动路径：读回缓存主题；缺失或形状非法返回 null。 */
export async function getCachedTheme(): Promise<ThemeSpec | null> {
  try {
    const v = await get<unknown>(CACHE_KEY)
    return isThemeSpec(v) ? v : null
  } catch {
    return null
  }
}

/** 主题变化时镜像到 IDB（调用方 fire-and-forget）。 */
export async function writeCachedTheme(spec: ThemeSpec): Promise<void> {
  try {
    await set(CACHE_KEY, spec)
  } catch {
    /* 缓存写失败不影响主流程 */
  }
}

// themeHydrated：vault 配置流程是否已完成（settings 已反映真实/默认值）。
// 在它为 true 之前，App 的应用 effect 不接管，由 index.tsx 应用的缓存主题兜底，
// 避免默认 settings 把缓存主题回灌成深色。
const [_hydrated, _setHydrated] = createSignal(false)
export const themeHydrated = _hydrated
export function setThemeHydrated(v: boolean): void {
  _setHydrated(v)
}
