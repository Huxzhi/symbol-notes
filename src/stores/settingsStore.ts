import { createRoot, createEffect } from 'solid-js'
import { createStore } from 'solid-js/store'
import * as vaultConfig from '../vault/vaultConfig'
import { applyTheme, resolveTheme } from '../lib/theme'
import type { SettingsState, ThemeId, CustomTheme, ThemeMode, ThemeSettings, VaultSettings } from './types'

const defaults: SettingsState = {
  theme: 'dark',
  customThemes: [],
  customCSS: '',
  autoTimestamps: true,
  showOtherFiles: true,
  pluginStates: {},
}

const [settingsStore, setSettingsStore] = createStore<SettingsState>({ ...defaults })

/** 注入非主题配置（settings.json → store，与默认值合并）。 */
export function hydrateSettings(payload: Partial<VaultSettings>): void {
  setSettingsStore({
    pluginStates: payload.pluginStates ?? defaults.pluginStates,
    autoTimestamps: payload.autoTimestamps ?? defaults.autoTimestamps,
    showOtherFiles: payload.showOtherFiles ?? defaults.showOtherFiles,
  })
}

/** 注入主题配置（theme.json → store），随后同步应用主题（避免揭遮罩前的微任务竞态）。 */
export function hydrateTheme(payload: Partial<ThemeSettings>): void {
  setSettingsStore({
    theme: payload.theme ?? defaults.theme,
    customThemes: payload.customThemes ?? defaults.customThemes,
    customCSS: payload.customCSS ?? defaults.customCSS,
  })
  applyTheme(resolveTheme(settingsStore.theme, settingsStore.customThemes))
}

createRoot(() => {
  // 非主题 → settings.json（vaultConfig.saveSettings 内 gate isConfigActive + 防抖）
  createEffect(() =>
    vaultConfig.saveSettings({
      pluginStates: settingsStore.pluginStates,
      autoTimestamps: settingsStore.autoTimestamps,
      showOtherFiles: settingsStore.showOtherFiles,
    }),
  )
  // 主题 → theme.json
  createEffect(() =>
    vaultConfig.saveTheme({
      theme: settingsStore.theme,
      customThemes: settingsStore.customThemes,
      customCSS: settingsStore.customCSS,
    }),
  )
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
