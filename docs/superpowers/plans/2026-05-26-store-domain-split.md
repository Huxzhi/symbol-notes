# Store Domain Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the monolithic `globalStore` into four domain stores co-located with their actions and persistence logic, then delete `src/actions/` entirely.

**Architecture:** Create `settingsStore.ts`, `workspaceStore.ts`, `cacheStore.ts` as new files; extend `runtimeStore.ts` with appActions and fileActions; migrate all ~18 consumers; delete the old files last. New store files coexist with old ones during migration so no broken intermediate state.

**Tech Stack:** SolidJS store (`createStore`, `produce`, `reconcile`), `idb-keyval` for IndexedDB, `solid-js/store createRoot+createEffect` for reactive persistence.

---

## File Map

| Action | Path |
|--------|------|
| Create | `src/stores/settingsStore.ts` |
| Create | `src/stores/workspaceStore.ts` |
| Create | `src/stores/cacheStore.ts` |
| Modify | `src/stores/runtimeStore.ts` |
| Modify | `src/stores/types.ts` |
| Modify | `src/services/indexService.ts` |
| Modify | `src/App.tsx` |
| Modify | `src/components/Settings.tsx` |
| Modify | `src/components/viewer/EditorViewer.tsx` |
| Modify | `src/components/panels/CalendarPanel.tsx` |
| Modify | `src/components/panels/FilesPanel.tsx` |
| Modify | `src/components/panels/LinksPanel.tsx` |
| Modify | `src/components/panels/TagsPanel.tsx` |
| Modify | `src/components/panels/OutlinePanel.tsx` |
| Modify | `src/components/viewer/CalendarViewer.tsx` |
| Modify | `src/components/workspace/WorkspaceNodeRenderer.tsx` |
| Modify | `src/components/Ribbon.tsx` |
| Modify | `src/components/StatusBar.tsx` |
| Modify | `src/lib/embedExtension.ts` |
| Modify | `src/__tests__/workspaceHelpers.test.ts` |
| Delete | `src/stores/globalStore.ts` |
| Delete | `src/actions/appActions.ts` |
| Delete | `src/actions/cacheActions.ts` |
| Delete | `src/actions/fileActions.ts` |
| Delete | `src/actions/workspaceActions.ts` |

---

## Task 1: Create `settingsStore.ts`

**Files:**
- Create: `src/stores/settingsStore.ts`

- [ ] **Step 1: Verify baseline test passes**

```bash
npx vitest run
```
Expected: all tests pass (1 suite, 9 tests).

- [ ] **Step 2: Create the file**

```ts
// src/stores/settingsStore.ts
import { createRoot, createEffect } from 'solid-js'
import { createStore } from 'solid-js/store'
import { loadFromStorage, saveToStorage } from '../lib/localStorage'
import type { SettingsState, ThemeId } from './types'

const [settingsStore, setSettingsStore] = createStore<SettingsState>(
  loadFromStorage<SettingsState>('sn-settings', {
    theme: 'dark',
    customCSS: '',
    autoTimestamps: true,
    showOtherFiles: true,
  }),
)

createRoot(() => {
  createEffect(() => saveToStorage('sn-settings', { ...settingsStore }))
})

export const settingsActions = {
  setTheme(theme: ThemeId): void {
    setSettingsStore('theme', theme)
  },
  setCustomCSS(css: string): void {
    setSettingsStore('customCSS', css)
  },
  setAutoTimestamps(value: boolean): void {
    setSettingsStore('autoTimestamps', value)
  },
  setShowOtherFiles(value: boolean): void {
    setSettingsStore('showOtherFiles', value)
  },
}

export { settingsStore, setSettingsStore }
export type { ThemeId }
```

- [ ] **Step 3: Check types compile**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors in `settingsStore.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/stores/settingsStore.ts
git commit -m "feat: add settingsStore with co-located actions and localStorage sync"
```

---

## Task 2: Create `workspaceStore.ts`

**Files:**
- Create: `src/stores/workspaceStore.ts`

This merges the workspace state and selectors from `globalStore.ts` with the full contents of `workspaceActions.ts`. The internal scoped setters (`setLayout`, `setRoot`) change from `setGlobalStore('workspace', 'layouts', ...)` to `setWorkspaceStore('layouts', ...)`.

- [ ] **Step 1: Create the file**

```ts
// src/stores/workspaceStore.ts
import { createRoot, createEffect } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import { loadFromStorage, saveToStorage } from '../lib/localStorage'
import { getFileViewForExt, getView } from '../lib/viewRegistry'
import { setRuntimeStore } from './runtimeStore'
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

const savedWs = loadFromStorage<{ layouts: WorkspaceLayout[]; activeLayoutId: string }>(
  'sn-workspace',
  { layouts: [initialLayout], activeLayoutId: DEFAULT_LAYOUT_ID },
  (v) =>
    typeof v === 'object' &&
    v !== null &&
    Array.isArray((v as Record<string, unknown>).layouts) &&
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
  return workspaceStore.layouts.find(l => l.id === workspaceStore.activeLayoutId)!
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

function layoutIdx(): number {
  return workspaceStore.layouts.findIndex(l => l.id === workspaceStore.activeLayoutId)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const setLayout = (...args: any[]) => (setWorkspaceStore as any)('layouts', layoutIdx(), ...args)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const setRoot = (...args: any[]) => setLayout('root', ...args)

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
      children: root.children.map(c => c.id === id ? (updater(c) as WorkspaceLeaf) : c),
    }
  }
  return root
}

function findTabsById(root: WorkspaceNode, tabsId: string): WorkspaceTabs | null {
  if (root.type === 'tabs' && root.id === tabsId) return root
  if (root.type === 'split') {
    for (const child of root.children) {
      const found = findTabsById(child, tabsId)
      if (found) return found
    }
  }
  return null
}

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
    setWorkspaceStore('layouts', (ls: WorkspaceLayout[]) => [...ls, newLayout])
    setWorkspaceStore('activeLayoutId', newId)
    return newId
  },

  switchLayout(id: string): void {
    setWorkspaceStore('activeLayoutId', id)
  },

  renameLayout(id: string, name: string): void {
    const idx = workspaceStore.layouts.findIndex(l => l.id === id)
    if (idx === -1) return
    setWorkspaceStore('layouts', idx, 'name', name)
  },

  deleteLayout(id: string): void {
    if (workspaceStore.layouts.length <= 1) return
    const remaining = workspaceStore.layouts.filter(l => l.id !== id)
    const newActiveId = workspaceStore.activeLayoutId === id
      ? remaining[0].id
      : workspaceStore.activeLayoutId
    setWorkspaceStore('layouts', remaining)
    setWorkspaceStore('activeLayoutId', newActiveId)
  },
}

export { workspaceStore, setWorkspaceStore }
```

- [ ] **Step 2: Check types compile**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors in `workspaceStore.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/stores/workspaceStore.ts
git commit -m "feat: add workspaceStore with co-located actions and localStorage sync"
```

---

## Task 3: Create `cacheStore.ts`

**Files:**
- Create: `src/stores/cacheStore.ts`

Merges `cacheActions.ts` with cache state. Adds IDB read (`initCacheStore`) and debounced IDB write. All `setGlobalStore('cache', ...)` calls become `setCacheStore(...)`.

- [ ] **Step 1: Create the file**

```ts
// src/stores/cacheStore.ts
import { createRoot, createEffect } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import { get, set } from 'idb-keyval'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { parseFrontmatter } from '../lib/parseFrontmatter'
import { wikiLinkParser } from '../lib/wikiLinkParser'
import { outLinksField } from '../lib/outLinksField'
import { inlineTagsField } from '../lib/inlineTagsField'
import { hashContent, getCachedMeta, setCachedMeta } from '../services/fileCacheService'
import { extractTags, extractAliases, mergeTagsWithBody } from '../lib/knowledgeUtils'
import type { CacheState, FileMeta } from './types'

const [cacheStore, setCacheStore] = createStore<CacheState>({
  files: {},
  backlinkMap: {},
  tagMap: {},
})

export async function initCacheStore(): Promise<void> {
  const saved = await get<CacheState>('sn-cache')
  if (saved) setCacheStore(reconcile(saved))
}

let _saveTimer: ReturnType<typeof setTimeout> | null = null
createRoot(() => {
  createEffect(() => {
    const snapshot = JSON.parse(JSON.stringify(cacheStore)) as CacheState
    if (_saveTimer) clearTimeout(_saveTimer)
    _saveTimer = setTimeout(() => set('sn-cache', snapshot), 500)
  })
})

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CmParsed { outLinks: string[]; inlineTags: string[] }

type ContentFields = Pick<FileMeta, 'frontmatter' | 'outLinks' | 'tags' | 'aliases'>

// ── Internal helpers ──────────────────────────────────────────────────────────

function parseWithCm6(content: string): CmParsed {
  const state = EditorState.create({
    doc: content,
    extensions: [
      markdown({ extensions: [GFM, wikiLinkParser] }),
      outLinksField,
      inlineTagsField,
    ],
  })
  return {
    outLinks: state.field(outLinksField)
      .filter(l => l.type === 'wiki')
      .map(l => l.target.endsWith('.md') ? l.target : `${l.target}.md`),
    inlineTags: state.field(inlineTagsField).map(m => m.tag),
  }
}

function applyContent(path: string, hash: string, content: ContentFields): void {
  const prev = cacheStore.files[path]

  setCacheStore('files', path, (f: FileMeta) => ({ ...f, hash, ...content }))

  const prevLinks = new Set(prev?.outLinks ?? [])
  const nextLinks = new Set(content.outLinks)
  for (const t of prevLinks) {
    if (!nextLinks.has(t))
      setCacheStore('backlinkMap', t, (list: string[]) => list?.filter(p => p !== path) ?? [])
  }
  for (const t of nextLinks) {
    if (!prevLinks.has(t))
      setCacheStore('backlinkMap', t, (list: string[]) => list ? [...list, path] : [path])
  }

  const prevTags = new Set(prev?.tags ?? [])
  const nextTags = new Set(content.tags)
  for (const t of prevTags) {
    if (!nextTags.has(t))
      setCacheStore('tagMap', t, (list: string[]) => list?.filter(p => p !== path) ?? [])
  }
  for (const t of nextTags) {
    if (!prevTags.has(t))
      setCacheStore('tagMap', t, (list: string[]) => list ? [...list, path] : [path])
  }
}

// ── Actions ───────────────────────────────────────────────────────────────────

export const cacheActions = {
  async reindexFile(path: string, content: string, cmParsed?: CmParsed): Promise<void> {
    const hash = hashContent(content)
    const cached = await getCachedMeta(hash)
    let fields: ContentFields
    if (cached) {
      fields = cached
    } else {
      const { frontmatter } = parseFrontmatter(content)
      const { outLinks, inlineTags } = cmParsed ?? parseWithCm6(content)
      fields = {
        frontmatter,
        outLinks,
        tags: mergeTagsWithBody(extractTags(frontmatter.tags), inlineTags),
        aliases: extractAliases(frontmatter.aliases),
      }
      await setCachedMeta(hash, fields)
    }
    applyContent(path, hash, fields)
  },

  remapFileLink(path: string, oldTarget: string, newTarget: string): void {
    const file = cacheStore.files[path]
    if (!file) return
    const outLinks = file.outLinks.map(l => l === oldTarget ? newTarget : l)
    applyContent(path, file.hash, { ...file, outLinks })
  },

  removeCacheEntry(path: string): void {
    const file = cacheStore.files[path]
    if (!file) return
    for (const t of file.outLinks)
      setCacheStore('backlinkMap', t, (list: string[]) => list?.filter(p => p !== path) ?? [])
    for (const t of file.tags)
      setCacheStore('tagMap', t, (list: string[]) => list?.filter(p => p !== path) ?? [])
    setCacheStore('files', path, undefined as unknown as FileMeta)
  },
}

export { cacheStore, setCacheStore }
```

- [ ] **Step 2: Check types compile**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors in `cacheStore.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/stores/cacheStore.ts
git commit -m "feat: add cacheStore with co-located actions and IDB persistence"
```

---

## Task 4: Extend `runtimeStore.ts` with appActions and fileActions

**Files:**
- Modify: `src/stores/runtimeStore.ts`

Adds `appActions` (vault open/restore/toggleSettings) and `fileActions` (all file CRUD/rename/delete) from the old action files. Settings mutations (`setTheme`, etc.) are NOT included — they moved to `settingsActions`. Dynamic imports change from `'./workspaceActions'` → `'./workspaceStore'`.

- [ ] **Step 1: Replace the file content**

```ts
// src/stores/runtimeStore.ts
import { get, set } from 'idb-keyval'
import { createStore, produce } from 'solid-js/store'
import { cacheActions, cacheStore, setCacheStore } from './cacheStore'
import {
  clearContentCache,
  deleteFileStatEntry,
  invalidateFile,
  readFile,
  writeFile,
} from '../services/fileCacheService'
import { clearEmbedUrlCache } from '../lib/embedExtension'
import type { FileMeta, RuntimeState } from './types'

declare global {
  interface Window {
    showDirectoryPicker: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
  }
  interface FileSystemDirectoryHandle {
    requestPermission: (options?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>
  }
}

const [runtimeStore, setRuntimeStore] = createStore<RuntimeState>({
  rootHandle: null,
  leafInstances: {},
  fileOp: null,
  isIndexing: false,
  showSettings: false,
})

// ── App actions ───────────────────────────────────────────────────────────────

export const appActions = {
  async openVault(): Promise<void> {
    clearEmbedUrlCache()
    clearContentCache()
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
    await set('rootHandle', handle)
    setRuntimeStore('rootHandle', handle)
    const { workspaceActions } = await import('./workspaceStore')
    workspaceActions.clearAllLeaves()
    const { scanAndIndex } = await import('../services/indexService')
    await scanAndIndex()
  },

  async restoreVault(): Promise<void> {
    const handle = await get<FileSystemDirectoryHandle>('rootHandle')
    if (!handle) return
    try {
      const perm = await handle.requestPermission({ mode: 'readwrite' })
      if (perm !== 'granted') return
      clearContentCache()
      setRuntimeStore('rootHandle', handle)
      const { scanAndIndex } = await import('../services/indexService')
      await scanAndIndex()
    } catch { /* handle invalidated */ }
  },

  toggleSettings(): void {
    setRuntimeStore('showSettings', v => !v)
  },

  isSettingsOpen(): boolean {
    return runtimeStore.showSettings
  },
}

// ── Internal helpers for fileActions ─────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceWikiLinks(content: string, oldPath: string, newPath: string): string {
  const oldBase = oldPath.replace(/\.md$/, '')
  const newBase = newPath.replace(/\.md$/, '')
  const oldStem = oldBase.split('/').pop()!
  const newStem = newBase.split('/').pop()!
  const pairs: [string, string][] = []
  if (oldBase !== oldStem) {
    pairs.push([`${oldBase}.md`, `${newBase}.md`])
    pairs.push([oldBase, newBase])
  }
  pairs.push([`${oldStem}.md`, `${newStem}.md`])
  pairs.push([oldStem, newStem])
  let result = content
  for (const [old, next] of pairs) {
    result = result.replace(
      new RegExp(`\\[\\[${escapeRegex(old)}(\\|[^\\]]*)?\\]\\]`, 'g'),
      (_, alias) => `[[${next}${alias ?? ''}]]`,
    )
  }
  return result
}

async function updateBacklinks(
  backlinks: string[],
  oldPath: string,
  newPath: string,
): Promise<void> {
  for (const bPath of backlinks) {
    try {
      const content = await readFile(bPath)
      const updated = replaceWikiLinks(content, oldPath, newPath)
      if (updated !== content) {
        await writeFile(bPath, updated)
        cacheActions.remapFileLink(bPath, oldPath, newPath)
      }
    } catch { /* skip unreadable files */ }
  }
}

// ── File actions ──────────────────────────────────────────────────────────────

export const fileActions = {
  async createFile(name: string): Promise<string | null> {
    const { rootHandle } = runtimeStore
    if (!rootHandle) return null
    const parts = name.includes('/') ? name.split('/') : [name]
    const fileName = parts.pop()!
    const finalName = fileName.endsWith('.md') ? fileName : `${fileName}.md`
    let dir = rootHandle
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true })
    await dir.getFileHandle(finalName, { create: true })
    const path = parts.length > 0 ? `${parts.join('/')}/${finalName}` : finalName
    const parent = parts.length > 0 ? parts.join('/') : null
    const entry: FileMeta = {
      name: finalName, path, kind: 'file', parent,
      size: 0, mtime: 0, hash: '', frontmatter: {}, outLinks: [], tags: [], aliases: [],
    }
    setCacheStore('files', path, entry)
    return path
  },

  async createFolder(name: string): Promise<void> {
    const { rootHandle } = runtimeStore
    if (!rootHandle) return
    const parts = name.split('/')
    let dir = rootHandle
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true })
    const dirName = parts[parts.length - 1]
    const parent = parts.length > 1 ? parts.slice(0, -1).join('/') : null
    const entry: FileMeta = {
      name: dirName, path: name, kind: 'directory', parent,
      size: 0, mtime: 0, hash: '', frontmatter: {}, outLinks: [], tags: [], aliases: [],
    }
    setCacheStore('files', name, entry)
  },

  async renameFile(oldPath: string, newName: string): Promise<void> {
    const { rootHandle } = runtimeStore
    if (!rootHandle) return
    const dir = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : ''
    const finalName = newName.endsWith('.md') ? newName : `${newName}.md`
    const newPath = dir ? `${dir}/${finalName}` : finalName

    const oldContent = await readFile(oldPath)
    await writeFile(newPath, oldContent, true)
    let dirHandle: FileSystemDirectoryHandle = rootHandle
    if (dir) {
      for (const part of dir.split('/')) dirHandle = await dirHandle.getDirectoryHandle(part)
    }
    await dirHandle.removeEntry(oldPath.split('/').pop()!)
    invalidateFile(oldPath)
    await deleteFileStatEntry(oldPath)

    const backlinks = cacheStore.backlinkMap[oldPath] ?? []
    cacheActions.removeCacheEntry(oldPath)
    setCacheStore('files', produce((m: Record<string, FileMeta>) => { delete m[oldPath] }))

    const parent = dir || null
    const entry: FileMeta = {
      name: finalName, path: newPath, kind: 'file', parent,
      size: 0, mtime: 0, hash: '', frontmatter: {}, outLinks: [], tags: [], aliases: [],
    }
    setCacheStore('files', newPath, entry)

    const { workspaceActions } = await import('./workspaceStore')
    workspaceActions.renameLeafPath(oldPath, newPath)
    await cacheActions.reindexFile(newPath, oldContent)
    await updateBacklinks(backlinks, oldPath, newPath)
  },

  async deleteFile(path: string): Promise<void> {
    const { rootHandle } = runtimeStore
    if (!rootHandle) return
    const parts = path.split('/')
    const name = parts.pop()!
    let dir: FileSystemDirectoryHandle = rootHandle
    for (const part of parts) dir = await dir.getDirectoryHandle(part)
    await dir.removeEntry(name)
    invalidateFile(path)
    await deleteFileStatEntry(path)
    cacheActions.removeCacheEntry(path)
    setCacheStore('files', produce((m: Record<string, FileMeta>) => { delete m[path] }))
  },

  async deleteFolder(path: string): Promise<void> {
    const { rootHandle } = runtimeStore
    if (!rootHandle) return
    const parts = path.split('/')
    const name = parts.pop()!
    let parentDir: FileSystemDirectoryHandle = rootHandle
    for (const part of parts) parentDir = await parentDir.getDirectoryHandle(part)
    await parentDir.removeEntry(name, { recursive: true })

    const toRemove = Object.values(cacheStore.files).filter(
      e => e.path === path || e.path.startsWith(path + '/'),
    )
    for (const entry of toRemove) {
      if (entry.kind === 'file') {
        invalidateFile(entry.path)
        await deleteFileStatEntry(entry.path)
        cacheActions.removeCacheEntry(entry.path)
      }
    }
    setCacheStore(
      'files',
      produce((m: Record<string, FileMeta>) => {
        for (const entry of toRemove) delete m[entry.path]
      }),
    )
  },

  beginCreate(mode: 'file' | 'folder', prefix = ''): void {
    setRuntimeStore('fileOp', { type: mode === 'file' ? 'create-file' : 'create-folder', prefix })
  },

  beginRename(path: string): void {
    setRuntimeStore('fileOp', { type: 'rename', path })
  },

  cancelOp(): void {
    setRuntimeStore('fileOp', null)
  },

  async commitCreate(name: string): Promise<void> {
    const op = runtimeStore.fileOp
    if (!op || (op.type !== 'create-file' && op.type !== 'create-folder')) return
    setRuntimeStore('fileOp', null)
    if (op.type === 'create-file') {
      const path = await fileActions.createFile(name)
      if (path) {
        const { workspaceActions } = await import('./workspaceStore')
        workspaceActions.openFile(path, { newTab: true, pin: true })
      }
    } else {
      await fileActions.createFolder(name)
    }
  },

  async commitRename(path: string, newName: string): Promise<void> {
    setRuntimeStore('fileOp', null)
    await fileActions.renameFile(path, newName)
  },
}

export { runtimeStore, setRuntimeStore }
```

- [ ] **Step 2: Check types compile**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: errors only about old consumers importing from deleted paths — not from the new runtimeStore.ts itself.

- [ ] **Step 3: Commit**

```bash
git add src/stores/runtimeStore.ts
git commit -m "feat: add appActions and fileActions to runtimeStore"
```

---

## Task 5: Remove `GlobalState` from `types.ts`

**Files:**
- Modify: `src/stores/types.ts`

- [ ] **Step 1: Delete the GlobalState interface**

Remove these lines from `src/stores/types.ts`:

```ts
// ── Global store ──────────────────────────────────────────────────────────────

export interface GlobalState {
  cache: CacheState
  workspace: WorkspaceState
  settings: SettingsState
}
```

- [ ] **Step 2: Commit**

```bash
git add src/stores/types.ts
git commit -m "chore: remove GlobalState from types (domains are now separate stores)"
```

---

## Task 6: Migrate `indexService.ts`

**Files:**
- Modify: `src/services/indexService.ts`

Replace all `globalStore`/`setGlobalStore` references with `cacheStore`/`setCacheStore`.

- [ ] **Step 1: Update imports**

Replace:
```ts
import { globalStore, setGlobalStore } from '../stores/globalStore'
```
With:
```ts
import { cacheStore, setCacheStore } from '../stores/cacheStore'
```

- [ ] **Step 2: Replace all store references**

| Find | Replace |
|------|---------|
| `globalStore.cache.files[path]` | `cacheStore.files[path]` |
| `globalStore.cache.files` | `cacheStore.files` |
| `setGlobalStore('cache', 'files', path,` | `setCacheStore('files', path,` |
| `setGlobalStore('cache', 'files', files)` | `setCacheStore('files', files)` |
| `setGlobalStore('cache', 'backlinkMap',` | `setCacheStore('backlinkMap',` |
| `setGlobalStore('cache', 'tagMap',` | `setCacheStore('tagMap',` |

After replacement, `indexService.ts` lines 104–157 should look like:

```ts
// line 104 area
if (cached && cacheStore.files[path]?.hash === hash) continue
if (cached) {
  setCacheStore('files', path, (f: FileMeta) => ({ ...f, hash, ...cached }))
} else {
  changed.push(path)
}

// line 122 area
const entry = cacheStore.files[path]

// line 129 area
setCacheStore('files', path, (f: FileMeta) => ({ ...f, hash, ...cachedMeta }))

// line 147 area
setCacheStore('files', path, (f: FileMeta) => ({ ...f, hash, ...parsed }))

// line 153-157 area
const mdFiles = Object.fromEntries(
  Object.entries(cacheStore.files).filter(([p]) => p.endsWith('.md')),
)
setCacheStore('backlinkMap', buildBacklinkMap(mdFiles))
setCacheStore('tagMap', buildTagMap(mdFiles))

// line 176 area
setCacheStore('files', files)

// line 206 area
setCacheStore('files', files)
```

- [ ] **Step 3: Check types compile**

```bash
npx tsc --noEmit 2>&1 | grep indexService
```
Expected: no errors in `indexService.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/services/indexService.ts
git commit -m "refactor(indexService): use cacheStore instead of globalStore"
```

---

## Task 7: Migrate `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Replace import block**

Replace:
```ts
import { appActions } from './actions/appActions'
import { fileActions } from './actions/fileActions'
import { workspaceActions } from './actions/workspaceActions'
```
With:
```ts
import { appActions, fileActions } from './stores/runtimeStore'
import { workspaceActions } from './stores/workspaceStore'
```

- [ ] **Step 2: Replace globalStore/syncToStorage imports**

Replace:
```ts
import { syncToStorage } from './lib/localStorage'
```
(remove entirely — no longer needed in App.tsx)

Replace:
```ts
import { activeLayout, activeRoot, globalStore } from './stores/globalStore'
```
With:
```ts
import { activeLayout, activeRoot, workspaceStore } from './stores/workspaceStore'
import { settingsStore } from './stores/settingsStore'
import { initCacheStore } from './stores/cacheStore'
```

- [ ] **Step 3: Update App component body**

Replace inside `App()`:
```ts
  createEffect(() => {
    document.documentElement.setAttribute(
      'data-theme',
      globalStore.settings.theme,
    )
  })

  createEffect(() => {
    customStyleEl.textContent = globalStore.settings.customCSS
  })

  syncToStorage('sn-workspace', () => ({
    layouts: globalStore.workspace.layouts,
    activeLayoutId: globalStore.workspace.activeLayoutId,
  }))

  syncToStorage('sn-settings', () => globalStore.settings)

  onMount(async () => {
    await appActions.restoreVault()
  })
```
With:
```ts
  createEffect(() => {
    document.documentElement.setAttribute('data-theme', settingsStore.theme)
  })

  createEffect(() => {
    customStyleEl.textContent = settingsStore.customCSS
  })

  onMount(async () => {
    await initCacheStore()
    await appActions.restoreVault()
  })
```

- [ ] **Step 4: Check types compile**

```bash
npx tsc --noEmit 2>&1 | grep App.tsx
```
Expected: no errors in `App.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "refactor(App): use split stores, add initCacheStore on mount"
```

---

## Task 8: Migrate components and lib

**Files:**
- Modify: `src/components/Settings.tsx`
- Modify: `src/components/viewer/EditorViewer.tsx`
- Modify: `src/components/panels/CalendarPanel.tsx`
- Modify: `src/components/panels/FilesPanel.tsx`
- Modify: `src/components/panels/LinksPanel.tsx`
- Modify: `src/components/panels/TagsPanel.tsx`
- Modify: `src/components/panels/OutlinePanel.tsx`
- Modify: `src/components/viewer/CalendarViewer.tsx`
- Modify: `src/components/workspace/WorkspaceNodeRenderer.tsx`
- Modify: `src/components/Ribbon.tsx`
- Modify: `src/components/StatusBar.tsx`
- Modify: `src/lib/embedExtension.ts`

- [ ] **Step 1: Update `Settings.tsx`**

Replace import block:
```ts
import { appActions } from '../actions/appActions'
import { globalStore } from '../stores/globalStore'
```
With:
```ts
import { settingsActions, settingsStore } from '../stores/settingsStore'
```

(`appActions` is not needed — `Settings.tsx` calls `setRuntimeStore('showSettings', false)` directly to close the panel, and all four setter calls move to `settingsActions`.)

Replace all `globalStore.settings.` with `settingsStore.`:
- `globalStore.settings.theme` → `settingsStore.theme`
- `globalStore.settings.customCSS` → `settingsStore.customCSS`
- `globalStore.settings.autoTimestamps` → `settingsStore.autoTimestamps`
- `globalStore.settings.showOtherFiles` → `settingsStore.showOtherFiles`

Replace action calls in `apply()`:
- `appActions.setTheme(` → `settingsActions.setTheme(`
- `appActions.setCustomCSS(` → `settingsActions.setCustomCSS(`
- `appActions.setAutoTimestamps(` → `settingsActions.setAutoTimestamps(`
- `appActions.setShowOtherFiles(` → `settingsActions.setShowOtherFiles(`

- [ ] **Step 2: Update `EditorViewer.tsx`**

Replace:
```ts
import { fileActions } from '../../actions/fileActions'
import { cacheActions } from '../../actions/cacheActions'
```
With:
```ts
import { fileActions } from '../../stores/runtimeStore'
import { cacheActions } from '../../stores/cacheStore'
```

Replace:
```ts
import { globalStore } from '../../stores/globalStore'
```
With:
```ts
import { settingsStore } from '../../stores/settingsStore'
```

Replace `globalStore.settings.autoTimestamps` with `settingsStore.autoTimestamps` (2 occurrences: lines ~38 and ~150).

- [ ] **Step 3: Update `CalendarPanel.tsx`**

Replace:
```ts
import { workspaceActions } from '../../actions/workspaceActions'
```
With:
```ts
import { workspaceActions } from '../../stores/workspaceStore'
```

Replace:
```ts
import { globalStore } from '../../stores/globalStore'
```
With:
```ts
import { cacheStore } from '../../stores/cacheStore'
```

Replace `globalStore.cache.files` with `cacheStore.files`.

- [ ] **Step 4: Update `FilesPanel.tsx`**

Replace:
```ts
import { appActions } from '../../actions/appActions'
import { fileActions } from '../../actions/fileActions'
import { workspaceActions } from '../../actions/workspaceActions'
```
With:
```ts
import { appActions, fileActions } from '../../stores/runtimeStore'
import { workspaceActions } from '../../stores/workspaceStore'
```

Replace:
```ts
import { activeFilePath, globalStore } from '../../stores/globalStore'
```
With:
```ts
import { activeFilePath } from '../../stores/workspaceStore'
import { cacheStore } from '../../stores/cacheStore'
import { settingsStore } from '../../stores/settingsStore'
```

Replace `globalStore.cache.files` with `cacheStore.files`.
Replace `globalStore.settings.showOtherFiles` with `settingsStore.showOtherFiles`.

- [ ] **Step 5: Update `LinksPanel.tsx`**

Replace:
```ts
import {
  activeFilePath,
  activeLayout,
  globalStore,
} from '../../stores/globalStore'
```
With:
```ts
import { activeFilePath, activeLayout } from '../../stores/workspaceStore'
import { cacheStore } from '../../stores/cacheStore'
```

Replace `globalStore.cache.files[path]?.aliases` with `cacheStore.files[path]?.aliases`.
Replace `globalStore.cache.backlinkMap[key]` with `cacheStore.backlinkMap[key]`.

- [ ] **Step 6: Update `TagsPanel.tsx`**

Replace:
```ts
import { activeFilePath, globalStore } from '../../stores/globalStore'
```
With:
```ts
import { activeFilePath } from '../../stores/workspaceStore'
import { cacheStore } from '../../stores/cacheStore'
```

Replace `globalStore.cache.files[path]?.tags` with `cacheStore.files[path]?.tags`.

- [ ] **Step 7: Update `OutlinePanel.tsx`**

Replace:
```ts
import { activeLayout } from '../../stores/globalStore'
```
With:
```ts
import { activeLayout } from '../../stores/workspaceStore'
```

- [ ] **Step 8: Update `CalendarViewer.tsx`**

Replace:
```ts
import { workspaceActions } from '../../actions/workspaceActions'
```
With:
```ts
import { workspaceActions } from '../../stores/workspaceStore'
```

Replace:
```ts
import { globalStore } from '../../stores/globalStore'
```
With:
```ts
import { cacheStore } from '../../stores/cacheStore'
```

Replace `globalStore.cache.files` with `cacheStore.files`.

- [ ] **Step 9: Update `WorkspaceNodeRenderer.tsx`**

Replace:
```ts
import { ROOT_TABS_ID } from '../../stores/globalStore'
```
With:
```ts
import { ROOT_TABS_ID } from '../../stores/workspaceStore'
```

- [ ] **Step 10: Update `Ribbon.tsx`**

Replace:
```ts
import { activeRoot, activeLayout, findLeafInTree } from '../stores/globalStore'
import { workspaceActions } from '../actions/workspaceActions'
import { appActions } from '../actions/appActions'
```
With:
```ts
import { activeRoot, activeLayout, findLeafInTree } from '../stores/workspaceStore'
import { workspaceActions } from '../stores/workspaceStore'
import { appActions } from '../stores/runtimeStore'
```

- [ ] **Step 11: Update `StatusBar.tsx`**

Replace the two existing action/store imports with a single combined import:
```ts
// Remove:
import { workspaceActions } from '../actions/workspaceActions'
// Remove:
import { activeLayout, globalStore } from '../stores/globalStore'

// Add:
import { activeLayout, workspaceActions, workspaceStore } from '../stores/workspaceStore'
```

Replace `globalStore.workspace.layouts` with `workspaceStore.layouts`.
Replace `globalStore.workspace.activeLayoutId` with `workspaceStore.activeLayoutId`.

- [ ] **Step 12: Update `embedExtension.ts`**

Replace:
```ts
import { globalStore } from '../stores/globalStore'
```
With:
```ts
import { cacheStore } from '../stores/cacheStore'
```

Replace `globalStore.cache.files` with `cacheStore.files`.

- [ ] **Step 13: Check types compile**

```bash
npx tsc --noEmit 2>&1 | head -40
```
Expected: errors only from old files (`globalStore.ts`, `src/actions/*.ts`) still being imported somewhere, or no errors at all.

- [ ] **Step 14: Commit**

```bash
git add src/components/ src/lib/embedExtension.ts
git commit -m "refactor: migrate all components to split stores"
```

---

## Task 9: Update test file

**Files:**
- Modify: `src/__tests__/workspaceHelpers.test.ts`

- [ ] **Step 1: Update import**

Replace:
```ts
import { findLeafInTree, findLeafInRoot } from '../stores/globalStore'
```
With:
```ts
import { findLeafInTree, findLeafInRoot } from '../stores/workspaceStore'
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run
```
Expected: all 9 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/workspaceHelpers.test.ts
git commit -m "test: update workspaceHelpers import to workspaceStore"
```

---

## Task 10: Delete old files

**Files:**
- Delete: `src/stores/globalStore.ts`
- Delete: `src/actions/appActions.ts`
- Delete: `src/actions/cacheActions.ts`
- Delete: `src/actions/fileActions.ts`
- Delete: `src/actions/workspaceActions.ts`

- [ ] **Step 1: Delete the files**

```bash
rm src/stores/globalStore.ts \
   src/actions/appActions.ts \
   src/actions/cacheActions.ts \
   src/actions/fileActions.ts \
   src/actions/workspaceActions.ts
```

- [ ] **Step 2: Remove empty actions directory**

```bash
rmdir src/actions
```

- [ ] **Step 3: Check types compile with no errors**

```bash
npx tsc --noEmit 2>&1
```
Expected: no output (zero errors).

- [ ] **Step 4: Run tests**

```bash
npx vitest run
```
Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: delete globalStore and src/actions — all content migrated to domain stores"
```

---

## Task 11: Final verification

- [ ] **Step 1: Full type check**

```bash
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 2: Run tests**

```bash
npx vitest run
```
Expected: all tests pass.

- [ ] **Step 3: Verify build succeeds**

```bash
npm run build 2>&1 | tail -10
```
Expected: build completes with no errors.
