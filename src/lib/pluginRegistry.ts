import { createRoot, createEffect, createSignal, onCleanup } from 'solid-js'
import { createStore } from 'solid-js/store'
import type { Component, JSX } from 'solid-js'
import { settingsStore } from '../stores/settingsStore'
import { workspaceActions, getLeafsByType, activeLayout, activeFilePath, activeSidebarType } from '../stores/workspaceStore'
import { loadFromStorage, saveToStorage } from './localStorage'
import type { ViewComponentProps } from '../stores/types'

// ── View Registry ─────────────────────────────────────────────────────────────

export interface FileViewDef {
  kind: 'file'
  type: string
  getDisplayText(path: string): string
  getIcon?(): JSX.Element
  canAcceptFile(path: string): boolean
  component: Component<ViewComponentProps>
}

export interface PageViewDef {
  kind: 'page'
  type: string
  getDisplayText(): string
  getIcon?(): JSX.Element
  component: Component<ViewComponentProps>
}

export interface PanelViewDef {
  kind: 'panel'
  position: 'left' | 'right'
  type: string
  getDisplayText(): string
  getIcon?(): JSX.Element
  component: Component<ViewComponentProps>
  onLeafOpen?(leafId: string): void
  onLeafClose?(leafId: string): void
}

export type ViewDef = FileViewDef | PageViewDef | PanelViewDef

const [_viewRegistry, setViewRegistry] = createSignal(new Map<string, ViewDef>())

export function registerView(def: ViewDef): void {
  setViewRegistry(m => new Map(m).set(def.type, def))
}

export function unregisterView(type: string): void {
  setViewRegistry(m => { const n = new Map(m); n.delete(type); return n })
}

export function getView(type: string): ViewDef | undefined {
  return _viewRegistry().get(type)
}

export function getFileViewForPath(path: string): FileViewDef | undefined {
  for (const def of _viewRegistry().values()) {
    if (def.kind === 'file' && def.canAcceptFile(path)) return def as FileViewDef
  }
  return undefined
}

export function getLeftPanelViews(): PanelViewDef[] {
  return [..._viewRegistry().values()].filter((d): d is PanelViewDef => d.kind === 'panel' && d.position === 'left')
}

export function getRightPanelViews(): PanelViewDef[] {
  return [..._viewRegistry().values()].filter((d): d is PanelViewDef => d.kind === 'panel' && d.position === 'right')
}

export function _clearViewRegistryForTest(): void {
  setViewRegistry(new Map())
}

// ── Ribbon Registry ───────────────────────────────────────────────────────────

export interface RibbonItemDef {
  id: string
  title: string
  getIcon(): JSX.Element
  onClick(): void
  isActive?(): boolean
  position?: 'bottom'
}

const [_ribbonItems, setRibbonItems] = createSignal<RibbonItemDef[]>([])

export function registerRibbonItem(def: RibbonItemDef): void {
  setRibbonItems(prev => [...prev, def])
}

export function unregisterRibbonItem(id: string): void {
  setRibbonItems(prev => prev.filter(d => d.id !== id))
}

export function getRibbonItems(position: 'top' | 'bottom' = 'top'): RibbonItemDef[] {
  return _ribbonItems().filter(d => (d.position ?? 'top') === position)
}

// ── Settings Tab Registry ─────────────────────────────────────────────────────

export interface SettingsTabProps {
  getConfig<T extends Record<string, unknown>>(defaults: T): T
  setConfig(patch: Record<string, unknown>): void
}

export interface SettingsTabInput {
  name: string
  component: Component<SettingsTabProps>
}

export interface SettingsTabDef extends SettingsTabInput {
  pluginId: string
  getConfig<T extends Record<string, unknown>>(defaults: T): T
  setConfig(patch: Record<string, unknown>): void
}

const [_settingsTabs, setSettingsTabs] = createSignal<SettingsTabDef[]>([])

export function registerSettingsTab(def: SettingsTabDef): void {
  setSettingsTabs(prev => [...prev, def])
}

export function unregisterSettingsTab(pluginId: string): void {
  setSettingsTabs(prev => prev.filter(t => t.pluginId !== pluginId))
}

export function getSettingsTabs(): SettingsTabDef[] {
  return _settingsTabs()
}

// ── Context Menu Registry ─────────────────────────────────────────────────────

export type MenuItem =
  | { label: string; action: () => void; disabled?: boolean }
  | { separator: true }

type ContextMenuFactory = (dataset: DOMStringMap) => MenuItem[]

const _contextMenuRegistry = new Map<string, ContextMenuFactory>()

export function registerContextMenu(type: string, factory: ContextMenuFactory): void {
  _contextMenuRegistry.set(type, factory)
}

export function unregisterContextMenu(type: string): void {
  _contextMenuRegistry.delete(type)
}

export function getMenuItems(type: string, dataset: DOMStringMap): MenuItem[] {
  return _contextMenuRegistry.get(type)?.(dataset) ?? []
}

export function _resetContextMenuForTest(): void {
  _contextMenuRegistry.clear()
}

// ── Plugin Lifecycle ──────────────────────────────────────────────────────────

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
