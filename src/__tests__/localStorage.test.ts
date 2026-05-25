import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadFromStorage, saveToStorage } from '../lib/localStorage'

const mockStore: Record<string, string> = {}
const localStorageMock = {
  getItem: vi.fn((key: string) => mockStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { mockStore[key] = value }),
}

beforeEach(() => {
  Object.keys(mockStore).forEach(k => delete mockStore[k])
  vi.clearAllMocks()
  vi.stubGlobal('localStorage', localStorageMock)
})

describe('loadFromStorage', () => {
  it('returns fallback when key does not exist', () => {
    expect(loadFromStorage('missing', 42)).toBe(42)
  })

  it('returns parsed value when key exists', () => {
    mockStore['x'] = JSON.stringify({ a: 1 })
    expect(loadFromStorage('x', null)).toEqual({ a: 1 })
  })

  it('returns fallback when JSON is invalid', () => {
    mockStore['bad'] = 'not-json{'
    expect(loadFromStorage('bad', 'default')).toBe('default')
  })

  it('returns fallback when validate returns false', () => {
    mockStore['v'] = JSON.stringify([1, 2, 3])
    expect(loadFromStorage('v', 'fb', (v) => typeof v === 'string')).toBe('fb')
  })

  it('returns value when validate returns true', () => {
    mockStore['v'] = JSON.stringify('hello')
    expect(loadFromStorage('v', '', (v) => typeof v === 'string')).toBe('hello')
  })
})

describe('saveToStorage', () => {
  it('serializes value to localStorage', () => {
    saveToStorage('k', { foo: 'bar' })
    expect(localStorageMock.setItem).toHaveBeenCalledWith('k', '{"foo":"bar"}')
  })
})
