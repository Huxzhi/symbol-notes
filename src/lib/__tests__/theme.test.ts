import { describe, it, expect } from 'vitest'
import { resolveTheme, THEME_VARS, PRESET_THEMES, type CustomTheme } from '../theme'

const custom: CustomTheme = {
  id: 'custom-1', name: '我的', base: 'dark', mode: 'dark',
  vars: { '--accent': '#ff0000' },
}

describe('resolveTheme', () => {
  it('preset id 解析为 preset spec', () => {
    expect(resolveTheme('nord', [])).toEqual({ kind: 'preset', id: 'nord' })
  })
  it('custom id 解析为 custom spec（带 mode 与 vars）', () => {
    expect(resolveTheme('custom-1', [custom])).toEqual({
      kind: 'custom', mode: 'dark', vars: { '--accent': '#ff0000' },
    })
  })
  it('未知 id 回退到 dark 预设', () => {
    expect(resolveTheme('nope', [])).toEqual({ kind: 'preset', id: 'dark' })
  })
})

describe('THEME_VARS / PRESET_THEMES', () => {
  it('变量名唯一且都以 -- 开头', () => {
    const names = THEME_VARS.map((v) => v.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names.every((n) => n.startsWith('--'))).toBe(true)
  })
  it('不包含派生变量 --accent-bg', () => {
    expect(THEME_VARS.some((v) => v.name === '--accent-bg')).toBe(false)
  })
  it('每个预设都有 mode', () => {
    expect(PRESET_THEMES.every((t) => t.mode === 'light' || t.mode === 'dark')).toBe(true)
  })
})
