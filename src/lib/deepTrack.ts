// 职责：在 createEffect 里强制对一个（含嵌套）值做深度响应式订阅。
// Solid store 是细粒度响应：只读顶层 key 不会在深层节点变更时重跑 effect。
// 用于「任意深层变更都要落盘」的保存 effect——遍历整棵树以订阅所有嵌套节点。
export function deepTrack(value: unknown): void {
  // JSON.stringify 递归读取每个属性，逐个触发 store 代理的依赖收集。
  // 仅为订阅副作用，返回值丢弃。
  JSON.stringify(value)
}
