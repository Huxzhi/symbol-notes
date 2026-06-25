import { describe, it, expect, beforeEach, vi } from 'vitest'

// hydrateTheme 内部会 applyTheme（触碰 document），node 环境下需 mock。
vi.mock('../../lib/theme', () => ({
  applyTheme: vi.fn(),
  resolveTheme: vi.fn(() => ({ kind: 'preset', id: 'dark' })),
}))

import { settingsStore, settingsActions, hydrateSettings, hydrateTheme } from '../../stores/settingsStore'

beforeEach(() => {
  settingsActions.setCustomThemes([])
  settingsActions.setTheme('dark')
})

describe('settingsStore custom themes', () => {
  it('addCustomTheme 追加一个主题并返回其 id', () => {
    const id = settingsActions.addCustomTheme('nord', 'dark', { '--accent': '#abc' })
    expect(typeof id).toBe('string')
    const t = settingsStore.customThemes.find((x) => x.id === id)
    expect(t).toBeTruthy()
    expect(t!.base).toBe('nord')
    expect(t!.mode).toBe('dark')
    expect(t!.vars['--accent']).toBe('#abc')
  })

  it('updateCustomThemeVar 改写单个变量', () => {
    const id = settingsActions.addCustomTheme('dark', 'dark', { '--accent': '#000' })
    settingsActions.updateCustomThemeVar(id, '--accent', '#fff')
    expect(settingsStore.customThemes.find((x) => x.id === id)!.vars['--accent']).toBe('#fff')
  })

  it('renameCustomTheme 改名', () => {
    const id = settingsActions.addCustomTheme('dark', 'dark', {})
    settingsActions.renameCustomTheme(id, '夜航')
    expect(settingsStore.customThemes.find((x) => x.id === id)!.name).toBe('夜航')
  })

  it('deleteCustomTheme 删除；若删的是当前主题则回退到其 base', () => {
    const id = settingsActions.addCustomTheme('nord', 'dark', {})
    settingsActions.setTheme(id)
    settingsActions.deleteCustomTheme(id)
    expect(settingsStore.customThemes.find((x) => x.id === id)).toBeUndefined()
    expect(settingsStore.theme).toBe('nord')
  })
})

describe('hydrate 分流', () => {
  it('hydrateSettings 只动非主题字段', () => {
    hydrateTheme({ theme: 'nord' })
    hydrateSettings({ autoTimestamps: false })
    expect(settingsStore.autoTimestamps).toBe(false)
    expect(settingsStore.theme).toBe('nord') // 未被 hydrateSettings 覆盖
  })

  it('hydrateTheme 只动主题字段', () => {
    hydrateSettings({ showOtherFiles: false })
    hydrateTheme({ theme: 'light' })
    expect(settingsStore.theme).toBe('light')
    expect(settingsStore.showOtherFiles).toBe(false) // 未被 hydrateTheme 覆盖
  })
})
