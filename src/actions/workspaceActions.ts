import { produce } from 'solid-js/store'
import { globalStore, setGlobalStore, ROOT_TABS_ID } from '../stores/globalStore'
import { setRuntimeStore } from '../stores/runtimeStore'
import { getView, getFileViewForExt } from '../lib/viewRegistry'
import type { WorkspaceNode, WorkspaceTabs, WorkspaceLeaf, ViewState } from '../stores/types'

// ── Tree helpers ─────────────────────────────────────────────────────────────

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
  createLeaf(tabsId: string, viewState: ViewState): string {
    const leafId = crypto.randomUUID()
    const leaf: WorkspaceLeaf = { type: 'leaf', id: leafId, viewState, pinned: false }
    setGlobalStore('workspace', 'main', root =>
      mapNode(root, tabsId, node => {
        const tabs = node as WorkspaceTabs
        return { ...tabs, children: [...tabs.children, leaf], activeLeafId: leafId }
      }),
    )
    setGlobalStore('workspace', 'activeLeafId', leafId)
    return leafId
  },

  closeLeaf(leafId: string): void {
    const main = globalStore.workspace.main
    const parentTabs = findParentTabs(main, leafId)
    if (!parentTabs) return
    const remaining = parentTabs.children.filter(l => l.id !== leafId)
    const nextActiveId =
      parentTabs.activeLeafId === leafId
        ? (remaining[remaining.length - 1]?.id ?? null)
        : parentTabs.activeLeafId
    setGlobalStore('workspace', 'main', root =>
      mapNode(root, parentTabs.id, node => ({
        ...(node as WorkspaceTabs),
        children: remaining,
        activeLeafId: nextActiveId,
      })),
    )
    if (globalStore.workspace.activeLeafId === leafId) {
      setGlobalStore('workspace', 'activeLeafId', nextActiveId)
    }
    setRuntimeStore('leafInstances', produce(s => { delete s[leafId] }))
  },

  activateLeaf(leafId: string): void {
    setGlobalStore('workspace', 'activeLeafId', leafId)
    const parentTabs = findParentTabs(globalStore.workspace.main, leafId)
    if (parentTabs) {
      setGlobalStore('workspace', 'main', root =>
        mapNode(root, parentTabs.id, node => ({
          ...(node as WorkspaceTabs),
          activeLeafId: leafId,
        })),
      )
    }
  },

  setLeafViewState(leafId: string, viewState: ViewState): void {
    setGlobalStore('workspace', 'main', root =>
      mapNode(root, leafId, node => ({ ...(node as WorkspaceLeaf), viewState })),
    )
  },

  setLeafPinned(leafId: string, pinned: boolean): void {
    setGlobalStore('workspace', 'main', root =>
      mapNode(root, leafId, node => ({ ...(node as WorkspaceLeaf), pinned })),
    )
  },

  splitLeaf(leafId: string, direction: 'horizontal' | 'vertical'): string {
    const newTabsId = crypto.randomUUID()
    const newLeafId = crypto.randomUUID()
    const parentTabs = findParentTabs(globalStore.workspace.main, leafId)
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
    setGlobalStore('workspace', 'main', root =>
      mapNode(root, parentTabs.id, () => splitNode),
    )
    setGlobalStore('workspace', 'activeLeafId', newLeafId)
    return newLeafId
  },

  openPage(type: string): void {
    const def = getView(type)
    if (!def || def.kind !== 'page') return
    const main = globalStore.workspace.main
    if (main.type === 'tabs') {
      const existing = main.children.find(l => l.viewState.type === type)
      if (existing) { workspaceActions.activateLeaf(existing.id); return }
    }
    workspaceActions.createLeaf(ROOT_TABS_ID, { type, state: {} })
  },

  toggleLeft(): void {
    setGlobalStore('workspace', 'left', 'collapsed', v => !v)
  },

  toggleRight(): void {
    setGlobalStore('workspace', 'right', 'collapsed', v => !v)
  },

  resizeSidebar(side: 'left' | 'right', width: number): void {
    setGlobalStore('workspace', side, 'width', width)
  },

  setLeftPanelView(type: string): void {
    setGlobalStore('workspace', 'leftPanelView', type)
  },

  setRightPanelView(type: string): void {
    setGlobalStore('workspace', 'rightPanelView', type)
  },

  clearAllLeaves(): void {
    setGlobalStore('workspace', 'main', {
      type: 'tabs',
      id: ROOT_TABS_ID,
      activeLeafId: null,
      children: [],
    })
    setGlobalStore('workspace', 'activeLeafId', null)
    setRuntimeStore('leafInstances', {})
  },

  renameLeafPath(oldPath: string, newPath: string): void {
    const ext = newPath.slice(newPath.lastIndexOf('.')).toLowerCase()
    const def = getFileViewForExt(ext)
    const newType = def?.type ?? 'markdown'
    setGlobalStore('workspace', 'main', root => {
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
}
