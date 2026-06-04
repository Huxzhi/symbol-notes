import { createRoot, createEffect, createSignal, onCleanup } from 'solid-js'
import { createStore } from 'solid-js/store'
import type { Component, JSX } from 'solid-js'
import { settingsStore } from '../stores/settingsStore'
import { workspaceActions, getLeafsByType, activeLayout, activeFilePath, activeSidebarType, leafInstances } from '../stores/workspaceStore'
import { fileActions, vaultFs, vaultStore, getStemIndex } from '../vault'
import { resolveLink } from './knowledgeUtils'
import { loadFromStorage, saveToStorage } from './localStorage'
import type { ViewComponentProps, FileMeta } from '../stores/types'
export type { ViewComponentProps }
import type { OutLink } from './cm6/outLinksField'
import type { Heading } from './cm6/headingsField'

export type { OutLink, Heading }

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
  const defs = [..._viewRegistry().values()]
  for (let i = defs.length - 1; i >= 0; i--) {
    const def = defs[i]
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

// ── Vault Service ─────────────────────────────────────────────────────────────

export interface VaultService {
  /** Whether a vault is open and ready. Reactive — use in createMemo/createEffect. */
  ready(): boolean
  /** All vault files and directories. Reactive. */
  files(): Record<string, FileMeta>
  /** Files that link to the given path. Reactive. */
  backlinks(path: string): string[]
  /** Resolve a wiki link target to an absolute vault path, or null if unresolved. */
  resolveLink(target: string): string | null

  readFile(path: string): Promise<string>
  saveFile(path: string, content: string): Promise<void>
  createFile(name: string): Promise<string | null>
  createFolder(name: string): Promise<void>
  deleteFile(path: string): Promise<void>
  deleteFolder(path: string): Promise<void>
  renameFile(path: string, newName: string): Promise<void>
  moveEntry(src: string, dest: string | null): Promise<void>
}

// ── Plugin Lifecycle ──────────────────────────────────────────────────────────

export interface PluginContext {
  view(def: ViewDef): void
  ribbon(def: RibbonItemDef): void
  contextMenu(type: string, factory: ContextMenuFactory): void
  vault: VaultService
  workspace: {
    openFile(path: string, opts?: { area?: 'left' | 'main' | 'right'; newTab?: boolean }): void
    openPage(type: string): void
    openPanel(area: 'left' | 'right', type: string, state?: Record<string, unknown>): void
    getLeafsByType(type: string): string[]
    activeLeafId(): string | null
    activeFilePath(): string | null
    activeSidebarType(side: 'left' | 'right'): string | null
    switchSidebarPanel(side: 'left' | 'right', type: string): void
    /** Out-links parsed from the active editor. Reactive. Empty when no editor is open. */
    activeOutLinks(): OutLink[]
    /** Headings parsed from the active editor. Reactive. Empty when no editor is open. */
    activeHeadings(): Heading[]
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
      vault: {
        ready:        ()           => vaultFs() !== null,
        files:        ()           => vaultStore.files,
        backlinks:    (path)       => {
          const f = vaultStore.files[path]
          const aliases = f?.aliases ?? []
          const keys = [path, ...aliases.map(a => `${a}.md`)]
          const seen = new Set<string>()
          const result: string[] = []
          for (const key of keys)
            for (const bl of vaultStore.backlinkMap[key] ?? [])
              if (!seen.has(bl)) { seen.add(bl); result.push(bl) }
          return result
        },
        resolveLink:  (target)     => {
          const withExt = target.endsWith('.md') ? target : `${target}.md`
          return resolveLink(withExt, getStemIndex(), vaultStore.files)
        },
        readFile:     (path)       => fileActions.readFile(path),
        saveFile:     (path, c)    => fileActions.saveFile(path, c),
        createFile:   (name)       => fileActions.createFile(name),
        createFolder: (name)       => fileActions.createFolder(name),
        deleteFile:   (path)       => fileActions.deleteFile(path),
        deleteFolder: (path)       => fileActions.deleteFolder(path),
        renameFile:   (path, name) => fileActions.renameFile(path, name),
        moveEntry:    (src, dest)  => fileActions.moveEntry(src, dest),
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
        activeOutLinks: () => {
          const id = activeLayout().activeLeafId
          return id ? (leafInstances[id]?.outLinks ?? []) : []
        },
        activeHeadings: () => {
          const id = activeLayout().activeLeafId
          return id ? (leafInstances[id]?.headings ?? []) : []
        },
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
