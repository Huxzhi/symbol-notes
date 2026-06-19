import { createRoot, createEffect } from 'solid-js'
import { createStore } from 'solid-js/store'
import * as vaultConfig from '../vault/vaultConfig'
import type { SettingsState, ThemeId, CustomTheme, ThemeMode } from './types'

const defaults: SettingsState = {
  theme: 'dark',
  customThemes: [],
  customCSS: '',
  autoTimestamps: true,
  showOtherFiles: true,
  pluginStates: {},
}

const [settingsStore, setSettingsStore] = createStore<SettingsState>({ ...defaults })

/** 由 vaultConfig 读到磁盘配置后注入（与默认值合并，容忍缺字段）。 */
export function hydrateSettings(payload: Partial<SettingsState>): void {
  setSettingsStore({ ...defaults, ...payload })
}

createRoot(() => {
  // 仅在配置文件夹激活时落盘；否则仅内存（vaultConfig.saveSettings 内部已 gate）。
  createEffect(() => vaultConfig.saveSettings({ ...settingsStore }))
})

export const settingsActions = {
  setTheme(theme: string): void {
    setSettingsStore('theme', theme)
  },
  setCustomThemes(themes: CustomTheme[]): void {
    setSettingsStore('customThemes', themes)
  },
  addCustomTheme(base: string, mode: ThemeMode, vars: Record<string, string>): string {
    const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const n = settingsStore.customThemes.length + 1
    const theme: CustomTheme = { id, name: `自定义 ${n}`, base, mode, vars }
    setSettingsStore('customThemes', (list) => [...list, theme])
    return id
  },
  updateCustomThemeVar(id: string, name: string, value: string): void {
    setSettingsStore('customThemes', (t) => t.id === id, 'vars', name, value)
  },
  renameCustomTheme(id: string, name: string): void {
    setSettingsStore('customThemes', (t) => t.id === id, 'name', name)
  },
  deleteCustomTheme(id: string): void {
    const t = settingsStore.customThemes.find((x) => x.id === id)
    setSettingsStore('customThemes', (list) => list.filter((x) => x.id !== id))
    if (settingsStore.theme === id) setSettingsStore('theme', t?.base ?? 'dark')
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
