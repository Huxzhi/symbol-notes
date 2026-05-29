import { createRoot, createEffect } from 'solid-js'
import { createStore } from 'solid-js/store'
import { loadFromStorage, saveToStorage } from '../lib/localStorage'
import type { SettingsState, ThemeId } from './types'

const defaults: SettingsState = {
  theme: 'dark',
  customCSS: '',
  autoTimestamps: true,
  showOtherFiles: true,
  pluginStates: {},
}

const [settingsStore, setSettingsStore] = createStore<SettingsState>({
  ...defaults,
  ...loadFromStorage<Partial<SettingsState>>('sn-settings', defaults, (v) => typeof v === 'object' && v !== null),
})

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
  setPluginState(id: string, enabled: boolean): void {
    setSettingsStore('pluginStates', id, enabled)
  },
}

export { settingsStore, setSettingsStore }
export type { ThemeId }
