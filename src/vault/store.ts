import { createSignal } from 'solid-js'
import { createStore } from 'solid-js/store'
// 扫描/解析进度已迁至 metadata/store(inProgressTaskCount / initialized)。
import type { VaultState } from '../stores/types'
import type { FileSystemAdapter } from './fs/types'

// 职责：vault 的响应式真实来源（仅 files）+ 连接句柄信号 + 扫描状态。
// 叶子模块：不 import 任何上层模块。派生索引(双链/标签/任务/日历)归 metadata/store。

// ── Vault connection signal ───────────────────────────────────────────────────

const [_vaultFs, setVaultFs] = createSignal<FileSystemAdapter | null>(null)
export const vaultFs = _vaultFs
export { setVaultFs }

// ── Reactive state（files 真实来源） ───────────────────────────────────────────

const [vaultStore, setVaultStore] = createStore<VaultState>({
  files: {},
})

export { setVaultStore, vaultStore }

// ── 扫描就绪信号（vault → metadata 的派生触发） ─────────────────────────────────
// 结构扫描 + 补 stat 完成后 bump。metadata 订阅它跑全量派生（解析+建索引）。
// vault 叶子不 import metadata；方向是 metadata 读这个信号。每次 vault 加载/切换 bump 一次。
const [scanReady, bumpScanReady] = createSignal(0)
export function markScanReady(): void {
  bumpScanReady((n) => n + 1)
}
export { scanReady }
