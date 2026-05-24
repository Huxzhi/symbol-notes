import { createStore } from 'solid-js/store'

export type ThemeId = 'dark' | 'light' | 'nord'
export type SidebarView = 'files' | 'calendar'

export interface Tab {
  id: string
  type: string       // matches a ViewDef.type in viewRegistry
  path?: string      // present for file tabs, absent for page tabs
  pinned: boolean
}

interface UIState {
  showLeft: boolean
  showRight: boolean
  sidebarView: SidebarView
  tabs: Record<string, Tab>
  tabOrder: string[]         // ordered list of tab IDs
  activeTabId: string | null
  theme: ThemeId
  customCSS: string
  showSettings: boolean
  autoTimestamps: boolean
  showOtherFiles: boolean
}

function saved<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw !== null ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

const [uiStore, setUIStore] = createStore<UIState>({
  showLeft: true,
  showRight: true,
  sidebarView: 'files',
  tabs: {},
  tabOrder: [],
  activeTabId: null,
  showSettings: false,
  theme: saved<ThemeId>('sn-theme', 'dark'),
  customCSS: saved<string>('sn-customCSS', ''),
  autoTimestamps: saved<boolean>('sn-autoTimestamps', true),
  showOtherFiles: saved<boolean>('sn-showOtherFiles', true),
})

/** Derived helper: path of the active file tab, or null. */
export function activeFilePath(): string | null {
  const { tabs, activeTabId } = uiStore
  return activeTabId ? (tabs[activeTabId]?.path ?? null) : null
}

/** Update every tab whose path matches oldPath. Called by fileSystemService.renameFile. */
export function renameTabPath(oldPath: string, newPath: string): void {
  for (const id of uiStore.tabOrder) {
    if (uiStore.tabs[id]?.path === oldPath) {
      setUIStore('tabs', id, 'path', newPath)
    }
  }
}

/** Reset all workspace tab state. Called when opening a new directory. */
export function clearTabs(): void {
  setUIStore({ tabs: {}, tabOrder: [], activeTabId: null })
}

export { uiStore, setUIStore }
