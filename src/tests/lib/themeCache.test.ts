import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGet = vi.fn()
const mockSet = vi.fn()
const mockDel = vi.fn()

vi.mock('idb-keyval', () => ({
  get: mockGet,
  set: mockSet,
  del: mockDel,
}))

const { getMaskColors, writeMaskColors, MASK_VARS } = await import('../../lib/themeCache')

describe('themeCache mask colors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('MASK_VARS 含 6 个遮罩变量', () => {
    expect(MASK_VARS).toContain('--bg-elevated')
    expect(MASK_VARS).toContain('--accent')
    expect(MASK_VARS.length).toBe(6)
  })

  it('getMaskColors 返回 null 当 IDB 为空', async () => {
    mockGet.mockResolvedValueOnce(undefined)
    expect(await getMaskColors()).toBeNull()
  })

  it('getMaskColors 返回 null 当非对象', async () => {
    mockGet.mockResolvedValueOnce('nope')
    expect(await getMaskColors()).toBeNull()
  })

  it('getMaskColors 返回合法对象', async () => {
    const colors = { '--accent': '#6c63ff' }
    mockGet.mockResolvedValueOnce(colors)
    expect(await getMaskColors()).toEqual(colors)
  })

  it('writeMaskColors 写入 sn-mask-colors', async () => {
    const colors = { '--text': '#fff' }
    await writeMaskColors(colors)
    expect(mockSet).toHaveBeenCalledWith('sn-mask-colors', colors)
  })
})
