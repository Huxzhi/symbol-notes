import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerContextMenu,
  getMenuItems,
  unregisterContextMenu,
  _resetContextMenuForTest,
} from '../pluginRegistry'

beforeEach(() => _resetContextMenuForTest())

describe('registerContextMenu', () => {
  it('returns items from registered factory', () => {
    registerContextMenu('file', () => [{ label: 'Delete', action: () => {} }])
    const items = getMenuItems('file', {} as DOMStringMap)
    expect(items).toHaveLength(1)
    expect((items[0] as { label: string }).label).toBe('Delete')
  })
  it('returns empty array for unknown type', () => {
    expect(getMenuItems('unknown', {} as DOMStringMap)).toEqual([])
  })
})

describe('unregisterContextMenu', () => {
  it('removes the factory so getMenuItems returns []', () => {
    registerContextMenu('tab', () => [{ label: 'Close', action: () => {} }])
    unregisterContextMenu('tab')
    expect(getMenuItems('tab', {} as DOMStringMap)).toEqual([])
  })
  it('is a no-op for unknown type', () => {
    expect(() => unregisterContextMenu('nonexistent')).not.toThrow()
  })
})
