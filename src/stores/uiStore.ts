import { createStore } from 'solid-js/store'

export type ThemeId = 'dark' | 'light' | 'nord'
export type SidebarView = 'files' | 'calendar'

interface UIState {
  showLeft: boolean
  showRight: boolean
  sidebarView: SidebarView
  calendarOpen: boolean   // calendar tab exists in tab bar
  calendarActive: boolean // calendar is the currently visible view
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
  calendarOpen: false,
  calendarActive: false,
  showSettings: false,
  theme: saved<ThemeId>('sn-theme', 'dark'),
  customCSS: saved<string>('sn-customCSS', ''),
  autoTimestamps: saved<boolean>('sn-autoTimestamps', true),
})

export { uiStore, setUIStore }
