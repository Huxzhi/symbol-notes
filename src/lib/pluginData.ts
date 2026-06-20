// 职责：按插件 id 持有响应式内存配置 store，并防抖落盘到 .symbol-notes/plugins/<id>/data.json。
// 插件早于 vault 连接启动 → store 模块级持有、随启停不丢；vault 连接后由 hydratePluginData 注入。
import { createEffect, createRoot } from 'solid-js'
import { createStore, reconcile, type SetStoreFunction } from 'solid-js/store'
import * as vaultConfig from '../vault/vaultConfig'

interface Entry {
  config: Record<string, unknown>
  setConfig: SetStoreFunction<Record<string, unknown>>
}

const registry = new Map<string, Entry>()

function ensure(id: string): Entry {
  let entry = registry.get(id)
  if (!entry) {
    createRoot(() => {
      const [config, setConfig] = createStore<Record<string, unknown>>({})
      // 落盘 effect：初次 fire 在无 adapter 时被 gate 掉，不产生 hydrate 前脏写。
      createEffect(() => vaultConfig.savePluginData(id, { ...config }))
      entry = { config, setConfig }
    })
    registry.set(id, entry!)
  }
  return entry!
}

/** 读该插件配置快照（追踪作用域内响应式）。不含 defaults，调用方自行 merge。 */
export function getPluginConfig(id: string): Record<string, unknown> {
  return { ...ensure(id).config }
}

/** 合并 patch 进该插件配置。 */
export function setPluginConfig(id: string, patch: Record<string, unknown>): void {
  ensure(id).setConfig((prev) => ({ ...prev, ...patch }))
}

/** 覆盖式注入（data.json → store）：reconcile 会删除 data 中不存在的旧键。 */
export function hydratePluginData(id: string, data: Record<string, unknown>): void {
  ensure(id).setConfig(reconcile({ ...data }))
}
