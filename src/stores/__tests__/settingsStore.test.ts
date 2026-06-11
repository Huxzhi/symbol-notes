import { describe, it, expect, beforeEach } from 'vitest'
import { settingsStore, settingsActions } from '../settingsStore'

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
