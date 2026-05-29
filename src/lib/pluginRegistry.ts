import { createRoot, createEffect, createSignal, onCleanup } from 'solid-js'
import { createStore } from 'solid-js/store'
import { registerView, unregisterView } from './viewRegistry'
import { registerRibbonItem, unregisterRibbonItem } from './ribbonRegistry'
import { registerContextMenu, unregisterContextMenu } from './contextMenuRegistry'
import { registerSettingsTab, unregisterSettingsTab, type SettingsTabInput } from './settingsTabRegistry'
import { settingsStore } from '../stores/settingsStore'
import { workspaceActions, getLeafsByType, activeLayout, activeFilePath, activeSidebarType } from '../stores/workspaceStore'
import { loadFromStorage, saveToStorage } from './localStorage'
import type { ViewDef } from './viewRegistry'
import type { RibbonItemDef } from './ribbonRegistry'
import type { MenuItem } from './contextMenuRegistry'

type ContextMenuFactory = (dataset: DOMStringMap) => MenuItem[]

export interface PluginContext {
  view(def: ViewDef): void
  ribbon(def: RibbonItemDef): void
  contextMenu(type: string, factory: ContextMenuFactory): void
  workspace: {
    openFile(path: string, opts?: { area?: 'left' | 'main' | 'right'; newTab?: boolean }): void
    openPage(type: string): void
    openPanel(area: 'left' | 'right', type: string, state?: Record<string, unknown>): void
    getLeafsByType(type: string): string[]
    activeLeafId(): string | null
    activeFilePath(): string | null
    activeSidebarType(side: 'left' | 'right'): string | null
    switchSidebarPanel(side: 'left' | 'right', type: string): void
  }
  settings: {
    tab(def: SettingsTabInput): void
    getConfig<T extends Record<string, unknown>>(defaults: T): T
    setConfig(patch: Record<string, unknown>): void
  }
}

export interface PluginDef {
  id: string
  name: string
  description?: string
  core?: boolean
  defaultEnabled?: boolean
  setup(ctx: PluginContext): void
}

export function definePlugin(def: PluginDef): PluginDef {
  return def
}

const [_registered, setRegistered] = createSignal<PluginDef[]>([])

export function registerPlugin(def: PluginDef): void {
  setRegistered(prev => [...prev, def])
}

export function getRegisteredPlugins(): PluginDef[] {
  return _registered()
}

function loadPlugin(def: PluginDef): () => void {
  return createRoot((dispose) => {
    const saved = loadFromStorage<Record<string, unknown>>(
      `sn-plugin-${def.id}`, {}, (v) => typeof v === 'object' && v !== null,
    )
    const [config, setConfig] = createStore<Record<string, unknown>>(saved ?? {})
    createEffect(() => saveToStorage(`sn-plugin-${def.id}`, { ...config }))

    const ctx: PluginContext = {
      view(v) {
        registerView(v)
        onCleanup(() => unregisterView(v.type))
      },
      ribbon(item) {
        registerRibbonItem(item)
        onCleanup(() => unregisterRibbonItem(item.id))
      },
      contextMenu(type, factory) {
        registerContextMenu(type, factory)
        onCleanup(() => unregisterContextMenu(type))
      },
      workspace: {
        openFile:           (path, opts) => workspaceActions.openFile(path, opts),
        openPage:           (type)       => workspaceActions.openPage(type),
        openPanel:          (area, type, state) => workspaceActions.openSidebarPanel(area, type, state),
        getLeafsByType,
        activeLeafId:       () => activeLayout().activeLeafId,
        activeFilePath:     () => activeFilePath(),
        activeSidebarType:  (side) => activeSidebarType(side),
        switchSidebarPanel: (side, type) => workspaceActions.switchSidebarPanel(side, type),
      },
      settings: {
        tab(tabDef) {
          registerSettingsTab({
            ...tabDef,
            pluginId: def.id,
            getConfig: ctx.settings.getConfig,
            setConfig: ctx.settings.setConfig,
          })
          onCleanup(() => unregisterSettingsTab(def.id))
        },
        getConfig<T extends Record<string, unknown>>(defaults: T): T {
          return { ...defaults, ...config } as T
        },
        setConfig(patch) {
          setConfig(prev => ({ ...prev, ...patch }))
        },
      },
    }

    def.setup(ctx)
    return dispose
  })
}

export function startPlugins(): void {
  createRoot(() => {
    for (const def of _registered()) {
      createEffect(() => {
        const enabled = def.core || (settingsStore.pluginStates[def.id] ?? def.defaultEnabled ?? true)
        if (enabled) {
          const dispose = loadPlugin(def)
          onCleanup(dispose)
        }
      })
    }
  })
}
