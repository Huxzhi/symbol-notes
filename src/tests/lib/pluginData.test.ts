import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSave = vi.fn()
vi.mock('../../vault/vaultConfig', () => ({
  savePluginData: mockSave,
  isConfigActive: () => false,
}))

const { getPluginConfig, setPluginConfig, hydratePluginData } = await import('../../lib/pluginData')

describe('pluginData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('未设置时返回空对象', () => {
    expect(getPluginConfig('x-none')).toEqual({})
  })

  it('setPluginConfig 合并写入', () => {
    setPluginConfig('p1', { a: 1 })
    setPluginConfig('p1', { b: 2 })
    expect(getPluginConfig('p1')).toEqual({ a: 1, b: 2 })
  })

  it('hydratePluginData 覆盖式注入', () => {
    setPluginConfig('p2', { a: 1 })
    hydratePluginData('p2', { c: 3 })
    expect(getPluginConfig('p2')).toEqual({ c: 3 })
  })

  it('写入会触发 savePluginData', () => {
    setPluginConfig('p3', { x: 1 })
    expect(mockSave).toHaveBeenCalledWith('p3', { x: 1 })
  })
})
