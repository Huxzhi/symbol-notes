import { produce } from 'solid-js/store'
import {
  globalStore, setGlobalStore, ROOT_TABS_ID, activeLayout,
} from '../stores/globalStore'
import { setRuntimeStore } from '../stores/runtimeStore'
import { getView, getFileViewForExt } from '../lib/viewRegistry'
import type {
  WorkspaceNode, WorkspaceTabs, WorkspaceLeaf, ViewState, WorkspaceLayout,
} from '../stores/types'

// ── Internal helpers ─────────────────────────────────────────────────────────

function layoutIdx(): number {
  return globalStore.workspace.layouts.findIndex(
    l => l.id === globalStore.workspace.activeLayoutId,
  )
}

function findParentTabs(root: WorkspaceNode, leafId: string): WorkspaceTabs | null {
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

function mapNode(
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
      children: root.children.map(c =>
        c.id === id ? updater(c) as WorkspaceLeaf : c,
      ),
    }
  }
  return root
}

// ── Actions ──────────────────────────────────────────────────────────────────

export const workspaceActions = {

  // ── Main area leaf operations ──────────────────────────────────────────────

  createLeaf(tabsId: string, viewState: ViewState): string {
    const idx = layoutIdx()
    const leafId = crypto.randomUUID()
    const leaf: WorkspaceLeaf = { type: 'leaf', id: leafId, viewState, pinned: false }
    setGlobalStore('workspace', 'layouts', idx, 'root', 'main', root =>
      mapNode(root, tabsId, node => {
        const tabs = node as WorkspaceTabs
        return { ...tabs, children: [...tabs.children, leaf], activeLeafId: leafId }
      }),
    )
    setGlobalStore('workspace', 'layouts', idx, 'activeLeafId', leafId)
    return leafId
  },

  closeLeaf(leafId: string): void {
    const idx = layoutIdx()
    const main = activeLayout().root.main
    const parentTabs = findParentTabs(main, leafId)
    if (!parentTabs) return
    const remaining = parentTabs.children.filter(l => l.id !== leafId)
    const nextActiveId =
      parentTabs.activeLeafId === leafId
        ? (remaining[remaining.length - 1]?.id ?? null)
        : parentTabs.activeLeafId
    setGlobalStore('workspace', 'layouts', idx, 'root', 'main', root =>
      mapNode(root, parentTabs.id, node => ({
        ...(node as WorkspaceTabs),
        children: remaining,
        activeLeafId: nextActiveId,
      })),
    )
    if (activeLayout().activeLeafId === leafId) {
      setGlobalStore('workspace', 'layouts', idx, 'activeLeafId', nextActiveId)
    }
    setRuntimeStore('leafInstances', produce(s => { delete s[leafId] }))
  },

  activateLeaf(leafId: string): void {
    const idx = layoutIdx()
    setGlobalStore('workspace', 'layouts', idx, 'activeLeafId', leafId)
    const parentTabs = findParentTabs(activeLayout().root.main, leafId)
    if (parentTabs) {
      setGlobalStore('workspace', 'layouts', idx, 'root', 'main', root =>
        mapNode(root, parentTabs.id, node => ({
          ...(node as WorkspaceTabs),
          activeLeafId: leafId,
        })),
      )
    }
  },

  setLeafViewState(leafId: string, viewState: ViewState): void {
    const idx = layoutIdx()
    setGlobalStore('workspace', 'layouts', idx, 'root', 'main', root =>
      mapNode(root, leafId, node => ({ ...(node as WorkspaceLeaf), viewState })),
    )
  },

  setLeafPinned(leafId: string, pinned: boolean): void {
    const idx = layoutIdx()
    setGlobalStore('workspace', 'layouts', idx, 'root', 'main', root =>
      mapNode(root, leafId, node => ({ ...(node as WorkspaceLeaf), pinned })),
    )
  },

  splitLeaf(leafId: string, direction: 'horizontal' | 'vertical'): string {
    const idx = layoutIdx()
    const newTabsId = crypto.randomUUID()
    const newLeafId = crypto.randomUUID()
    const parentTabs = findParentTabs(activeLayout().root.main, leafId)
    if (!parentTabs) return newLeafId

    const newTabs: WorkspaceTabs = {
      type: 'tabs',
      id: newTabsId,
      activeLeafId: newLeafId,
      children: [{ type: 'leaf', id: newLeafId, viewState: { type: '', state: {} }, pinned: false }],
    }
    const splitNode: WorkspaceNode = {
      type: 'split',
      id: crypto.randomUUID(),
      direction,
      children: [parentTabs, newTabs],
    }
    setGlobalStore('workspace', 'layouts', idx, 'root', 'main', root =>
      mapNode(root, parentTabs.id, () => splitNode),
    )
    setGlobalStore('workspace', 'layouts', idx, 'activeLeafId', newLeafId)
    return newLeafId
  },

  openPage(type: string): void {
    const def = getView(type)
    if (!def || def.kind !== 'page') return
    const main = activeLayout().root.main
    if (main.type === 'tabs') {
      const existing = main.children.find(l => l.viewState.type === type)
      if (existing) { workspaceActions.activateLeaf(existing.id); return }
    }
    workspaceActions.createLeaf(ROOT_TABS_ID, { type, state: {} })
  },

  clearAllLeaves(): void {
    const idx = layoutIdx()
    setGlobalStore('workspace', 'layouts', idx, 'root', 'main', {
      type: 'tabs',
      id: ROOT_TABS_ID,
      activeLeafId: null,
      children: [],
    })
    setGlobalStore('workspace', 'layouts', idx, 'activeLeafId', null)
    setRuntimeStore('leafInstances', {})
  },

  renameLeafPath(oldPath: string, newPath: string): void {
    const idx = layoutIdx()
    const ext = newPath.slice(newPath.lastIndexOf('.')).toLowerCase()
    const def = getFileViewForExt(ext)
    const newType = def?.type ?? 'markdown'
    setGlobalStore('workspace', 'layouts', idx, 'root', 'main', root => {
      function walk(node: WorkspaceNode): WorkspaceNode {
        if (node.type === 'leaf' && node.viewState.state.file === oldPath) {
          return { ...node, viewState: { type: newType, state: { file: newPath } } }
        }
        if (node.type === 'tabs') {
          return { ...node, children: node.children.map(walk) as WorkspaceLeaf[] }
        }
        if (node.type === 'split') {
          return { ...node, children: node.children.map(walk) }
        }
        return node
      }
      return walk(root)
    })
  },

  // ── Sidebar operations ─────────────────────────────────────────────────────

  toggleSidebar(side: 'left' | 'right'): void {
    const idx = layoutIdx()
    setGlobalStore('workspace', 'layouts', idx, 'root', side, 'collapsed', (v: boolean) => !v)
  },

  resizeSidebar(side: 'left' | 'right', width: number): void {
    const idx = layoutIdx()
    setGlobalStore('workspace', 'layouts', idx, 'root', side, 'width', width)
  },

  // Activate a panel leaf within a sidebar tabs group (known side)
  activateSidebarLeaf(side: 'left' | 'right', leafId: string): void {
    const idx = layoutIdx()
    const children = activeLayout().root[side].children
    setGlobalStore(
      'workspace', 'layouts', idx, 'root', side, 'children',
      children.map(node => {
        if (node.type === 'tabs' && node.children.some(l => l.id === leafId)) {
          return { ...node, activeLeafId: leafId }
        }
        return node
      }),
    )
  },

  // Activate a panel leaf by id — searches left then right sidebar
  activateSidebarLeafById(leafId: string): void {
    const idx = layoutIdx()
    const root = activeLayout().root
    for (const side of ['left', 'right'] as const) {
      const children = root[side].children
      const hasLeaf = children.some(
        node => node.type === 'tabs' && node.children.some(l => l.id === leafId),
      )
      if (hasLeaf) {
        setGlobalStore(
          'workspace', 'layouts', idx, 'root', side, 'children',
          children.map(node => {
            if (node.type === 'tabs' && node.children.some(l => l.id === leafId)) {
              return { ...node, activeLeafId: leafId }
            }
            return node
          }),
        )
        return
      }
    }
  },

  // Split a sidebar tabs group — inserts a new empty tabs group below (vertical stack)
  splitSidebarLeaf(side: 'left' | 'right', leafId: string): string {
    const idx = layoutIdx()
    const newLeafId = crypto.randomUUID()
    const newTabs: WorkspaceTabs = {
      type: 'tabs',
      id: crypto.randomUUID(),
      activeLeafId: newLeafId,
      children: [{ type: 'leaf', id: newLeafId, viewState: { type: '', state: {} }, pinned: false }],
    }
    const children = activeLayout().root[side].children
    setGlobalStore(
      'workspace', 'layouts', idx, 'root', side, 'children',
      children.flatMap(node => {
        if (node.type === 'tabs' && node.children.some(l => l.id === leafId)) {
          return [node, newTabs]
        }
        return [node]
      }),
    )
    return newLeafId
  },

  // ── Layout (workspace) operations ─────────────────────────────────────────

  createLayout(name: string): string {
    const newId = crypto.randomUUID()
    const current = activeLayout()
    const newLayout: WorkspaceLayout = {
      id: newId,
      name,
      root: {
        left: {
          ...current.root.left,
          id: crypto.randomUUID(),
          children: current.root.left.children.map(n => ({ ...n })),
        },
        main: { type: 'tabs', id: ROOT_TABS_ID, activeLeafId: null, children: [] },
        right: {
          ...current.root.right,
          id: crypto.randomUUID(),
          children: current.root.right.children.map(n => ({ ...n })),
        },
      },
      activeLeafId: null,
    }
    setGlobalStore('workspace', 'layouts', (ls: WorkspaceLayout[]) => [...ls, newLayout])
    setGlobalStore('workspace', 'activeLayoutId', newId)
    return newId
  },

  switchLayout(id: string): void {
    setGlobalStore('workspace', 'activeLayoutId', id)
  },

  renameLayout(id: string, name: string): void {
    const idx = globalStore.workspace.layouts.findIndex(l => l.id === id)
    if (idx === -1) return
    setGlobalStore('workspace', 'layouts', idx, 'name', name)
  },

  deleteLayout(id: string): void {
    if (globalStore.workspace.layouts.length <= 1) return
    const remaining = globalStore.workspace.layouts.filter(l => l.id !== id)
    const newActiveId =
      globalStore.workspace.activeLayoutId === id
        ? remaining[0].id
        : globalStore.workspace.activeLayoutId
    setGlobalStore('workspace', 'layouts', remaining)
    setGlobalStore('workspace', 'activeLayoutId', newActiveId)
  },
}
