import type { WorkspaceLeaf, WorkspaceTabs, WorkspaceSplit, WorkspaceNode, ViewState } from './types'

export function mapNode(
  root: WorkspaceNode,
  id: string,
  updater: (n: WorkspaceNode) => WorkspaceNode,
): WorkspaceNode {
  if ((root as { id: string }).id === id) return updater(root)
  if (root.type === 'split') {
    return { ...root, children: root.children.map(c => mapNode(c, id, updater)) }
  }
  if (root.type === 'tabs') {
    return {
      ...root,
      children: root.children.map(c => c.id === id ? (updater(c) as WorkspaceLeaf) : c),
    }
  }
  return root
}

export function patchLeafViewState(
  nodes: WorkspaceNode[],
  leafId: string,
  viewState: ViewState,
): boolean {
  for (const node of nodes) {
    if (node.type === 'leaf' && node.id === leafId) {
      (node as WorkspaceLeaf).viewState = viewState
      return true
    }
    if (node.type === 'tabs') {
      const leaf = node.children.find(c => c.id === leafId)
      if (leaf) { leaf.viewState = viewState; return true }
    }
    if (node.type === 'split') {
      if (patchLeafViewState(node.children, leafId, viewState)) return true
    }
  }
  return false
}

export function findTabsById(root: WorkspaceNode, tabsId: string): WorkspaceTabs | null {
  if (root.type === 'tabs' && root.id === tabsId) return root
  if (root.type === 'split') {
    for (const child of root.children) {
      const found = findTabsById(child, tabsId)
      if (found) return found
    }
  }
  return null
}

export function findParentTabs(root: WorkspaceNode, leafId: string): WorkspaceTabs | null {
  if (root.type === 'tabs') {
    if (root.children.some(l => l.id === leafId)) return root
    return null
  }
  if (root.type === 'split') {
    for (const child of root.children) {
      const found = findParentTabs(child, leafId)
      if (found) return found
    }
  }
  return null
}

function removeLeafHelper(root: WorkspaceNode, leafId: string): WorkspaceNode | null {
  if (root.type === 'leaf') return root

  if (root.type === 'tabs') {
    const idx = root.children.findIndex(l => l.id === leafId)
    if (idx === -1) return root
    const remaining = root.children.filter(l => l.id !== leafId)
    if (remaining.length === 0) return null
    const nextActive = root.activeLeafId === leafId
      ? (remaining[Math.max(0, idx - 1)]?.id ?? null)
      : root.activeLeafId
    return { ...root, children: remaining, activeLeafId: nextActive }
  }

  if (root.type === 'split') {
    const newChildren = root.children.map(c => removeLeafHelper(c, leafId))
    const alive = newChildren.filter((c): c is WorkspaceNode => c !== null)
    if (alive.length === 0) return null
    if (alive.length === 1) return alive[0]
    return { ...root, children: alive }
  }

  return root
}

export function removeLeafFromTree(root: WorkspaceNode, leafId: string): WorkspaceNode | null {
  return removeLeafHelper(root, leafId)
}

export function insertLeafIntoTabs(
  root: WorkspaceNode,
  tabsId: string,
  leaf: WorkspaceLeaf,
  insertBeforeLeafId: string | null,
): WorkspaceNode {
  return mapNode(root, tabsId, (node) => {
    const tabs = node as WorkspaceTabs
    let newChildren: WorkspaceLeaf[]
    if (insertBeforeLeafId === null) {
      newChildren = [...tabs.children, leaf]
    } else {
      const idx = tabs.children.findIndex(l => l.id === insertBeforeLeafId)
      newChildren = idx === -1
        ? [...tabs.children, leaf]
        : [...tabs.children.slice(0, idx), leaf, ...tabs.children.slice(idx)]
    }
    return { ...tabs, children: newChildren, activeLeafId: leaf.id }
  })
}

export function reorderLeafInTabsTree(
  root: WorkspaceNode,
  tabsId: string,
  leafId: string,
  insertBeforeLeafId: string | null,
): WorkspaceNode {
  return mapNode(root, tabsId, (node) => {
    const tabs = node as WorkspaceTabs
    const leaf = tabs.children.find(l => l.id === leafId)
    if (!leaf) return tabs
    const without = tabs.children.filter(l => l.id !== leafId)
    let newChildren: WorkspaceLeaf[]
    if (insertBeforeLeafId === null) {
      newChildren = [...without, leaf]
    } else {
      const idx = without.findIndex(l => l.id === insertBeforeLeafId)
      newChildren = idx === -1
        ? [...without, leaf]
        : [...without.slice(0, idx), leaf, ...without.slice(idx)]
    }
    return { ...tabs, children: newChildren }
  })
}

export function splitTabsWithLeaf(
  root: WorkspaceNode,
  targetTabsId: string,
  leaf: WorkspaceLeaf,
  side: 'left' | 'right' | 'bottom',
): WorkspaceNode {
  const newTabs: WorkspaceTabs = {
    type: 'tabs',
    id: crypto.randomUUID(),
    activeLeafId: leaf.id,
    children: [leaf],
  }
  return mapNode(root, targetTabsId, (node) => {
    const direction = side === 'bottom' ? 'vertical' : 'horizontal'
    const children: WorkspaceNode[] = side === 'left' ? [newTabs, node] : [node, newTabs]
    return { type: 'split', id: crypto.randomUUID(), direction, children } as WorkspaceSplit
  })
}
