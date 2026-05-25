# Workspace Layout Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat `left`/`right`/`activeLeafId` fields in `WorkspaceState` with a multi-layout tree (`WorkspaceLayout[]`) where sidebars are tree-driven, support splits and tabs, and multiple named workspaces can be switched via the StatusBar.

**Architecture:** `WorkspaceState` holds a `layouts: WorkspaceLayout[]` array plus a `activeLayoutId` string. Each `WorkspaceLayout` has a `WorkspaceRoot` with `left: SidebarSplit`, `main: WorkspaceNode`, `right: SidebarSplit`. Sidebar panels reuse `WorkspaceLeaf` nodes. `SidebarRenderer` delegates to `WorkspaceNodeRenderer`, eliminating the hardcoded `LeftContent`/`RightContent` components.

**Tech Stack:** SolidJS, solid-js/store (reactive), Vitest (tests), TypeScript, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-05-24-workspace-layout-design.md`

---

## File Map

| File                                             | Action | Responsibility                                                                                   |
| ------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------ |
| `src/stores/types.ts`                            | Modify | Add `SidebarSplit`, `WorkspaceRoot`, `WorkspaceLayout`; rewrite `WorkspaceState`                 |
| `src/stores/globalStore.ts`                      | Modify | New initial state, `activeLayout()`, `activeRoot()`, `findLeafInRoot()`                          |
| `src/actions/workspaceActions.ts`                | Modify | Path prefix via `layoutIdx()`, new sidebar/layout actions, remove old sidebar actions            |
| `src/components/workspace/SidebarRenderer.tsx`   | Modify | Delegate to `WorkspaceNodeRenderer`, delete `LeftContent`/`RightContent`                         |
| `src/components/workspace/WorkspaceTabsView.tsx` | Modify | Hide close button and pin for `kind === 'panel'` leaves                                          |
| `src/components/Ribbon.tsx`                      | Modify | Use `activeRoot()`, replace `leftPanelView` with sidebar leaf lookup                             |
| `src/components/StatusBar.tsx`                   | Modify | Use `activeLayout()` for `activeLeafId`; add workspace switcher UI                               |
| `src/components/Sidebar.tsx`                     | Modify | `workspace.main` → `activeRoot().main`; `workspace.activeLeafId` → `activeLayout().activeLeafId` |
| `src/components/CalendarPage.tsx`                | Modify | Same two field path fixes as Sidebar.tsx                                                         |
| `src/components/CalendarPanel.tsx`               | Modify | Same two field path fixes as Sidebar.tsx                                                         |
| `src/App.tsx`                                    | Modify | `globalStore.workspace.main` → `activeRoot().main`                                               |
| `src/__tests__/workspaceHelpers.test.ts`         | Create | Unit tests for `findLeafInTree` and `findLeafInRoot`                                             |

---

## Task 1: Rewrite `src/stores/types.ts`

**Files:**

- Modify: `src/stores/types.ts`

- [ ] **Step 1: Replace the file contents**

```typescript
import type { EditorView } from '@codemirror/view'
import type { OutLink } from '../lib/outLinksField'
import type { Heading } from '../lib/headingsField'

// ── Workspace tree ──────────────────────────────────────────────────────────

export interface ViewState {
  type: string
  state: Record<string, unknown>
}

export interface WorkspaceSplit {
  type: 'split'
  id: string
  direction: 'horizontal' | 'vertical'
  children: WorkspaceNode[]
}

export interface WorkspaceTabs {
  type: 'tabs'
  id: string
  activeLeafId: string | null
  children: WorkspaceLeaf[]
}

export interface WorkspaceLeaf {
  type: 'leaf'
  id: string
  viewState: ViewState
  pinned: boolean
}

export type WorkspaceNode = WorkspaceSplit | WorkspaceTabs | WorkspaceLeaf

// Sidebar container (not in WorkspaceNode union — carries width/collapsed)
export interface SidebarSplit {
  id: string
  width: number
  collapsed: boolean
  children: WorkspaceNode[] // flat list of tabs groups (stacked vertically)
}

// Root of the entire workspace tree
export interface WorkspaceRoot {
  left: SidebarSplit
  main: WorkspaceNode
  right: SidebarSplit
}

// One switchable workspace snapshot
export interface WorkspaceLayout {
  id: string
  name: string
  root: WorkspaceRoot
  activeLeafId: string | null
}

// ── Theme ───────────────────────────────────────────────────────────────────

export type ThemeId = 'dark' | 'light' | 'nord'

// ── File system ─────────────────────────────────────────────────────────────

export interface FileNode {
  name: string
  path: string
  kind: 'file' | 'directory'
  children?: FileNode[]
}

// ── Knowledge ───────────────────────────────────────────────────────────────

export interface FileMetadata {
  path: string
  frontmatter: Record<string, unknown>
  outLinks: string[]
  tags: string[]
  aliases: string[]
}

// ── Global store shape ──────────────────────────────────────────────────────

export interface FsState {
  tree: FileNode[]
}

export interface KnowledgeState {
  index: Record<string, FileMetadata>
  backlinkMap: Record<string, string[]>
  tagMap: Record<string, string[]>
  isIndexing: boolean
}

export interface WorkspaceState {
  layouts: WorkspaceLayout[]
  activeLayoutId: string
  theme: ThemeId
  customCSS: string
  showSettings: boolean
  autoTimestamps: boolean
  showOtherFiles: boolean
}

export interface GlobalState {
  fs: FsState
  knowledge: KnowledgeState
  workspace: WorkspaceState
}

// ── Runtime store shape (non-serializable) ──────────────────────────────────

export interface LeafRuntimeState {
  cmView: EditorView | null
  isDirty: boolean
  outLinks: OutLink[]
  headings: Heading[]
}

export interface RuntimeState {
  rootHandle: FileSystemDirectoryHandle | null
  leafInstances: Record<string, LeafRuntimeState>
}

// ── View registry ───────────────────────────────────────────────────────────

export interface ViewComponentProps {
  leafId: string
  isActive: boolean
  viewState: Record<string, unknown>
}
```

- [ ] **Step 2: Verify TypeScript still knows about types (no compile needed yet — just save)**

- [ ] **Step 3: Commit**

```bash
git add src/stores/types.ts
git commit -m "refactor: rewrite WorkspaceState types for multi-layout tree"
```

---

## Task 2: Rewrite `src/stores/globalStore.ts`

**Files:**

- Modify: `src/stores/globalStore.ts`

- [ ] **Step 1: Replace the file contents**

```typescript
import { createStore } from 'solid-js/store'
import type {
  GlobalState,
  ThemeId,
  WorkspaceNode,
  WorkspaceLeaf,
  WorkspaceLayout,
  WorkspaceRoot,
} from './types'

function saved<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw !== null ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

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
      children: [
        {
          type: 'tabs',
          id: 'left-tabs',
          activeLeafId: 'leaf-files',
          children: [
            {
              type: 'leaf',
              id: 'leaf-files',
              viewState: { type: 'files', state: {} },
              pinned: false,
            },
            {
              type: 'leaf',
              id: 'leaf-calendar-panel',
              viewState: { type: 'calendar-panel', state: {} },
              pinned: false,
            },
          ],
        },
      ],
    },
    main: { type: 'tabs', id: ROOT_TABS_ID, activeLeafId: null, children: [] },
    right: {
      id: 'right-root',
      width: 200,
      collapsed: false,
      children: [
        {
          type: 'tabs',
          id: 'right-tabs',
          activeLeafId: 'leaf-links',
          children: [
            {
              type: 'leaf',
              id: 'leaf-links',
              viewState: { type: 'links', state: {} },
              pinned: false,
            },
            {
              type: 'leaf',
              id: 'leaf-outline',
              viewState: { type: 'outline', state: {} },
              pinned: false,
            },
            {
              type: 'leaf',
              id: 'leaf-tags',
              viewState: { type: 'tags', state: {} },
              pinned: false,
            },
          ],
        },
      ],
    },
  },
  activeLeafId: null,
}

const [globalStore, setGlobalStore] = createStore<GlobalState>({
  fs: { tree: [] },
  knowledge: {
    index: {},
    backlinkMap: {},
    tagMap: {},
    isIndexing: false,
  },
  workspace: {
    layouts: [initialLayout],
    activeLayoutId: DEFAULT_LAYOUT_ID,
    theme: saved<ThemeId>('sn-theme', 'dark'),
    customCSS: saved<string>('sn-customCSS', ''),
    showSettings: false,
    autoTimestamps: saved<boolean>('sn-autoTimestamps', true),
    showOtherFiles: saved<boolean>('sn-showOtherFiles', true),
  },
})

export function activeLayout(): WorkspaceLayout {
  return globalStore.workspace.layouts.find(
    (l) => l.id === globalStore.workspace.activeLayoutId,
  )!
}

export function activeRoot(): WorkspaceRoot {
  return activeLayout().root
}

/** Find a WorkspaceLeaf by id anywhere in a WorkspaceNode tree. */
export function findLeafInTree(
  node: WorkspaceNode,
  leafId: string,
): WorkspaceLeaf | null {
  if (node.type === 'leaf') return node.id === leafId ? node : null
  if (node.type === 'tabs') {
    return node.children.find((l) => l.id === leafId) ?? null
  }
  for (const child of node.children) {
    const found = findLeafInTree(child, leafId)
    if (found) return found
  }
  return null
}

/** Find a WorkspaceLeaf across the entire root (left + main + right). */
export function findLeafInRoot(
  root: WorkspaceRoot,
  leafId: string,
): WorkspaceLeaf | null {
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

/** Derived: path of the active file leaf in main, or null. */
export function activeFilePath(): string | null {
  const layout = activeLayout()
  if (!layout.activeLeafId) return null
  const leaf = findLeafInTree(layout.root.main, layout.activeLeafId)
  return (leaf?.viewState.state.file as string | undefined) ?? null
}

export { globalStore, setGlobalStore }
```

- [ ] **Step 2: Commit**

```bash
git add src/stores/globalStore.ts
git commit -m "refactor: rewrite globalStore for WorkspaceLayout[] + activeLayout/activeRoot helpers"
```

---

## Task 3: Write tests for `findLeafInTree` and `findLeafInRoot`

**Files:**

- Create: `src/__tests__/workspaceHelpers.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
import { describe, it, expect } from 'vitest'
import { findLeafInTree, findLeafInRoot } from '../stores/globalStore'
import type {
  WorkspaceRoot,
  WorkspaceLeaf,
  WorkspaceTabs,
  WorkspaceSplit,
} from '../stores/types'

const makeLeaf = (id: string, type = 'markdown'): WorkspaceLeaf => ({
  type: 'leaf',
  id,
  viewState: { type, state: {} },
  pinned: false,
})

const makeTabs = (id: string, leaves: WorkspaceLeaf[]): WorkspaceTabs => ({
  type: 'tabs',
  id,
  activeLeafId: leaves[0]?.id ?? null,
  children: leaves,
})

const makeSplit = (
  id: string,
  children: (WorkspaceTabs | WorkspaceSplit)[],
): WorkspaceSplit => ({
  type: 'split',
  id,
  direction: 'vertical',
  children,
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
    left: {
      id: 'l',
      width: 190,
      collapsed: false,
      children: [makeTabs('lt', [leftLeaf])],
    },
    main: makeTabs('mt', [mainLeaf]),
    right: {
      id: 'r',
      width: 200,
      collapsed: false,
      children: [makeTabs('rt', [rightLeaf])],
    },
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
```

- [ ] **Step 2: Run the tests to verify they pass**

```bash
npx vitest run src/__tests__/workspaceHelpers.test.ts
```

Expected: all 9 tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/workspaceHelpers.test.ts
git commit -m "test: add findLeafInTree and findLeafInRoot unit tests"
```

---

## Task 4: Rewrite `src/actions/workspaceActions.ts`

**Files:**

- Modify: `src/actions/workspaceActions.ts`

- [ ] **Step 1: Replace the file contents**

```typescript
import { produce } from 'solid-js/store'
import {
  globalStore,
  setGlobalStore,
  ROOT_TABS_ID,
  activeLayout,
} from '../stores/globalStore'
import { setRuntimeStore } from '../stores/runtimeStore'
import { getView, getFileViewForExt } from '../lib/viewRegistry'
import type {
  WorkspaceNode,
  WorkspaceTabs,
  WorkspaceLeaf,
  ViewState,
  WorkspaceLayout,
} from '../stores/types'

// ── Internal helpers ─────────────────────────────────────────────────────────

function layoutIdx(): number {
  return globalStore.workspace.layouts.findIndex(
    (l) => l.id === globalStore.workspace.activeLayoutId,
  )
}

function findParentTabs(
  root: WorkspaceNode,
  leafId: string,
): WorkspaceTabs | null {
  if (root.type === 'tabs') {
    if (root.children.some((l) => l.id === leafId)) return root
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
    return {
      ...root,
      children: root.children.map((c) => mapNode(c, id, updater)),
    }
  }
  if (root.type === 'tabs') {
    return {
      ...root,
      children: root.children.map((c) =>
        c.id === id ? (updater(c) as WorkspaceLeaf) : c,
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
    const leaf: WorkspaceLeaf = {
      type: 'leaf',
      id: leafId,
      viewState,
      pinned: false,
    }
    setGlobalStore('workspace', 'layouts', idx, 'root', 'main', (root) =>
      mapNode(root, tabsId, (node) => {
        const tabs = node as WorkspaceTabs
        return {
          ...tabs,
          children: [...tabs.children, leaf],
          activeLeafId: leafId,
        }
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
    const remaining = parentTabs.children.filter((l) => l.id !== leafId)
    const nextActiveId =
      parentTabs.activeLeafId === leafId
        ? (remaining[remaining.length - 1]?.id ?? null)
        : parentTabs.activeLeafId
    setGlobalStore('workspace', 'layouts', idx, 'root', 'main', (root) =>
      mapNode(root, parentTabs.id, (node) => ({
        ...(node as WorkspaceTabs),
        children: remaining,
        activeLeafId: nextActiveId,
      })),
    )
    if (activeLayout().activeLeafId === leafId) {
      setGlobalStore('workspace', 'layouts', idx, 'activeLeafId', nextActiveId)
    }
    setRuntimeStore(
      'leafInstances',
      produce((s) => {
        delete s[leafId]
      }),
    )
  },

  activateLeaf(leafId: string): void {
    const idx = layoutIdx()
    setGlobalStore('workspace', 'layouts', idx, 'activeLeafId', leafId)
    const parentTabs = findParentTabs(activeLayout().root.main, leafId)
    if (parentTabs) {
      setGlobalStore('workspace', 'layouts', idx, 'root', 'main', (root) =>
        mapNode(root, parentTabs.id, (node) => ({
          ...(node as WorkspaceTabs),
          activeLeafId: leafId,
        })),
      )
    }
  },

  setLeafViewState(leafId: string, viewState: ViewState): void {
    const idx = layoutIdx()
    setGlobalStore('workspace', 'layouts', idx, 'root', 'main', (root) =>
      mapNode(root, leafId, (node) => ({
        ...(node as WorkspaceLeaf),
        viewState,
      })),
    )
  },

  setLeafPinned(leafId: string, pinned: boolean): void {
    const idx = layoutIdx()
    setGlobalStore('workspace', 'layouts', idx, 'root', 'main', (root) =>
      mapNode(root, leafId, (node) => ({ ...(node as WorkspaceLeaf), pinned })),
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
      children: [
        {
          type: 'leaf',
          id: newLeafId,
          viewState: { type: '', state: {} },
          pinned: false,
        },
      ],
    }
    const splitNode: WorkspaceNode = {
      type: 'split',
      id: crypto.randomUUID(),
      direction,
      children: [parentTabs, newTabs],
    }
    setGlobalStore('workspace', 'layouts', idx, 'root', 'main', (root) =>
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
      const existing = main.children.find((l) => l.viewState.type === type)
      if (existing) {
        workspaceActions.activateLeaf(existing.id)
        return
      }
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
    setGlobalStore('workspace', 'layouts', idx, 'root', 'main', (root) => {
      function walk(node: WorkspaceNode): WorkspaceNode {
        if (node.type === 'leaf' && node.viewState.state.file === oldPath) {
          return {
            ...node,
            viewState: { type: newType, state: { file: newPath } },
          }
        }
        if (node.type === 'tabs') {
          return {
            ...node,
            children: node.children.map(walk) as WorkspaceLeaf[],
          }
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
    setGlobalStore(
      'workspace',
      'layouts',
      idx,
      'root',
      side,
      'collapsed',
      (v: boolean) => !v,
    )
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
      'workspace',
      'layouts',
      idx,
      'root',
      side,
      'children',
      children.map((node) => {
        if (
          node.type === 'tabs' &&
          node.children.some((l) => l.id === leafId)
        ) {
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
        (node) =>
          node.type === 'tabs' && node.children.some((l) => l.id === leafId),
      )
      if (hasLeaf) {
        setGlobalStore(
          'workspace',
          'layouts',
          idx,
          'root',
          side,
          'children',
          children.map((node) => {
            if (
              node.type === 'tabs' &&
              node.children.some((l) => l.id === leafId)
            ) {
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
      children: [
        {
          type: 'leaf',
          id: newLeafId,
          viewState: { type: '', state: {} },
          pinned: false,
        },
      ],
    }
    const children = activeLayout().root[side].children
    setGlobalStore(
      'workspace',
      'layouts',
      idx,
      'root',
      side,
      'children',
      children.flatMap((node) => {
        if (
          node.type === 'tabs' &&
          node.children.some((l) => l.id === leafId)
        ) {
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
          children: current.root.left.children.map((n) => ({ ...n })),
        },
        main: {
          type: 'tabs',
          id: ROOT_TABS_ID,
          activeLeafId: null,
          children: [],
        },
        right: {
          ...current.root.right,
          id: crypto.randomUUID(),
          children: current.root.right.children.map((n) => ({ ...n })),
        },
      },
      activeLeafId: null,
    }
    setGlobalStore('workspace', 'layouts', (ls: WorkspaceLayout[]) => [
      ...ls,
      newLayout,
    ])
    setGlobalStore('workspace', 'activeLayoutId', newId)
    return newId
  },

  switchLayout(id: string): void {
    setGlobalStore('workspace', 'activeLayoutId', id)
  },

  renameLayout(id: string, name: string): void {
    const idx = globalStore.workspace.layouts.findIndex((l) => l.id === id)
    if (idx === -1) return
    setGlobalStore('workspace', 'layouts', idx, 'name', name)
  },

  deleteLayout(id: string): void {
    if (globalStore.workspace.layouts.length <= 1) return
    const remaining = globalStore.workspace.layouts.filter((l) => l.id !== id)
    const newActiveId =
      globalStore.workspace.activeLayoutId === id
        ? remaining[0].id
        : globalStore.workspace.activeLayoutId
    setGlobalStore('workspace', 'layouts', remaining)
    setGlobalStore('workspace', 'activeLayoutId', newActiveId)
  },
}
```

- [ ] **Step 2: Commit**

```bash
git add src/actions/workspaceActions.ts
git commit -m "refactor: update workspaceActions to use layouts[layoutIdx()] path prefix; add sidebar/layout actions"
```

---

## Task 5: Rewrite `src/components/workspace/SidebarRenderer.tsx`

**Files:**

- Modify: `src/components/workspace/SidebarRenderer.tsx`

- [ ] **Step 1: Replace the file contents**

```tsx
import { For } from 'solid-js'
import { activeRoot } from '../../stores/globalStore'
import { WorkspaceNodeRenderer } from './WorkspaceNodeRenderer'

export function SidebarRenderer(props: { side: 'left' | 'right' }) {
  const sidebar = () => activeRoot()[props.side]

  return (
    <div
      class={`transition-all duration-200 overflow-hidden shrink-0 h-full bg-[var(--bg-surface)] flex flex-col
        ${props.side === 'left' ? 'border-r' : 'border-l'} border-(--border)]`}
      style={{ width: sidebar().collapsed ? '0px' : `${sidebar().width}px` }}
    >
      <For each={sidebar().children}>
        {(node) => (
          <div class="flex-1 min-h-0 overflow-hidden">
            <WorkspaceNodeRenderer node={node} />
          </div>
        )}
      </For>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/workspace/SidebarRenderer.tsx
git commit -m "refactor: SidebarRenderer delegates to WorkspaceNodeRenderer; remove LeftContent/RightContent"
```

---

## Task 6: Update `src/components/workspace/WorkspaceTabsView.tsx`

**Files:**

- Modify: `src/components/workspace/WorkspaceTabsView.tsx`

- [ ] **Step 1: Add panel leaf detection — hide close button and skip pin for panel leaves**

Find the tab item render block (inside `<For each={props.node.children}>`). Add `isPanelLeaf` and conditionally render the close button and `onDblClick`:

Replace this section:

```tsx
<div
  class={`flex items-center gap-1.5 px-3 border-r border-(--border)] cursor-pointer text-[11px] shrink-0
    ${
      isActive()
        ? 'bg-[var(--bg-base)] text-[var(--text)] border-b-2 border-b-(--accent) -mb-px'
        : 'text-[var(--text-3)] hover:bg-(--bg-hover)'
    }`}
  onClick={() => workspaceActions.activateLeaf(leaf.id)}
  onDblClick={() => workspaceActions.setLeafPinned(leaf.id, true)}
>
  {def()?.getIcon?.()}
  <span
    class={`max-w-[120px] truncate ${!isPinned() && leaf.viewState.state.file ? 'italic' : ''}`}
  >
    {getTabLabel(leaf)}
  </span>
  <button
    class="text-[var(--text-4)] hover:text-[var(--text-2)] text-[13px] leading-none ml-0.5"
    onClick={(e) => {
      e.stopPropagation()
      workspaceActions.closeLeaf(leaf.id)
    }}
  >
    ×
  </button>
</div>
```

With:

```tsx
<div
  class={`flex items-center gap-1.5 px-3 border-r border-(--border)] cursor-pointer text-[11px] shrink-0
    ${
      isActive()
        ? 'bg-[var(--bg-base)] text-[var(--text)] border-b-2 border-b-(--accent) -mb-px'
        : 'text-[var(--text-3)] hover:bg-(--bg-hover)'
    }`}
  onClick={() => {
    if (isPanelLeaf()) {
      workspaceActions.activateSidebarLeafById(leaf.id)
    } else {
      workspaceActions.activateLeaf(leaf.id)
    }
  }}
  onDblClick={() => {
    if (!isPanelLeaf()) workspaceActions.setLeafPinned(leaf.id, true)
  }}
>
  {def()?.getIcon?.()}
  <span
    class={`max-w-[120px] truncate ${!isPanelLeaf() && !isPinned() && leaf.viewState.state.file ? 'italic' : ''}`}
  >
    {getTabLabel(leaf)}
  </span>
  {!isPanelLeaf() && (
    <button
      class="text-[var(--text-4)] hover:text-[var(--text-2)] text-[13px] leading-none ml-0.5"
      onClick={(e) => {
        e.stopPropagation()
        workspaceActions.closeLeaf(leaf.id)
      }}
    >
      ×
    </button>
  )}
</div>
```

Also add the `isPanelLeaf` derived signal inside the `<For>` callback, after `const def = () => getView(leaf.viewState.type)`:

```tsx
const isPanelLeaf = () => def()?.kind === 'panel'
```

Add the `getView` import if not already present (it already is via `getTabLabel`).

- [ ] **Step 2: Commit**

```bash
git add src/components/workspace/WorkspaceTabsView.tsx
git commit -m "feat: hide close button and pin for panel leaves in WorkspaceTabsView"
```

---

## Task 7: Update `src/components/Ribbon.tsx`

**Files:**

- Modify: `src/components/Ribbon.tsx`

The Ribbon's `switchLeftPanel` uses `leftPanelView` (removed) and `toggleLeft` (renamed). Replace with sidebar leaf lookup via `activeRoot()`.

- [ ] **Step 1: Replace the file contents**

```tsx
import {
  Search,
  Network,
  Settings,
  CalendarDays,
  CalendarRange,
  PanelLeft,
} from 'lucide-solid'
import { activeRoot, activeLayout, findLeafInTree } from '../stores/globalStore'
import { workspaceActions } from '../actions/workspaceActions'
import { appActions } from '../actions/appActions'

export function Ribbon() {
  const leftSidebar = () => activeRoot().left
  const leftOpen = () => !leftSidebar().collapsed

  // Returns the viewState.type of the active leaf in the first left tabs group, or null
  const leftActiveType = (): string | null => {
    if (!leftOpen()) return null
    for (const node of leftSidebar().children) {
      if (node.type === 'tabs' && node.activeLeafId) {
        const leaf = node.children.find((l) => l.id === node.activeLeafId)
        if (leaf) return leaf.viewState.type
      }
    }
    return null
  }

  // Toggle to a panel type: open + activate, or close if already active
  const switchLeftPanel = (viewType: string) => {
    if (leftActiveType() === viewType && leftOpen()) {
      workspaceActions.toggleSidebar('left')
      return
    }
    // Find leaf by viewState.type in sidebar children
    for (const node of leftSidebar().children) {
      if (node.type === 'tabs') {
        const leaf = node.children.find((l) => l.viewState.type === viewType)
        if (leaf) {
          workspaceActions.activateSidebarLeaf('left', leaf.id)
          break
        }
      }
    }
    if (!leftOpen()) workspaceActions.toggleSidebar('left')
  }

  const calendarPageActive = () => {
    const { activeLeafId } = activeLayout()
    if (!activeLeafId) return false
    const leaf = findLeafInTree(activeRoot().main, activeLeafId)
    return leaf?.viewState.type === 'calendar'
  }

  return (
    <div class="w-9 bg-(--bg-base) border-r border-(--border) flex flex-col items-center py-2 gap-1.5 shrink-0">
      <button
        onClick={() => workspaceActions.toggleSidebar('left')}
        class="p-1.5 text-(--text-3) hover:bg-(--bg-hover) hover:text-(--text) rounded cursor-pointer transition-colors"
        title="切换左侧栏"
      >
        <PanelLeft size={18} />
      </button>

      <button
        class={`p-1.5 rounded cursor-pointer transition-colors hover:bg-(--bg-hover)
          ${leftActiveType() === 'files' ? 'text-(--accent)' : 'text-(--text-3) hover:text-(--text)'}`}
        title="文件列表"
        onClick={() => switchLeftPanel('files')}
      >
        <Search size={18} />
      </button>
      <button
        class={`p-1.5 rounded cursor-pointer transition-colors hover:bg-(--bg-hover)
          ${leftActiveType() === 'calendar-panel' ? 'text-(--accent)' : 'text-(--text-3) hover:text-(--text)'}`}
        title="日历"
        onClick={() => switchLeftPanel('calendar-panel')}
      >
        <CalendarDays size={18} />
      </button>
      <button
        class={`p-1.5 rounded cursor-pointer transition-colors hover:bg-(--bg-hover)
          ${calendarPageActive() ? 'text-(--accent)' : 'text-(--text-3) hover:text-(--text)'}`}
        title="日历大图"
        onClick={() => workspaceActions.openPage('calendar')}
      >
        <CalendarRange size={18} />
      </button>
      <button
        class="p-1.5 text-(--text-3) hover:bg-(--bg-hover) hover:text-(--text) rounded cursor-pointer transition-colors"
        title="知识图谱"
      >
        <Network size={18} />
      </button>
      <div class="flex-1" />
      <button
        class="p-1.5 text-(--text-3) hover:bg-(--bg-hover) hover:text-(--text) rounded cursor-pointer transition-colors"
        title="设置"
        onClick={() => appActions.toggleSettings()}
      >
        <Settings size={18} />
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Ribbon.tsx
git commit -m "refactor: update Ribbon to use activeRoot/activeLayout and new toggleSidebar/activateSidebarLeaf actions"
```

---

## Task 8: Fix `workspace.main` and `workspace.activeLeafId` in three panel files

**Files:**

- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/CalendarPage.tsx`
- Modify: `src/components/CalendarPanel.tsx`

All three files read `globalStore.workspace.main` and `globalStore.workspace.activeLeafId`. Both fields have moved.

- [ ] **Step 1: Check current imports in each file**

```bash
head -5 src/components/Sidebar.tsx src/components/CalendarPage.tsx src/components/CalendarPanel.tsx
```

- [ ] **Step 2: Update `src/components/Sidebar.tsx`**

Add `activeRoot, activeLayout` to the import from `globalStore`:

```tsx
import {
  globalStore,
  findLeafInTree,
  activeRoot,
  activeLayout,
} from '../stores/globalStore'
```

Replace every `globalStore.workspace.main` with `activeRoot().main`.

Replace every `globalStore.workspace.activeLeafId` with `activeLayout().activeLeafId`.

The two changed lines are near lines 60 and 64-65:

```tsx
// line ~60 (findLeafWithFile)
const existing = findLeafWithFile(activeRoot().main, path)

// line ~64-65 (activeLeaf)
const { activeLeafId } = activeLayout()
const activeLeaf = activeLeafId
  ? findLeafInTree(activeRoot().main, activeLeafId)
  : null
```

- [ ] **Step 3: Update `src/components/CalendarPage.tsx`**

Same import change and same two substitutions.

- [ ] **Step 4: Update `src/components/CalendarPanel.tsx`**

Same import change and same two substitutions.

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx src/components/CalendarPage.tsx src/components/CalendarPanel.tsx
git commit -m "refactor: replace workspace.main/activeLeafId with activeRoot()/activeLayout() in panel components"
```

---

## Task 9: Update `src/components/StatusBar.tsx` — fix `activeLeafId` + add workspace switcher

**Files:**

- Modify: `src/components/StatusBar.tsx`

- [ ] **Step 1: Replace the file contents**

```tsx
import { createMemo, createSignal, For, Show } from 'solid-js'
import { globalStore } from '../stores/globalStore'
import { activeLayout } from '../stores/globalStore'
import { runtimeStore } from '../stores/runtimeStore'
import { workspaceActions } from '../actions/workspaceActions'
import { parseFrontmatter } from '../lib/parseFrontmatter'

export function StatusBar() {
  const [showSwitcher, setShowSwitcher] = createSignal(false)
  const [renamingId, setRenamingId] = createSignal<string | null>(null)

  const activeRuntime = () => {
    const { activeLeafId } = activeLayout()
    return activeLeafId ? runtimeStore.leafInstances[activeLeafId] : null
  }

  const stats = createMemo(() => {
    const text = activeRuntime()?.cmView?.state.doc.toString() ?? ''
    const { body } = parseFrontmatter(text)
    const words = body.trim() ? body.trim().split(/\s+/).length : 0
    const lines = activeRuntime()?.cmView?.state.doc.lines ?? 0
    return { words, lines }
  })

  const layouts = () => globalStore.workspace.layouts
  const activeId = () => globalStore.workspace.activeLayoutId

  return (
    <div class="relative">
      {/* Workspace switcher popover */}
      <Show when={showSwitcher()}>
        <div
          class="absolute bottom-full left-0 mb-1 bg-[var(--bg-surface)] border border-(--border)] rounded shadow-lg z-50 min-w-[180px] py-1"
          onMouseLeave={() => setShowSwitcher(false)}
        >
          <For each={layouts()}>
            {(layout) => (
              <div class="flex items-center gap-1 px-2 py-1 hover:bg-(--bg-hover) group">
                <span class="w-3 text-(--accent) text-[10px]">
                  {layout.id === activeId() ? '✓' : ''}
                </span>
                <Show
                  when={renamingId() === layout.id}
                  fallback={
                    <span
                      class="flex-1 text-[11px] text-[var(--text-2)] cursor-pointer"
                      onClick={() => workspaceActions.switchLayout(layout.id)}
                    >
                      {layout.name}
                    </span>
                  }
                >
                  <input
                    class="flex-1 text-[11px] bg-[var(--bg-input)] text-[var(--text)] px-1 rounded outline-none"
                    value={layout.name}
                    autofocus
                    onBlur={(e) => {
                      workspaceActions.renameLayout(
                        layout.id,
                        e.currentTarget.value.trim() || layout.name,
                      )
                      setRenamingId(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                  />
                </Show>
                <button
                  class="text-[10px] text-[var(--text-4)] hover:text-[var(--text-2)] opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => setRenamingId(layout.id)}
                  title="重命名"
                >
                  ✏
                </button>
                <Show when={layouts().length > 1}>
                  <button
                    class="text-[10px] text-[var(--text-4)] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => workspaceActions.deleteLayout(layout.id)}
                    title="删除"
                  >
                    ×
                  </button>
                </Show>
              </div>
            )}
          </For>
          <div class="border-t border-(--border)] mt-1 pt-1">
            <button
              class="w-full text-left px-4 py-1 text-[11px] text-[var(--text-3)] hover:bg-(--bg-hover) hover:text-[var(--text)]"
              onClick={() => {
                const n = layouts().length + 1
                workspaceActions.createLayout(`工作区 ${n}`)
              }}
            >
              + 新建工作区
            </button>
          </div>
        </div>
      </Show>

      {/* Status bar */}
      <div class="h-6 bg-[var(--bg-base)] border-t border-(--border)] px-3 flex items-center gap-4 text-[10px] text-[var(--text-4)] shrink-0">
        <button
          class="hover:text-[var(--text-2)] transition-colors"
          onClick={() => setShowSwitcher((v) => !v)}
          title="切换工作区"
        >
          {activeLayout().name}
        </button>
        <span>{stats().words} 字</span>
        <span>{stats().lines} 行</span>
        <div class="flex-1" />
        <Show when={globalStore.knowledge.isIndexing}>
          <span class="flex items-center gap-1 text-[var(--text-3)]">
            <span class="inline-block w-1.5 h-1.5 rounded-full bg-(--accent) animate-pulse" />
            后台检测中
          </span>
        </Show>
        <span class={activeRuntime()?.isDirty ? 'text-(--accent)' : ''}>
          {activeRuntime()?.isDirty ? '未保存' : '已保存'}
        </span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/StatusBar.tsx
git commit -m "feat: add workspace switcher to StatusBar; fix activeLeafId path"
```

---

## Task 10: Update `src/App.tsx`

**Files:**

- Modify: `src/App.tsx`

- [ ] **Step 1: Add `activeRoot` to the globalStore import**

Change:

```tsx
import { globalStore } from './stores/globalStore'
```

To:

```tsx
import { globalStore, activeRoot } from './stores/globalStore'
```

- [ ] **Step 2: Update the main area render**

Change:

```tsx
<WorkspaceNodeRenderer node={globalStore.workspace.main} />
```

To:

```tsx
<WorkspaceNodeRenderer node={activeRoot().main} />
```

- [ ] **Step 3: Run the full test suite**

```bash
npx vitest run
```

Expected: all existing tests PASS (parseFrontmatter, knowledgeService, wikiLinkParser, viewRegistry, workspaceHelpers)

- [ ] **Step 4: Build to check for TypeScript errors**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "refactor: App.tsx uses activeRoot().main; complete workspace layout redesign"
```
