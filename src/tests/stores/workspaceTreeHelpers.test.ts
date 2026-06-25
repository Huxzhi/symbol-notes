import { describe, it, expect } from 'vitest'
import {
  removeLeafFromTree,
  insertLeafIntoTabs,
  reorderLeafInTabsTree,
  splitTabsWithLeaf,
} from '../../stores/workspaceTreeHelpers'
import type { WorkspaceLeaf, WorkspaceTabs, WorkspaceSplit } from '../../stores/types'

function makeLeaf(id: string): WorkspaceLeaf {
  return { type: 'leaf', id, viewState: { type: 'test', state: {} }, pinned: false }
}

function makeTabs(id: string, leafIds: string[], activeIdx = 0): WorkspaceTabs {
  const children = leafIds.map(makeLeaf)
  return { type: 'tabs', id, activeLeafId: children[activeIdx]?.id ?? null, children }
}

describe('removeLeafFromTree', () => {
  it('removes a leaf from a tabs node and keeps remaining', () => {
    const tabs = makeTabs('t1', ['a', 'b', 'c'])
    const result = removeLeafFromTree(tabs, 'b') as WorkspaceTabs
    expect(result.children.map(l => l.id)).toEqual(['a', 'c'])
  })

  it('returns null when tabs becomes empty', () => {
    const tabs = makeTabs('t1', ['a'])
    expect(removeLeafFromTree(tabs, 'a')).toBeNull()
  })

  it('collapses a split when one side empties', () => {
    const split: WorkspaceSplit = {
      type: 'split', id: 's1', direction: 'horizontal',
      children: [makeTabs('t1', ['a']), makeTabs('t2', ['b'])],
    }
    const result = removeLeafFromTree(split, 'a')
    expect(result?.type).toBe('tabs')
    expect((result as WorkspaceTabs).id).toBe('t2')
  })

  it('sets activeLeafId to previous sibling when active leaf removed', () => {
    const tabs: WorkspaceTabs = { ...makeTabs('t1', ['a', 'b', 'c']), activeLeafId: 'b' }
    const result = removeLeafFromTree(tabs, 'b') as WorkspaceTabs
    expect(result.activeLeafId).toBe('a')
  })

  it('returns unchanged tree when leafId not found', () => {
    const tabs = makeTabs('t1', ['a', 'b'])
    const result = removeLeafFromTree(tabs, 'z')
    expect((result as WorkspaceTabs).children.map(l => l.id)).toEqual(['a', 'b'])
  })
})

describe('insertLeafIntoTabs', () => {
  it('appends leaf when insertBeforeLeafId is null', () => {
    const tabs = makeTabs('t1', ['a', 'b'])
    const leaf = makeLeaf('c')
    const result = insertLeafIntoTabs(tabs, 't1', leaf, null) as WorkspaceTabs
    expect(result.children.map(l => l.id)).toEqual(['a', 'b', 'c'])
    expect(result.activeLeafId).toBe('c')
  })

  it('inserts before specified leaf', () => {
    const tabs = makeTabs('t1', ['a', 'b'])
    const leaf = makeLeaf('c')
    const result = insertLeafIntoTabs(tabs, 't1', leaf, 'b') as WorkspaceTabs
    expect(result.children.map(l => l.id)).toEqual(['a', 'c', 'b'])
  })

  it('appends when insertBeforeLeafId not found', () => {
    const tabs = makeTabs('t1', ['a', 'b'])
    const leaf = makeLeaf('c')
    const result = insertLeafIntoTabs(tabs, 't1', leaf, 'z') as WorkspaceTabs
    expect(result.children.map(l => l.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('reorderLeafInTabsTree', () => {
  it('moves a leaf to before another', () => {
    const tabs = makeTabs('t1', ['a', 'b', 'c'])
    const result = reorderLeafInTabsTree(tabs, 't1', 'c', 'a') as WorkspaceTabs
    expect(result.children.map(l => l.id)).toEqual(['c', 'a', 'b'])
  })

  it('appends when insertBeforeLeafId is null', () => {
    const tabs = makeTabs('t1', ['a', 'b', 'c'])
    const result = reorderLeafInTabsTree(tabs, 't1', 'a', null) as WorkspaceTabs
    expect(result.children.map(l => l.id)).toEqual(['b', 'c', 'a'])
  })

  it('no-ops when leaf not in tabs', () => {
    const tabs = makeTabs('t1', ['a', 'b'])
    const result = reorderLeafInTabsTree(tabs, 't1', 'z', null) as WorkspaceTabs
    expect(result.children.map(l => l.id)).toEqual(['a', 'b'])
  })
})

describe('splitTabsWithLeaf', () => {
  it('splits right: horizontal split, new tabs on right', () => {
    const tabs = makeTabs('t1', ['a'])
    const leaf = makeLeaf('b')
    const result = splitTabsWithLeaf(tabs, 't1', leaf, 'right') as WorkspaceSplit
    expect(result.type).toBe('split')
    expect(result.direction).toBe('horizontal')
    expect((result.children[0] as WorkspaceTabs).id).toBe('t1')
    expect((result.children[1] as WorkspaceTabs).children[0].id).toBe('b')
  })

  it('splits left: horizontal split, new tabs on left', () => {
    const tabs = makeTabs('t1', ['a'])
    const leaf = makeLeaf('b')
    const result = splitTabsWithLeaf(tabs, 't1', leaf, 'left') as WorkspaceSplit
    expect((result.children[0] as WorkspaceTabs).children[0].id).toBe('b')
    expect((result.children[1] as WorkspaceTabs).id).toBe('t1')
  })

  it('splits bottom: vertical split, new tabs below', () => {
    const tabs = makeTabs('t1', ['a'])
    const leaf = makeLeaf('b')
    const result = splitTabsWithLeaf(tabs, 't1', leaf, 'bottom') as WorkspaceSplit
    expect(result.direction).toBe('vertical')
    expect((result.children[0] as WorkspaceTabs).id).toBe('t1')
    expect((result.children[1] as WorkspaceTabs).children[0].id).toBe('b')
  })
})
