import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockStatStore = {}
const mockKeys = vi.fn()
const mockGetMany = vi.fn()
const mockSet = vi.fn()
const mockDel = vi.fn()

vi.mock('idb-keyval', () => ({
  createStore: vi.fn(() => mockStatStore),
  get: vi.fn(),
  set: mockSet,
  del: mockDel,
  keys: mockKeys,
  getMany: mockGetMany,
}))

const {
  loadAllFileStats,
  setFileStatEntry,
  deleteFileStatEntry,
  pruneFileStatCache,
} = await import('../../vault/statCache')

describe('file-stat-cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loadAllFileStats 返回空 Map 当 IDB 为空', async () => {
    mockKeys.mockResolvedValue([])
    mockGetMany.mockResolvedValue([])
    const result = await loadAllFileStats()
    expect(result.size).toBe(0)
  })

  it('loadAllFileStats 将 IDB 条目加载到 Map', async () => {
    mockKeys.mockResolvedValue(['a.md', 'b.md'])
    mockGetMany.mockResolvedValue([
      { size: 100, mtime: 1000, hash: 'abc' },
      { size: 200, mtime: 2000, hash: 'def' },
    ])
    const result = await loadAllFileStats()
    expect(result.get('a.md')).toEqual({ size: 100, mtime: 1000, hash: 'abc' })
    expect(result.get('b.md')).toEqual({ size: 200, mtime: 2000, hash: 'def' })
  })

  it('loadAllFileStats 出错时返回空 Map', async () => {
    mockKeys.mockRejectedValue(new Error('IDB error'))
    const result = await loadAllFileStats()
    expect(result.size).toBe(0)
  })

  it('setFileStatEntry 写入 IDB', async () => {
    mockSet.mockResolvedValue(undefined)
    await setFileStatEntry('note.md', { size: 512, mtime: 9999, hash: 'xyz' })
    expect(mockSet).toHaveBeenCalledWith(
      'note.md',
      { size: 512, mtime: 9999, hash: 'xyz' },
      mockStatStore,
    )
  })

  it('deleteFileStatEntry 从 IDB 删除', async () => {
    mockDel.mockResolvedValue(undefined)
    await deleteFileStatEntry('note.md')
    expect(mockDel).toHaveBeenCalledWith('note.md', mockStatStore)
  })

  it('pruneFileStatCache 删除不在 activePaths 的条目', async () => {
    mockKeys.mockResolvedValue(['a.md', 'b.md', 'c.md'])
    mockDel.mockResolvedValue(undefined)
    await pruneFileStatCache(new Set(['a.md']))
    expect(mockDel).toHaveBeenCalledWith('b.md', mockStatStore)
    expect(mockDel).toHaveBeenCalledWith('c.md', mockStatStore)
    expect(mockDel).not.toHaveBeenCalledWith('a.md', mockStatStore)
  })
})
