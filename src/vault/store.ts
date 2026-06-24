import { createSignal } from 'solid-js'
import { createStore } from 'solid-js/store'
import type { VaultState } from '../stores/types'
import type { FileSystemAdapter } from './fs/types'

// 职责：vault 的单一响应式真实来源（store 本体）+ 连接句柄信号 + 扫描状态。
// 这是整个 vault 层的叶子模块：任何索引/扫描/写操作都 import 它，它不 import 任何
// vault 内部模块——以此打破原先经 index.ts barrel 形成的循环依赖。

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
