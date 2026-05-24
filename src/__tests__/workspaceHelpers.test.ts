import { describe, it, expect } from 'vitest'
import { findLeafInTree, findLeafInRoot } from '../stores/globalStore'
import type { WorkspaceRoot, WorkspaceLeaf, WorkspaceTabs, WorkspaceSplit } from '../stores/types'

const makeLeaf = (id: string, type = 'markdown'): WorkspaceLeaf => ({
  type: 'leaf', id, viewState: { type, state: {} }, pinned: false,
})

const makeTabs = (id: string, leaves: WorkspaceLeaf[]): WorkspaceTabs => ({
  type: 'tabs', id, activeLeafId: leaves[0]?.id ?? null, children: leaves,
})

const makeSplit = (id: string, children: (WorkspaceTabs | WorkspaceSplit)[]): WorkspaceSplit => ({
  type: 'split', id, direction: 'vertical', children,
})

describe('findLeafInTree', () => {
  it('finds a leaf directly', () => {
    const leaf = makeLeaf('a')
    expect(findLeafInTree(leaf, 'a')).toBe(leaf)
  })

  it('returns null for wrong id on leaf', () => {
    expect(findLeafInTree(makeLeaf('a'), 'b')).toBeNull()
  })

  it('finds a leaf inside a tabs node', () => {
    const leaf = makeLeaf('x')
    const tabs = makeTabs('t1', [leaf])
    expect(findLeafInTree(tabs, 'x')).toBe(leaf)
  })

  it('returns null when leaf not in tabs', () => {
    const tabs = makeTabs('t1', [makeLeaf('x')])
    expect(findLeafInTree(tabs, 'y')).toBeNull()
  })

  it('finds a leaf inside a nested split', () => {
    const leaf = makeLeaf('deep')
    const tabs = makeTabs('t', [leaf])
    const split = makeSplit('s', [makeTabs('t2', [makeLeaf('other')]), tabs])
    expect(findLeafInTree(split, 'deep')).toBe(leaf)
  })
})

describe('findLeafInRoot', () => {
  const leftLeaf = makeLeaf('left-1', 'files')
  const mainLeaf = makeLeaf('main-1', 'markdown')
  const rightLeaf = makeLeaf('right-1', 'links')

  const root: WorkspaceRoot = {
    left:  { id: 'l', width: 190, collapsed: false, children: [makeTabs('lt', [leftLeaf])] },
    main:  makeTabs('mt', [mainLeaf]),
    right: { id: 'r', width: 200, collapsed: false, children: [makeTabs('rt', [rightLeaf])] },
  }

  it('finds a leaf in the left sidebar', () => {
    expect(findLeafInRoot(root, 'left-1')).toBe(leftLeaf)
  })

  it('finds a leaf in main', () => {
    expect(findLeafInRoot(root, 'main-1')).toBe(mainLeaf)
  })

  it('finds a leaf in the right sidebar', () => {
    expect(findLeafInRoot(root, 'right-1')).toBe(rightLeaf)
  })

  it('returns null for unknown id', () => {
    expect(findLeafInRoot(root, 'ghost')).toBeNull()
  })
})
