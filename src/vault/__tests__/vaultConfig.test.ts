import { describe, it, expect } from 'vitest'
import {
  joinConfigPath,
  validateWorkspace,
  parseVaultSettings,
  parseTheme,
  pluginDataPath,
  DEFAULT_CONFIG_PATH,
} from '../vaultConfig'

describe('joinConfigPath', () => {
  it('拼接 base 与文件名', () => {
    expect(joinConfigPath('.symbol-notes', 'workspace.json')).toBe('.symbol-notes/workspace.json')
  })
  it('去掉首尾多余斜杠', () => {
    expect(joinConfigPath('/foo/bar/', 'settings.json')).toBe('foo/bar/settings.json')
  })
  it('base 为空时只返回文件名', () => {
    expect(joinConfigPath('', 'x.json')).toBe('x.json')
  })
})

describe('validateWorkspace', () => {
  it('接受合法形状', () => {
    expect(validateWorkspace({ layouts: {}, activeLayoutId: 'a' })).toBe(true)
  })
  it('缺少 activeLayoutId 时拒绝', () => {
    expect(validateWorkspace({ layouts: {} })).toBe(false)
  })
  it('layouts 是数组时拒绝', () => {
    expect(validateWorkspace({ layouts: [], activeLayoutId: 'a' })).toBe(false)
  })
  it('null 时拒绝', () => {
    expect(validateWorkspace(null)).toBe(false)
  })
})

describe('parseVaultSettings', () => {
  it('返回对象本身', () => {
    expect(parseVaultSettings({ autoTimestamps: false })).toEqual({ autoTimestamps: false })
  })
  it('数组时返回 null', () => {
    expect(parseVaultSettings([])).toBeNull()
  })
  it('null 时返回 null', () => {
    expect(parseVaultSettings(null)).toBeNull()
  })
})

describe('parseTheme', () => {
  it('非数组对象返回自身', () => {
    expect(parseTheme({ theme: 'nord' })).toEqual({ theme: 'nord' })
  })
  it('数组/非对象返回 null', () => {
    expect(parseTheme([])).toBeNull()
    expect(parseTheme('x')).toBeNull()
    expect(parseTheme(null)).toBeNull()
  })
})

describe('pluginDataPath', () => {
  it('拼成 plugins/<id>/data.json（默认 .symbol-notes）', () => {
    expect(pluginDataPath('daily-note')).toBe('.symbol-notes/plugins/daily-note/data.json')
  })
})

describe('DEFAULT_CONFIG_PATH', () => {
  it('默认 .symbol-notes', () => {
    expect(DEFAULT_CONFIG_PATH).toBe('.symbol-notes')
  })
})
