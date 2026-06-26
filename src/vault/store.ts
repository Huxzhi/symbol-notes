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
