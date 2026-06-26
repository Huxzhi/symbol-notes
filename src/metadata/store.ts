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
})

export { metadataStore, setMetadataStore }
