// 职责：把 loading 遮罩用到的几个 CSS 颜色快照到 IndexedDB，供启动首帧给遮罩着色，
// 避免「主题还没从 .symbol-notes/theme.json 读出来」时遮罩闪烁。不是主题的真实来源。
import { get, set } from 'idb-keyval'
import { createSignal } from 'solid-js'

const CACHE_KEY = 'sn-mask-colors'

/** LoadingOverlay 实际用到的 CSS 变量。 */
export const MASK_VARS = [
  '--bg-elevated',
  '--border-2',
  '--text',
  '--bg-active',
  '--accent',
  '--text-2',
] as const

/** 读取 <html> 上当前生效的 6 个遮罩变量值。仅浏览器可用。 */
export function snapshotMaskColors(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement)
  const out: Record<string, string> = {}
  for (const v of MASK_VARS) out[v] = cs.getPropertyValue(v).trim()
  return out
}

/** 启动路径：读回遮罩颜色；缺失或非对象返回 null。 */
export async function getMaskColors(): Promise<Record<string, string> | null> {
  try {
    const v = await get<unknown>(CACHE_KEY)
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      return v as Record<string, string>
    }
    return null
  } catch {
    return null
  }
}

/** 主题变化后镜像遮罩颜色到 IDB（fire-and-forget）。 */
export async function writeMaskColors(
  colors: Record<string, string>,
): Promise<void> {
  try {
    await set(CACHE_KEY, colors)
  } catch {
    /* 缓存写失败不影响主流程 */
  }
}

// 启动前由 index.tsx 从 IDB 播种，供 LoadingOverlay 内联取色。
const [_colors, _setColors] = createSignal<Record<string, string>>({})
export const maskColors = _colors
export function setMaskColors(c: Record<string, string>): void {
  _setColors(c)
}
