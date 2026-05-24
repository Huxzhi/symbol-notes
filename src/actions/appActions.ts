import { setGlobalStore } from '../stores/globalStore'
import type { ThemeId } from '../stores/types'

export const appActions = {
  setTheme(theme: ThemeId): void {
    setGlobalStore('workspace', 'theme', theme)
    localStorage.setItem('sn-theme', JSON.stringify(theme))
  },

  setCustomCSS(css: string): void {
    setGlobalStore('workspace', 'customCSS', css)
    localStorage.setItem('sn-customCSS', JSON.stringify(css))
  },

  toggleSettings(): void {
    setGlobalStore('workspace', 'showSettings', v => !v)
  },

  setAutoTimestamps(value: boolean): void {
    setGlobalStore('workspace', 'autoTimestamps', value)
    localStorage.setItem('sn-autoTimestamps', JSON.stringify(value))
  },

  setShowOtherFiles(value: boolean): void {
    setGlobalStore('workspace', 'showOtherFiles', value)
    localStorage.setItem('sn-showOtherFiles', JSON.stringify(value))
  },
}
