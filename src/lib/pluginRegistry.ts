import type { Component, JSX } from 'solid-js'
import { createEffect, createRoot, createSignal, onCleanup } from 'solid-js'
import { createStore } from 'solid-js/store'
import { settingsStore } from '../stores/settingsStore'
import type { RevealRequest, ViewComponentProps } from '../stores/types'
import {
  activeFilePath,
  activeLayout,
  activeSidebarType,
  getLeafsByType,
  leafInstances,
  workspaceActions,
} from '../stores/workspaceStore'
import { vault, metadata, fileManager } from '../services'
import type {
  VaultService,
  MetadataService,
  FileManagerService,
} from '../services'
import type { Heading } from './cm6/headingsField'
import type { OutLink } from './cm6/outLinksField'
import { getPluginConfig, setPluginConfig } from './pluginData'
export type { ViewComponentProps }

export type { Heading, OutLink }

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

const [_viewRegistry, setViewRegistry] = createSignal(
  new Map<string, ViewDef>(),
)

export function registerView(def: ViewDef): void {
  setViewRegistry((m) => new Map(m).set(def.type, def))
}

export function unregisterView(type: string): void {
  setViewRegistry((m) => {
    const n = new Map(m)
    n.delete(type)
    return n
  })
}

export function getView(type: string): ViewDef | undefined {
  return _viewRegistry().get(type)
}

export function getFileViewForPath(path: string): FileViewDef | undefined {
  const defs = [..._viewRegistry().values()]
  for (let i = defs.length - 1; i >= 0; i--) {
    const def = defs[i]
    if (def.kind === 'file' && def.canAcceptFile(path))
      return def as FileViewDef
  }
  return undefined
}

export function getLeftPanelViews(): PanelViewDef[] {
  return [..._viewRegistry().values()].filter(
    (d): d is PanelViewDef => d.kind === 'panel' && d.position === 'left',
  )
}

export function getRightPanelViews(): PanelViewDef[] {
  return [..._viewRegistry().values()].filter(
    (d): d is PanelViewDef => d.kind === 'panel' && d.position === 'right',
  )
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
  setRibbonItems((prev) => [...prev, def])
}

export function unregisterRibbonItem(id: string): void {
  setRibbonItems((prev) => prev.filter((d) => d.id !== id))
}

export function getRibbonItems(
  position: 'top' | 'bottom' = 'top',
): RibbonItemDef[] {
  return _ribbonItems().filter((d) => (d.position ?? 'top') === position)
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
  setSettingsTabs((prev) => [...prev, def])
}

export function unregisterSettingsTab(pluginId: string): void {
  setSettingsTabs((prev) => prev.filter((t) => t.pluginId !== pluginId))
}

export function getSettingsTabs(): SettingsTabDef[] {
  return _settingsTabs()
}

// ── Context Menu Registry ─────────────────────────────────────────────────────

export type MenuItem =
  | { label: string; action: () => void; disabled?: boolean }
  | { separator: true }

type ContextMenuFactory = (dataset: DOMStringMap) => MenuItem[]

const _contextMenuRegistry = new Map<string, ContextMenuFactory[]>()

export function registerContextMenu(
  type: string,
  factory: ContextMenuFactory,
): void {
  const list = _contextMenuRegistry.get(type)
  if (list) list.push(factory)
  else _contextMenuRegistry.set(type, [factory])
}

export function unregisterContextMenu(
  type: string,
  factory?: ContextMenuFactory,
): void {
  if (!factory) {
    _contextMenuRegistry.delete(type)
    return
  }
  const list = _contextMenuRegistry.get(type)
  if (!list) return
  const next = list.filter((f) => f !== factory)
  if (next.length > 0) _contextMenuRegistry.set(type, next)
  else _contextMenuRegistry.delete(type)
}

export function getMenuItems(type: string, dataset: DOMStringMap): MenuItem[] {
  const list = _contextMenuRegistry.get(type)
  if (!list || list.length === 0) return []
  const groups = list.map((f) => f(dataset)).filter((g) => g.length > 0)
  const out: MenuItem[] = []
  groups.forEach((g, i) => {
    if (i > 0) out.push({ separator: true })
    out.push(...g)
  })
  return out
}

export function _resetContextMenuForTest(): void {
  _contextMenuRegistry.clear()
}

// 三个数据服务(VaultService / MetadataService / FileManagerService)的定义与单例
// 在 src/services.ts;这里只把单例转交给插件(见下方 ctx)。

// ── Plugin Lifecycle ──────────────────────────────────────────────────────────

export interface PluginContext {
  view(def: ViewDef): void
  ribbon(def: RibbonItemDef): void
  contextMenu(type: string, factory: ContextMenuFactory): void
  vault: VaultService
  metadata: MetadataService
  fileManager: FileManagerService
  workspace: {
    /** 直接按 type+state 申请或切换一个 leaf，不经过文件路径解析 */
    openLeaf(
      viewState: { type: string; state: Record<string, unknown> },
      opts?: {
        area?: 'left' | 'main' | 'right'
        newTab?: boolean
        pin?: boolean
      },
    ): void
    openFile(
      path: string,
      opts?: { area?: 'left' | 'main' | 'right'; newTab?: boolean },
    ): void
    /** 打开文件并在编辑器里精确定位（一次性 reveal）。 */
    openFileAt(path: string, reveal: RevealRequest): void
    openPage(type: string): void
    openPanel(
      area: 'left' | 'right',
      type: string,
      state?: Record<string, unknown>,
    ): void
    getLeafsByType(type: string): string[]
    activeLeafId(): string | null
    activeFilePath(): string | null
    activeSidebarType(side: 'left' | 'right'): string | null
    switchSidebarPanel(side: 'left' | 'right', type: string, allowClose?: boolean): void
    /** Out-links parsed from the active editor. Reactive. Empty when no editor is open. */
    activeOutLinks(): OutLink[]
    /** Headings parsed from the active editor. Reactive. Empty when no editor is open. */
    activeHeadings(): Heading[]
    /** Insert text at the cursor of the active editor. cursorPos = offset within
     *  the inserted text to place the caret (null/undefined → end of insert).
     *  Returns false when no editor is active. */
    insertAtCursor(text: string, cursorPos?: number | null): boolean
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
  setRegistered((prev) => [...prev, def])
}

export function getRegisteredPlugins(): PluginDef[] {
  return _registered()
}

function loadPlugin(def: PluginDef): () => void {
  return createRoot((dispose) => {
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
        onCleanup(() => unregisterContextMenu(type, factory))
      },
      vault,
      metadata,
      fileManager,
      workspace: {
        openLeaf: (viewState, opts) =>
          workspaceActions.openLeaf(viewState, opts),
        openFile: (path, opts) => workspaceActions.openFile(path, opts),
        openFileAt: (path, reveal) => workspaceActions.openFileAt(path, reveal),
        openPage: (type) => workspaceActions.openPage(type),
        openPanel: (area, type, state) =>
          workspaceActions.openSidebarPanel(area, type, state),
        getLeafsByType,
        activeLeafId: () => activeLayout().activeLeafId,
        activeFilePath: () => activeFilePath(),
        activeSidebarType: (side) => activeSidebarType(side),
        switchSidebarPanel: (side, type, allowClose) =>
          workspaceActions.switchSidebarPanel(side, type, allowClose),
        activeOutLinks: () => {
          const id = activeLayout().activeLeafId
          return id ? (leafInstances[id]?.outLinks ?? []) : []
        },
        activeHeadings: () => {
          const id = activeLayout().activeLeafId
          return id ? (leafInstances[id]?.headings ?? []) : []
        },
        insertAtCursor: (text, cursorPos) => {
          const id = activeLayout().activeLeafId
          if (!id) return false
          const view = leafInstances[id]?.cmView
          if (!view) return false
          const sel = view.state.selection.main
          const caret = sel.from + (cursorPos ?? text.length)
          view.dispatch({
            changes: { from: sel.from, to: sel.to, insert: text },
            selection: { anchor: caret },
          })
          view.focus()
          return true
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
          return { ...defaults, ...getPluginConfig(def.id) } as T
        },
        setConfig(patch) {
          setPluginConfig(def.id, patch)
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
        const enabled =
          def.core ||
          (settingsStore.pluginStates[def.id] ?? def.defaultEnabled ?? true)
        if (enabled) {
          const dispose = loadPlugin(def)
          onCleanup(dispose)
        }
      })
    }
  })
}
