import { createRoot, createEffect } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import { loadFromStorage, saveToStorage } from '../lib/localStorage'
import { getFileViewForExt, getView } from '../lib/pluginRegistry'
import { setRuntimeStore } from './runtimeStore'
import {
  mapNode,
  findParentTabs,
  findTabsById,
  removeLeafFromTree,
  insertLeafIntoTabs,
  reorderLeafInTabsTree,
  splitTabsWithLeaf,
} from './workspaceTreeHelpers'
import type {
  ViewState,
  WorkspaceLayout,
  WorkspaceLeaf,
  WorkspaceNode,
  WorkspaceRoot,
  WorkspaceState,
  WorkspaceTabs,
} from './types'

export const ROOT_TABS_ID = 'root-tabs'
export const DEFAULT_LAYOUT_ID = 'default'

const initialLayout: WorkspaceLayout = {
  id: DEFAULT_LAYOUT_ID,
  name: '默认',
  root: {
    left: {
      id: 'left-root',
      width: 190,
      collapsed: false,
      children: [{
        type: 'tabs',
        id: 'left-tabs',
        activeLeafId: 'leaf-files',
        children: [
          { type: 'leaf', id: 'leaf-files', viewState: { type: 'files', state: {} }, pinned: false },
          { type: 'leaf', id: 'leaf-calendar-panel', viewState: { type: 'calendar-panel', state: {} }, pinned: false },
        ],
      }],
    },
    main: { type: 'tabs', id: ROOT_TABS_ID, activeLeafId: null, children: [] },
    right: {
      id: 'right-root',
      width: 200,
      collapsed: false,
      children: [{
        type: 'tabs',
        id: 'right-tabs',
        activeLeafId: 'leaf-links',
        children: [
          { type: 'leaf', id: 'leaf-links',   viewState: { type: 'links',   state: {} }, pinned: false },
          { type: 'leaf', id: 'leaf-outline', viewState: { type: 'outline', state: {} }, pinned: false },
          { type: 'leaf', id: 'leaf-tags',    viewState: { type: 'tags',    state: {} }, pinned: false },
        ],
      }],
    },
  },
  activeLeafId: null,
}

const defaultWorkspace: WorkspaceState = {
  layouts: { [DEFAULT_LAYOUT_ID]: initialLayout },
  activeLayoutId: DEFAULT_LAYOUT_ID,
}

const savedWs = loadFromStorage<WorkspaceState>(
  'sn-workspace',
  defaultWorkspace,
  (v) =>
    typeof v === 'object' && v !== null &&
    typeof (v as Record<string, unknown>).layouts === 'object' &&
    !Array.isArray((v as Record<string, unknown>).layouts) &&
    typeof (v as Record<string, unknown>).activeLayoutId === 'string',
)

const [workspaceStore, setWorkspaceStore] = createStore<WorkspaceState>({
  layouts: savedWs.layouts,
  activeLayoutId: savedWs.activeLayoutId,
})

createRoot(() => {
  createEffect(() =>
    saveToStorage('sn-workspace', {
      layouts: workspaceStore.layouts,
      activeLayoutId: workspaceStore.activeLayoutId,
    }),
  )
})

// ── Selectors ────────────────────────────────────────────────────────────────

export function activeLayout(): WorkspaceLayout {
  return workspaceStore.layouts[workspaceStore.activeLayoutId]
}

export function getLeafsByType(type: string): string[] {
  const results: string[] = []
  function walk(node: WorkspaceNode) {
    if (node.type === 'leaf' && node.viewState.type === type) results.push(node.id)
    else if (node.type === 'tabs') node.children.forEach(walk)
    else if (node.type === 'split') node.children.forEach(walk)
  }
  walk(activeRoot().main)
  return results
}

export function activeSidebarType(side: 'left' | 'right'): string | null {
  const sidebar = activeRoot()[side]
  if (sidebar.collapsed) return null
  for (const node of sidebar.children) {
    if (node.type === 'tabs' && (node as WorkspaceTabs).activeLeafId) {
      const tabs = node as WorkspaceTabs
      const leaf = tabs.children.find(l => l.id === tabs.activeLeafId)
      if (leaf) return leaf.viewState.type
    }
  }
  return null
}

export function layoutList(): WorkspaceLayout[] {
  return Object.values(workspaceStore.layouts)
}

export function activeRoot(): WorkspaceRoot {
  return activeLayout().root
}

export function findLeafInTree(node: WorkspaceNode, leafId: string): WorkspaceLeaf | null {
  if (node.type === 'leaf') return node.id === leafId ? node : null
  if (node.type === 'tabs') return node.children.find(l => l.id === leafId) ?? null
  for (const child of (node as { children: WorkspaceNode[] }).children) {
    const found = findLeafInTree(child, leafId)
    if (found) return found
  }
  return null
}

export function findLeafInRoot(root: WorkspaceRoot, leafId: string): WorkspaceLeaf | null {
  for (const child of root.left.children) {
    const found = findLeafInTree(child, leafId)
    if (found) return found
  }
  const mainFound = findLeafInTree(root.main, leafId)
  if (mainFound) return mainFound
  for (const child of root.right.children) {
    const found = findLeafInTree(child, leafId)
    if (found) return found
  }
  return null
}

export function activeFilePath(): string | null {
  const layout = activeLayout()
  if (!layout.activeLeafId) return null
  const leaf = findLeafInTree(layout.root.main, layout.activeLeafId)
  return (leaf?.viewState.state.file as string | undefined) ?? null
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function findLeafWithFile(root: WorkspaceNode, path: string): WorkspaceLeaf | null {
  if (root.type === 'leaf' && root.viewState.state.file === path) return root
  if (root.type === 'tabs') return root.children.find(l => l.viewState.state.file === path) ?? null
  if (root.type === 'split') {
    for (const child of root.children) {
      const found = findLeafWithFile(child, path)
      if (found) return found
    }
  }
  return null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const setLayout = (...args: any[]) => (setWorkspaceStore as any)('layouts', workspaceStore.activeLayoutId, ...args)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const setRoot = (...args: any[]) => setLayout('root', ...args)

// ── Actions ──────────────────────────────────────────────────────────────────

export const workspaceActions = {
  createLeaf(tabsId: string, viewState: ViewState): string {
    const leafId = crypto.randomUUID()
    const leaf: WorkspaceLeaf = { type: 'leaf', id: leafId, viewState, pinned: false }
    setRoot('main', (root: WorkspaceNode) =>
      mapNode(root, tabsId, (node) => {
        const tabs = node as WorkspaceTabs
        return { ...tabs, children: [...tabs.children, leaf], activeLeafId: leafId }
      }),
    )
    setLayout('activeLeafId', leafId)
    return leafId
  },

  closeLeaf(leafId: string): void {
    const main = activeLayout().root.main
    const parentTabs = findParentTabs(main, leafId)
    if (!parentTabs) return
    const remaining = parentTabs.children.filter(l => l.id !== leafId)
    const nextActiveId =
      parentTabs.activeLeafId === leafId
        ? (remaining[remaining.length - 1]?.id ?? null)
        : parentTabs.activeLeafId
    setRoot('main', (root: WorkspaceNode) =>
      mapNode(root, parentTabs.id, (node) => ({
        ...(node as WorkspaceTabs),
        children: remaining,
        activeLeafId: nextActiveId,
      })),
    )
    if (activeLayout().activeLeafId === leafId) setLayout('activeLeafId', nextActiveId)
    setRuntimeStore('leafInstances', produce((s) => { delete s[leafId] }))
  },

  closeOtherLeaves(tabsId: string, keepLeafId: string): void {
    const tabs = findTabsById(activeLayout().root.main, tabsId)
    if (!tabs) return
    const toRemove = tabs.children.filter(l => l.id !== keepLeafId)
    const keep = tabs.children.find(l => l.id === keepLeafId)
    if (!keep) return
    setRoot('main', (root: WorkspaceNode) =>
      mapNode(root, tabsId, (node) => ({
        ...(node as WorkspaceTabs),
        children: [keep],
        activeLeafId: keepLeafId,
      })),
    )
    setLayout('activeLeafId', keepLeafId)
    setRuntimeStore('leafInstances', produce((s) => { for (const l of toRemove) delete s[l.id] }))
  },

  closeRightLeaves(tabsId: string, leafId: string): void {
    const tabs = findTabsById(activeLayout().root.main, tabsId)
    if (!tabs) return
    const idx = tabs.children.findIndex(l => l.id === leafId)
    if (idx === -1) return
    const toRemove = tabs.children.slice(idx + 1)
    if (toRemove.length === 0) return
    const removedIds = new Set(toRemove.map(l => l.id))
    const currentActiveId = activeLayout().activeLeafId ?? ''
    const nextActiveId = removedIds.has(currentActiveId) ? leafId : currentActiveId
    setRoot('main', (root: WorkspaceNode) =>
      mapNode(root, tabsId, (node) => ({
        ...(node as WorkspaceTabs),
        children: (node as WorkspaceTabs).children.slice(0, idx + 1),
        activeLeafId: nextActiveId,
      })),
    )
    if (removedIds.has(currentActiveId)) setLayout('activeLeafId', leafId)
    setRuntimeStore('leafInstances', produce((s) => { for (const l of toRemove) delete s[l.id] }))
  },

  activateLeaf(leafId: string): void {
    setLayout('activeLeafId', leafId)
    const parentTabs = findParentTabs(activeLayout().root.main, leafId)
    if (parentTabs) {
      setRoot('main', (root: WorkspaceNode) =>
        mapNode(root, parentTabs.id, (node) => ({
          ...(node as WorkspaceTabs),
          activeLeafId: leafId,
        })),
      )
    }
  },

  setLeafViewState(leafId: string, viewState: ViewState): void {
    const root = activeLayout().root
    const update = (n: WorkspaceNode) => ({ ...(n as WorkspaceLeaf), viewState })
    type Area = [nodes: WorkspaceNode[], save: (updated: WorkspaceNode[]) => void]
    const areas: Area[] = [
      [[root.main], ([n]) => setRoot('main', n)],
      [root.left.children, (cs) => setRoot('left', 'children', cs)],
      [root.right.children, (cs) => setRoot('right', 'children', cs)],
    ]
    for (const [nodes, save] of areas) {
      if (nodes.some(n => findLeafInTree(n, leafId))) {
        save(nodes.map(n => mapNode(n, leafId, update)))
        return
      }
    }
  },

  setLeafPinned(leafId: string, pinned: boolean): void {
    setRoot('main', (root: WorkspaceNode) =>
      mapNode(root, leafId, (node) => ({ ...(node as WorkspaceLeaf), pinned })),
    )
  },

  splitLeaf(leafId: string, direction: 'horizontal' | 'vertical'): string {
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
    setRoot('main', (root: WorkspaceNode) => mapNode(root, parentTabs.id, () => splitNode))
    setLayout('activeLeafId', newLeafId)
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

  openFile(
    path: string,
    options?: { area?: 'left' | 'main' | 'right'; newTab?: boolean; pin?: boolean },
  ): void {
    const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
    const def = getFileViewForExt(ext)
    if (!def) return
    const viewState: ViewState = { type: def.type, state: { file: path } }
    const area = options?.area ?? 'main'

    if (area === 'main') {
      const existing = findLeafWithFile(activeRoot().main, path)
      if (existing && !options?.newTab) { workspaceActions.activateLeaf(existing.id); return }
      if (!options?.newTab) {
        const layout = activeLayout()
        const activeLeafId = layout.activeLeafId
        const activeLeaf = activeLeafId ? findLeafInTree(activeRoot().main, activeLeafId) : null
        if (activeLeaf && !activeLeaf.pinned && activeLeaf.viewState.type !== 'calendar') {
          workspaceActions.setLeafViewState(activeLeafId!, viewState)
          return
        }
      }
      const leafId = workspaceActions.createLeaf(ROOT_TABS_ID, viewState)
      if (options?.pin) workspaceActions.setLeafPinned(leafId, true)
      return
    }

    const sideChildren = activeRoot()[area].children
    const firstTabs = sideChildren.find(n => n.type === 'tabs') as WorkspaceTabs | undefined
    if (!firstTabs) return
    const existing = firstTabs.children.find(l => l.viewState.state.file === path)
    if (existing && !options?.newTab) { workspaceActions.activateSidebarLeaf(area, existing.id); return }
    const leafId = crypto.randomUUID()
    const leaf: WorkspaceLeaf = { type: 'leaf', id: leafId, viewState, pinned: options?.pin ?? false }
    setRoot(
      area, 'children',
      sideChildren.map(node =>
        node === firstTabs
          ? { ...(node as WorkspaceTabs), children: [...(node as WorkspaceTabs).children, leaf], activeLeafId: leafId }
          : node,
      ),
    )
  },

  clearAllLeaves(): void {
    setRoot('main', { type: 'tabs', id: ROOT_TABS_ID, activeLeafId: null, children: [] })
    setLayout('activeLeafId', null)
    setRuntimeStore('leafInstances', {})
  },

  renameLeafPath(oldPath: string, newPath: string): void {
    const ext = newPath.slice(newPath.lastIndexOf('.')).toLowerCase()
    const def = getFileViewForExt(ext)
    const newType = def?.type ?? 'markdown'
    setRoot('main', (root: WorkspaceNode) => {
      function walk(node: WorkspaceNode): WorkspaceNode {
        if (node.type === 'leaf' && node.viewState.state.file === oldPath)
          return { ...node, viewState: { type: newType, state: { file: newPath } } }
        if (node.type === 'tabs')
          return { ...node, children: node.children.map(walk) as WorkspaceLeaf[] }
        if (node.type === 'split')
          return { ...node, children: node.children.map(walk) }
        return node
      }
      return walk(root)
    })
  },

  toggleSidebar(side: 'left' | 'right'): void {
    setRoot(side, 'collapsed', (v: boolean) => !v)
  },

  setSidebarWidth(side: 'left' | 'right', width: number): void {
    setRoot(side, 'width', width)
  },

  activateSidebarLeaf(side: 'left' | 'right', leafId: string): void {
    const children = activeLayout().root[side].children
    setRoot(side, 'children',
      children.map(node =>
        node.type === 'tabs' && node.children.some(l => l.id === leafId)
          ? { ...node, activeLeafId: leafId }
          : node,
      ),
    )
  },

  switchSidebarPanel(side: 'left' | 'right', type: string): void {
    const sidebar = activeRoot()[side]
    const isOpen = !sidebar.collapsed
    const currentType = activeSidebarType(side)
    if (currentType === type && isOpen) {
      workspaceActions.toggleSidebar(side)
      return
    }
    for (const node of sidebar.children) {
      if (node.type === 'tabs') {
        const tabs = node as WorkspaceTabs
        const leaf = tabs.children.find(l => l.viewState.type === type)
        if (leaf) { workspaceActions.activateSidebarLeaf(side, leaf.id); break }
      }
    }
    if (!isOpen) workspaceActions.toggleSidebar(side)
  },

  openSidebarPanel(area: 'left' | 'right', type: string, state: Record<string, unknown> = {}): void {
    const viewState: ViewState = { type, state }
    const sideChildren = activeRoot()[area].children
    const firstTabs = sideChildren.find(n => n.type === 'tabs') as WorkspaceTabs | undefined
    if (!firstTabs) return
    const existing = firstTabs.children.find(l => l.viewState.type === type)
    if (existing) {
      workspaceActions.setLeafViewState(existing.id, viewState)
      workspaceActions.activateSidebarLeaf(area, existing.id)
      return
    }
    const leafId = crypto.randomUUID()
    const leaf: WorkspaceLeaf = { type: 'leaf', id: leafId, viewState, pinned: false }
    setRoot(area, 'children',
      sideChildren.map(node =>
        node.type === 'tabs' && node.id === firstTabs.id
          ? { ...(node as WorkspaceTabs), children: [...firstTabs.children, leaf], activeLeafId: leafId }
          : node,
      ),
    )
  },

  activateSidebarLeafById(leafId: string): void {
    const root = activeLayout().root
    for (const side of ['left', 'right'] as const) {
      const children = root[side].children
      const hasLeaf = children.some(
        node => node.type === 'tabs' && node.children.some(l => l.id === leafId),
      )
      if (hasLeaf) {
        setRoot(side, 'children',
          children.map(node =>
            node.type === 'tabs' && node.children.some(l => l.id === leafId)
              ? { ...node, activeLeafId: leafId }
              : node,
          ),
        )
        return
      }
    }
  },

  splitSidebarLeaf(side: 'left' | 'right', leafId: string): string {
    const newLeafId = crypto.randomUUID()
    const newTabs: WorkspaceTabs = {
      type: 'tabs',
      id: crypto.randomUUID(),
      activeLeafId: newLeafId,
      children: [{ type: 'leaf', id: newLeafId, viewState: { type: '', state: {} }, pinned: false }],
    }
    const children = activeLayout().root[side].children
    setRoot(side, 'children',
      children.flatMap(node =>
        node.type === 'tabs' && node.children.some(l => l.id === leafId)
          ? [node, newTabs]
          : [node],
      ),
    )
    return newLeafId
  },

  reorderLeafInTabs(tabsId: string, leafId: string, insertBeforeLeafId: string | null): void {
    setRoot('main', (root: WorkspaceNode) =>
      reorderLeafInTabsTree(root, tabsId, leafId, insertBeforeLeafId),
    )
  },

  moveLeafToTabs(leafId: string, targetTabsId: string, insertBeforeLeafId: string | null): void {
    const root = activeLayout().root.main
    const leaf = findLeafInTree(root, leafId)
    if (!leaf) return
    const afterRemove = removeLeafFromTree(root, leafId) ??
      ({ type: 'tabs', id: ROOT_TABS_ID, activeLeafId: null, children: [] } as WorkspaceTabs)
    const updated = insertLeafIntoTabs(afterRemove, targetTabsId, leaf, insertBeforeLeafId)
    setRoot('main', updated)
    setLayout('activeLeafId', leafId)
  },

  moveLeafAsSplit(leafId: string, targetTabsId: string, side: 'left' | 'right' | 'bottom'): void {
    const root = activeLayout().root.main
    const leaf = findLeafInTree(root, leafId)
    if (!leaf) return
    const sourceTabs = findParentTabs(root, leafId)
    if (sourceTabs && sourceTabs.id === targetTabsId && sourceTabs.children.length === 1) return
    const afterRemove = removeLeafFromTree(root, leafId) ??
      ({ type: 'tabs', id: ROOT_TABS_ID, activeLeafId: null, children: [] } as WorkspaceTabs)
    const actualTargetId = findTabsById(afterRemove, targetTabsId) ? targetTabsId : ROOT_TABS_ID
    const updated = splitTabsWithLeaf(afterRemove, actualTargetId, leaf, side)
    setRoot('main', updated)
    setLayout('activeLeafId', leafId)
  },

  moveSidebarLeaf(leafId: string, fromSide: 'left' | 'right', toSide: 'left' | 'right'): void {
    const root = activeLayout().root
    let movedLeaf: WorkspaceLeaf | null = null
    const updatedFrom = root[fromSide].children.map((node) => {
      if (node.type !== 'tabs') return node
      const tabs = node as WorkspaceTabs
      const found = tabs.children.find(l => l.id === leafId)
      if (!found) return node
      movedLeaf = found
      const remaining = tabs.children.filter(l => l.id !== leafId)
      const nextActive = tabs.activeLeafId === leafId
        ? (remaining[remaining.length - 1]?.id ?? null)
        : tabs.activeLeafId
      return { ...tabs, children: remaining, activeLeafId: nextActive }
    })
    if (!movedLeaf) return
    const leaf = movedLeaf
    const updatedTo = root[toSide].children.map((node) =>
      node.type === 'tabs'
        ? { ...(node as WorkspaceTabs), children: [...(node as WorkspaceTabs).children, leaf], activeLeafId: leaf.id }
        : node,
    )
    setRoot(fromSide, 'children', updatedFrom)
    setRoot(toSide, 'children', updatedTo)
  },

  createLayout(name: string): string {
    const newId = crypto.randomUUID()
    const current = activeLayout()
    const newLayout: WorkspaceLayout = {
      id: newId,
      name,
      root: {
        left: { ...current.root.left, id: crypto.randomUUID(), children: current.root.left.children.map(n => ({ ...n })) },
        main: { type: 'tabs', id: ROOT_TABS_ID, activeLeafId: null, children: [] },
        right: { ...current.root.right, id: crypto.randomUUID(), children: current.root.right.children.map(n => ({ ...n })) },
      },
      activeLeafId: null,
    }
    setWorkspaceStore('layouts', newId, newLayout)
    setWorkspaceStore('activeLayoutId', newId)
    return newId
  },

  switchLayout(id: string): void {
    setWorkspaceStore('activeLayoutId', id)
  },

  renameLayout(id: string, name: string): void {
    if (!workspaceStore.layouts[id]) return
    setWorkspaceStore('layouts', id, 'name', name)
  },

  deleteLayout(id: string): void {
    const ids = Object.keys(workspaceStore.layouts)
    if (ids.length <= 1) return
    const newActiveId = workspaceStore.activeLayoutId === id
      ? ids.find(lid => lid !== id)!
      : workspaceStore.activeLayoutId
    setWorkspaceStore('layouts', produce((ls) => { delete ls[id] }))
    setWorkspaceStore('activeLayoutId', newActiveId)
  },
}

export { workspaceStore, setWorkspaceStore }
