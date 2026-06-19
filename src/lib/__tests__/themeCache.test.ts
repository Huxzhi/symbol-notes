import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGet = vi.fn()
const mockSet = vi.fn()

vi.mock('idb-keyval', () => ({
  get: mockGet,
  set: mockSet,
}))

const { getCachedTheme, writeCachedTheme, isThemeSpec } = await import('../themeCache')

describe('themeCache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('isThemeSpec 接受合法 preset', () => {
    expect(isThemeSpec({ kind: 'preset', id: 'nord' })).toBe(true)
  })

  it('isThemeSpec 接受合法 custom', () => {
    expect(isThemeSpec({ kind: 'custom', mode: 'light', vars: { '--bg-base': '#fff' } })).toBe(true)
  })

  it('isThemeSpec 拒绝非法值', () => {
    expect(isThemeSpec(null)).toBe(false)
    expect(isThemeSpec({ kind: 'preset' })).toBe(false)
    expect(isThemeSpec({ kind: 'custom', mode: 'sunset', vars: {} })).toBe(false)
    expect(isThemeSpec({ kind: 'other', id: 'x' })).toBe(false)
  })

  it('getCachedTheme 返回 null 当 IDB 为空', async () => {
    mockGet.mockResolvedValueOnce(undefined)
    expect(await getCachedTheme()).toBeNull()
  })

  it('getCachedTheme 返回 null 当缓存形状非法', async () => {
    mockGet.mockResolvedValueOnce({ kind: 'custom', mode: 'nope' })
    expect(await getCachedTheme()).toBeNull()
  })

  it('getCachedTheme 返回合法缓存', async () => {
    const spec = { kind: 'preset', id: 'light' }
    mockGet.mockResolvedValueOnce(spec)
    expect(await getCachedTheme()).toEqual(spec)
  })

  it('writeCachedTheme 写入 idb-keyval', async () => {
    const spec = { kind: 'preset', id: 'dark' } as const
    await writeCachedTheme(spec)
    expect(mockSet).toHaveBeenCalledWith('sn-theme-cache', spec)
  })
})
