import { createSignal } from 'solid-js'
import { createStore } from 'solid-js/store'
import type { VaultState } from '../stores/types'
import type { FileSystemAdapter } from './fs/types'

// 职责：vault 的单一响应式真实来源（store 本体）+ 连接句柄信号 + 扫描状态。
// 叶子模块：不 import 任何上层模块。

// ── Vault connection signal ───────────────────────────────────────────────────

const [_vaultFs, setVaultFs] = createSignal<FileSystemAdapter | null>(null)
export const vaultFs = _vaultFs
export { setVaultFs }

// ── Reactive state（单一真实来源） ─────────────────────────────────────────────

const [vaultStore, setVaultStore] = createStore<VaultState>({
  files: {},
  backlinkMap: {},
  unresolvedMap: {},
  tagMap: {},
  taskMap: {},
  calendarByDate: {},
})

export { setVaultStore, vaultStore }

// ── Scan status ───────────────────────────────────────────────────────────────

export const [isIndexing, setIsIndexing] = createSignal(false)
