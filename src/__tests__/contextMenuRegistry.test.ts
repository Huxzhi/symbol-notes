import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerContextMenu,
  getMenuItems,
  _resetForTest,
} from '../lib/contextMenuRegistry'

beforeEach(() => _resetForTest())

describe('contextMenuRegistry', () => {
  it('returns empty array for unknown type', () => {
    const dataset = {} as DOMStringMap
    expect(getMenuItems('unknown', dataset)).toEqual([])
  })

  it('calls registered factory with dataset', () => {
    const dataset = { path: '/notes/foo' } as unknown as DOMStringMap
    registerContextMenu('directory', (_d) => [
      { label: 'Delete', action: () => {}, disabled: false },
    ])
    const items = getMenuItems('directory', dataset)
    expect(items).toHaveLength(1)
    expect('label' in items[0] && items[0].label).toBe('Delete')
  })

  it('overwrites previous factory for same type', () => {
    registerContextMenu('tab', () => [{ label: 'A', action: () => {} }])
    registerContextMenu('tab', () => [{ label: 'B', action: () => {} }])
    const items = getMenuItems('tab', {} as DOMStringMap)
    expect('label' in items[0] && items[0].label).toBe('B')
  })
})
