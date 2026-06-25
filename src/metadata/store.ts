import { createStore } from 'solid-js/store'
import type { MetadataState } from '../stores/types'

// 职责:metadata 的响应式真实来源——从 vault.files 派生的跨文件索引
// (双链 / 标签 / 任务 / 日历)。由 indexes/* 增量维护(applyFile*/build*/removeFile*)。
// 依赖方向:metadata/store 是 metadata 层的叶子,只被本层 indexes 写、被服务/插件读。

const [metadataStore, setMetadataStore] = createStore<MetadataState>({
  backlinkMap: {},
  unresolvedMap: {},
  tagMap: {},
  taskMap: {},
  calendarByDate: {},
})

export { metadataStore, setMetadataStore }
