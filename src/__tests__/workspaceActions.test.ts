import { describe, it, expect } from 'vitest'

function findTabsById(root: any, tabsId: string): any {
  if (root.type === 'tabs' && root.id === tabsId) return root
  if (root.type === 'split') {
    for (const child of root.children) {
      const found = findTabsById(child, tabsId)
      if (found) return found
    }
  }
  return null
}

describe('findTabsById', () => {
  it('finds tabs at root', () => {
    const node = { type: 'tabs', id: 't1', children: [], activeLeafId: null }
    expect(findTabsById(node, 't1')).toBe(node)
  })

  it('returns null for wrong id', () => {
    const node = { type: 'tabs', id: 't1', children: [], activeLeafId: null }
    expect(findTabsById(node, 't2')).toBeNull()
  })

  it('finds tabs nested in a split', () => {
    const tabs = { type: 'tabs', id: 't2', children: [], activeLeafId: null }
    const split = { type: 'split', id: 's1', direction: 'horizontal', children: [tabs] }
    expect(findTabsById(split, 't2')).toBe(tabs)
  })
})
