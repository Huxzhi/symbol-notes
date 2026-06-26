import { createStore } from 'solid-js/store'
import type { MetadataState } from '../stores/types'

// 职责:metadata 的响应式真实来源——每文件解析缓存(cache)+ 从内容派生的跨文件
// 索引(双链 / 标签 / 任务 / 日历)。由 parse/index 写、indexes/* 增量维护。
// 依赖方向:metadata/store 是 metadata 层的叶子,只被本层写、被服务/插件读。

const [metadataStore, setMetadataStore] = createStore<MetadataState>({
  cache: {},
  resolvedMap: {},
  backlinkMap: {},
  unresolvedMap: {},
  tagMap: {},
  taskMap: {},
  calendarByDate: {},
  inProgressTaskCount: 0,
  initialized: false,
})

export { metadataStore, setMetadataStore }

// ── 解析进度（取代旧的 vault/loadProgress 信号） ────────────────────────────────

/** 标记一个后台解析/索引任务开始（必须与 endIndexTask 配对，建议放 try/finally）。 */
export function beginIndexTask(): void {
  setMetadataStore('inProgressTaskCount', (n) => n + 1)
}

/** 标记一个后台解析/索引任务结束。 */
export function endIndexTask(): void {
  setMetadataStore('inProgressTaskCount', (n) => Math.max(0, n - 1))
}

/** 首次完整 parse+index 建成后调用（幂等，置位后恒为 true）。 */
export function markInitialized(): void {
  if (!metadataStore.initialized) setMetadataStore('initialized', true)
}
