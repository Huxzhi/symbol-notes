import { createStore } from 'solid-js/store'
import { PAGE_MAP } from '../lib/pageRegistry'

export type ThemeId = 'dark' | 'light' | 'nord'
export type SidebarView = 'files' | 'calendar'

interface UIState {
  showLeft: boolean
  showRight: boolean
  sidebarView: SidebarView
  /** Insertion-ordered list of all open tab IDs (file paths + page IDs). */
  tabOrder: string[]
  /** Which page is active; null means a file tab is active. */
  activePageId: string | null
  theme: ThemeId
  customCSS: string
  showSettings: boolean
  autoTimestamps: boolean
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
  tabOrder: [],
  activePageId: null,
  showSettings: false,
  theme: saved<ThemeId>('sn-theme', 'dark'),
  customCSS: saved<string>('sn-customCSS', ''),
  autoTimestamps: saved<boolean>('sn-autoTimestamps', true),
})

/** Open a page tab (if not already open) and make it active. */
export function openPage(id: string): void {
  if (!uiStore.tabOrder.includes(id)) {
    setUIStore('tabOrder', [...uiStore.tabOrder, id])
  }
  setUIStore('activePageId', id)
}

/** Close a page tab and fall back to file view. */
export function closePage(id: string): void {
  setUIStore('tabOrder', uiStore.tabOrder.filter(t => t !== id))
  if (uiStore.activePageId === id) setUIStore('activePageId', null)
}

/** Whether a tab ID is a page (vs a file path). */
export function isPageTab(id: string): boolean {
  return !!PAGE_MAP[id]
}

export { uiStore, setUIStore }
