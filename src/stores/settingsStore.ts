import { createRoot, createEffect } from 'solid-js'
import { createStore } from 'solid-js/store'
import { loadFromStorage, saveToStorage } from '../lib/localStorage'
import type { SettingsState, ThemeId } from './types'

const [settingsStore, setSettingsStore] = createStore<SettingsState>(
  loadFromStorage<SettingsState>('sn-settings', {
    theme: 'dark',
    customCSS: '',
    autoTimestamps: true,
    showOtherFiles: true,
  }),
)

createRoot(() => {
  createEffect(() => saveToStorage('sn-settings', { ...settingsStore }))
})

export const settingsActions = {
  setTheme(theme: ThemeId): void {
    setSettingsStore('theme', theme)
  },
  setCustomCSS(css: string): void {
    setSettingsStore('customCSS', css)
  },
  setAutoTimestamps(value: boolean): void {
    setSettingsStore('autoTimestamps', value)
  },
  setShowOtherFiles(value: boolean): void {
    setSettingsStore('showOtherFiles', value)
  },
}

export { settingsStore, setSettingsStore }
export type { ThemeId }
