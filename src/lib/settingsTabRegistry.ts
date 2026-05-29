import { createSignal } from 'solid-js'
import type { Component } from 'solid-js'

export interface SettingsTabProps {
  getConfig<T extends Record<string, unknown>>(defaults: T): T
  setConfig(patch: Record<string, unknown>): void
}

// Plugin provides name + component; registry stores the bound config functions too
export interface SettingsTabInput {
  name: string
  component: Component<SettingsTabProps>
}

export interface SettingsTabDef extends SettingsTabInput {
  pluginId: string
  getConfig<T extends Record<string, unknown>>(defaults: T): T
  setConfig(patch: Record<string, unknown>): void
}

const [_tabs, setTabs] = createSignal<SettingsTabDef[]>([])

export function registerSettingsTab(def: SettingsTabDef): void {
  setTabs(prev => [...prev, def])
}

export function unregisterSettingsTab(pluginId: string): void {
  setTabs(prev => prev.filter(t => t.pluginId !== pluginId))
}

export function getSettingsTabs(): SettingsTabDef[] {
  return _tabs()
}
