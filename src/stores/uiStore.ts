import { createStore } from 'solid-js/store'

export type ThemeId = 'dark' | 'light' | 'nord'

interface UIState {
  showLeft: boolean
  showRight: boolean
  theme: ThemeId
  customCSS: string
  showSettings: boolean
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
  showSettings: false,
  theme: saved<ThemeId>('sn-theme', 'dark'),
  customCSS: saved<string>('sn-customCSS', ''),
})

export { uiStore, setUIStore }
