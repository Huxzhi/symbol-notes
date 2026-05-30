# Tab Drag & Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Obsidian-style tab drag-and-drop: reorder within a group, move between groups, split panels by dragging to edges, and move sidebar panel tabs between left/right sidebars.

**Architecture:** Native HTML5 Drag & Drop API with a global SolidJS signal (`tabDragState`) tracking the active drag. Pure tree-manipulation helpers in a separate file enable TDD of workspace mutations. `WorkspaceTabsView` renders three overlay drop zones (left/right/bottom) during drag, and the tab bar acts as a fourth drop zone for joining groups.

**Tech Stack:** SolidJS, TypeScript, Tailwind CSS v4, Vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/tabDragState.ts` | Create | Global drag state signal |
| `src/stores/workspaceTreeHelpers.ts` | Create | Pure tree-mutation functions (testable) |
| `src/stores/__tests__/workspaceTreeHelpers.test.ts` | Create | Unit tests for tree helpers |
| `src/stores/workspaceStore.ts` | Modify | New actions + import helpers, remove duplicated functions |
| `src/components/workspace/WorkspaceTabsView.tsx` | Modify | Draggable tabs, tab bar drop zone, edge drop zones |
| `src/components/workspace/WorkspaceNodeRenderer.tsx` | Modify | Thread `area` prop |
| `src/components/workspace/WorkspaceSplitView.tsx` | Modify | Thread `area` prop |
| `src/components/workspace/SidebarRenderer.tsx` | Modify | Pass `area` to WorkspaceNodeRenderer |
| `src/App.tsx` | Modify | Pass `area="main"` to main WorkspaceNodeRenderer |
| `src/index.css` | Modify | Drop zone highlight + insert cursor styles |

---

### Task 1: Global drag state signal

**Files:**
- Create: `src/lib/tabDragState.ts`

- [ ] **Step 1: Create the file**

```ts
// src/lib/tabDragState.ts
import { createSignal } from 'solid-js'

export interface TabDragState {
  leafId: string
  sourceTabsId: string
  sourceArea: 'left' | 'main' | 'right'
}

const [dragState, setDragState] = createSignal<TabDragState | null>(null)

export { dragState, setDragState }

export function isDraggingMainTab(): boolean {
  return dragState()?.sourceArea === 'main'
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/tabDragState.ts
git commit -m "feat: add tabDragState signal"
```

---

### Task 2: Pure workspace tree helpers + unit tests

**Files:**
- Create: `src/stores/workspaceTreeHelpers.ts`
- Create: `src/stores/__tests__/workspaceTreeHelpers.test.ts`
- Modify: `src/stores/workspaceStore.ts` (import helpers, delete duplicate function bodies)

- [ ] **Step 1: Write failing tests**

```ts
// src/stores/__tests__/workspaceTreeHelpers.test.ts
import { describe, it, expect } from 'vitest'
import {
  removeLeafFromTree,
  insertLeafIntoTabs,
  reorderLeafInTabsTree,
  splitTabsWithLeaf,
} from '../workspaceTreeHelpers'
import type { WorkspaceLeaf, WorkspaceTabs, WorkspaceSplit, WorkspaceNode } from '../types'

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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run src/stores/__tests__/workspaceTreeHelpers.test.ts
```
Expected: FAIL — "Cannot find module '../workspaceTreeHelpers'"

- [ ] **Step 3: Create workspaceTreeHelpers.ts**

```ts
// src/stores/workspaceTreeHelpers.ts
import type { WorkspaceLeaf, WorkspaceTabs, WorkspaceSplit, WorkspaceNode } from './types'

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

// Returns null when the node itself should be removed (tabs became empty).
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

// Returns null when the node itself should be removed (all leaves gone).
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run src/stores/__tests__/workspaceTreeHelpers.test.ts
```
Expected: All tests PASS.

- [ ] **Step 5: Update workspaceStore.ts — import helpers, delete duplicate function bodies**

At the top of `workspaceStore.ts`, replace the existing import section to add the new imports:

```ts
import { loadFromStorage, saveToStorage } from '../lib/localStorage'
import { getFileViewForExt, getView } from '../lib/pluginRegistry'
import { setRuntimeStore } from './runtimeStore'
import {
  mapNode,
  findParentTabs,
  findTabsById,
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
```

Then delete these three function bodies from workspaceStore.ts (they are now imported):
- `function mapNode(...)` (lines ~188–204)
- `function findTabsById(...)` (lines ~206–215)
- `function findParentTabs(...)` (lines ~174–186)

- [ ] **Step 6: Run full test suite**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run
```
Expected: All 8 test files pass.

- [ ] **Step 7: Commit**

```bash
git add src/stores/workspaceTreeHelpers.ts src/stores/__tests__/workspaceTreeHelpers.test.ts src/stores/workspaceStore.ts
git commit -m "feat: extract workspace tree helpers with unit tests"
```

---

### Task 3: New workspace store actions

**Files:**
- Modify: `src/stores/workspaceStore.ts`

- [ ] **Step 1: Add helper imports to workspaceStore.ts**

Update the import from `./workspaceTreeHelpers` to include all helpers:

```ts
import {
  mapNode,
  findParentTabs,
  findTabsById,
  removeLeafFromTree,
  insertLeafIntoTabs,
  reorderLeafInTabsTree,
  splitTabsWithLeaf,
} from './workspaceTreeHelpers'
```

- [ ] **Step 2: Add 4 new actions to `workspaceActions` after `splitSidebarLeaf`**

```ts
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
    // No-op: dragging the only tab in a group onto its own split zone has no useful result.
    const sourceTabs = findParentTabs(root, leafId)
    if (sourceTabs && sourceTabs.id === targetTabsId && sourceTabs.children.length === 1) return
    const afterRemove = removeLeafFromTree(root, leafId) ??
      ({ type: 'tabs', id: ROOT_TABS_ID, activeLeafId: null, children: [] } as WorkspaceTabs)
    // If targetTabsId was also removed by cleanup, fall back to ROOT_TABS_ID.
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
      const found = (node as WorkspaceTabs).children.find(l => l.id === leafId)
      if (!found) return node
      movedLeaf = found
      const remaining = (node as WorkspaceTabs).children.filter(l => l.id !== leafId)
      const nextActive = (node as WorkspaceTabs).activeLeafId === leafId
        ? (remaining[remaining.length - 1]?.id ?? null)
        : (node as WorkspaceTabs).activeLeafId
      return { ...node, children: remaining, activeLeafId: nextActive }
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
```

- [ ] **Step 3: Run full test suite**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run
```
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/stores/workspaceStore.ts
git commit -m "feat: add reorderLeafInTabs, moveLeafToTabs, moveLeafAsSplit, moveSidebarLeaf actions"
```

---

### Task 4: Thread `area` prop through the component tree

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/workspace/WorkspaceNodeRenderer.tsx`
- Modify: `src/components/workspace/WorkspaceSplitView.tsx`
- Modify: `src/components/workspace/SidebarRenderer.tsx`
- Modify: `src/components/workspace/WorkspaceTabsView.tsx`

- [ ] **Step 1: Update App.tsx**

Change:
```tsx
<WorkspaceNodeRenderer node={activeRoot().main} />
```
To:
```tsx
<WorkspaceNodeRenderer node={activeRoot().main} area="main" />
```

- [ ] **Step 2: Update SidebarRenderer.tsx**

In the `<For each={sidebar().children}>` loop, change:
```tsx
<WorkspaceNodeRenderer node={node} />
```
To:
```tsx
<WorkspaceNodeRenderer node={node} area={props.side} />
```

- [ ] **Step 3: Replace WorkspaceNodeRenderer.tsx**

```tsx
import { Match, Switch } from 'solid-js'
import { ROOT_TABS_ID } from '../../stores/workspaceStore'
import { WorkspaceSplitView } from './WorkspaceSplitView'
import { WorkspaceTabsView } from './WorkspaceTabsView'
import { WorkspaceLeafView } from './WorkspaceLeafView'
import type { WorkspaceNode, WorkspaceSplit, WorkspaceTabs, WorkspaceLeaf } from '../../stores/types'

export function WorkspaceNodeRenderer(props: {
  node: WorkspaceNode
  area: 'left' | 'main' | 'right'
}) {
  return (
    <Switch>
      <Match when={props.node.type === 'split'}>
        <WorkspaceSplitView node={props.node as WorkspaceSplit} area={props.area} />
      </Match>
      <Match when={props.node.type === 'tabs'}>
        <WorkspaceTabsView
          node={props.node as WorkspaceTabs}
          area={props.area}
          isRoot={(props.node as WorkspaceTabs).id === ROOT_TABS_ID}
        />
      </Match>
      <Match when={props.node.type === 'leaf'}>
        <WorkspaceLeafView leaf={props.node as WorkspaceLeaf} isActive={true} />
      </Match>
    </Switch>
  )
}
```

- [ ] **Step 4: Replace WorkspaceSplitView.tsx**

```tsx
import { For } from 'solid-js'
import { WorkspaceNodeRenderer } from './WorkspaceNodeRenderer'
import type { WorkspaceSplit } from '../../stores/types'

export function WorkspaceSplitView(props: {
  node: WorkspaceSplit
  area: 'left' | 'main' | 'right'
}) {
  return (
    <div
      class="flex h-full w-full"
      style={{ 'flex-direction': props.node.direction === 'horizontal' ? 'row' : 'column' }}
    >
      <For each={props.node.children}>
        {(child) => (
          <div class="flex-1 min-w-0 min-h-0 overflow-hidden">
            <WorkspaceNodeRenderer node={child} area={props.area} />
          </div>
        )}
      </For>
    </div>
  )
}
```

- [ ] **Step 5: Add `area` prop to WorkspaceTabsView signature only (no other changes yet)**

In `WorkspaceTabsView.tsx`, update the props interface:
```tsx
export function WorkspaceTabsView(props: {
  node: WorkspaceTabs
  area: 'left' | 'main' | 'right'
  isRoot?: boolean
}) {
```

- [ ] **Step 6: Type-check**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit
```
Expected: No type errors.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/components/workspace/WorkspaceNodeRenderer.tsx src/components/workspace/WorkspaceSplitView.tsx src/components/workspace/SidebarRenderer.tsx src/components/workspace/WorkspaceTabsView.tsx
git commit -m "feat: thread area prop through workspace component tree"
```

---

### Task 5: Tab bar drag & drop (draggable tabs + reorder/join)

**Files:**
- Modify: `src/components/workspace/WorkspaceTabsView.tsx`
- Modify: `src/index.css`

This task makes tabs draggable and wires up the tab bar as a drop target for reordering and moving tabs into a group. Edge split zones come in Task 6.

- [ ] **Step 1: Add imports to WorkspaceTabsView.tsx**

```tsx
import { For, Show, createMemo, createSignal } from 'solid-js'
import { workspaceActions } from '../../stores/workspaceStore'
import { getView } from '../../lib/pluginRegistry'
import { dragState, setDragState, isDraggingMainTab } from '../../lib/tabDragState'
import type { WorkspaceLeaf, WorkspaceTabs } from '../../stores/types'
import { WorkspaceLeafView } from './WorkspaceLeafView'
```

(Replace the existing import block — `createSignal` and `Show` are new; `isDraggingMainTab` is new.)

- [ ] **Step 2: Add local drag signals inside the WorkspaceTabsView function body (before the return)**

```tsx
const [insertBeforeId, setInsertBeforeId] = createSignal<string>('__end__')
const [tabBarOver, setTabBarOver] = createSignal(false)
```

- [ ] **Step 3: Replace the entire return statement with this new version**

This is the complete new `WorkspaceTabsView` return. It adds `draggable`, `onDragStart`, `onDragEnd` to each tab; adds `onDragOver`/`onDragLeave`/`onDrop` to the tab bar container; and renders an insert cursor between tabs.

```tsx
return (
  <div class="flex flex-col h-full">
    {/* Tab bar */}
    <div class="h-8 bg-(--bg-base) border-b border-(--border)] flex items-stretch shrink-0 overflow-y-hidden">
      <div
        class="flex flex-1 overflow-x-auto overflow-y-hidden relative"
        onDragOver={(e) => {
          const state = dragState()
          if (!state) return
          if (props.area === 'main' && state.sourceArea !== 'main') return
          if (props.area !== 'main' && state.sourceArea === 'main') return
          e.preventDefault()
          e.dataTransfer!.dropEffect = 'move'
          setTabBarOver(true)
          const tabEls = Array.from(
            (e.currentTarget as HTMLElement).querySelectorAll('[data-leaf-id]'),
          ) as HTMLElement[]
          let target = '__end__'
          for (const el of tabEls) {
            const rect = el.getBoundingClientRect()
            if (e.clientX < rect.left + rect.width / 2) {
              target = el.dataset.leafId!
              break
            }
          }
          setInsertBeforeId(target)
        }}
        onDragLeave={(e) => {
          if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
            setTabBarOver(false)
            setInsertBeforeId('__end__')
          }
        }}
        onDrop={(e) => {
          e.preventDefault()
          setTabBarOver(false)
          const state = dragState()
          if (!state) return
          const beforeId = insertBeforeId() === '__end__' ? null : insertBeforeId()
          setInsertBeforeId('__end__')

          if (props.area !== 'main') {
            // Sidebar: accept only from opposite sidebar
            if (state.sourceArea !== 'main' && state.sourceArea !== props.area) {
              workspaceActions.moveSidebarLeaf(
                state.leafId,
                state.sourceArea as 'left' | 'right',
                props.area as 'left' | 'right',
              )
            }
            setDragState(null)
            return
          }

          // Main: reorder or move
          if (state.sourceTabsId === props.node.id) {
            workspaceActions.reorderLeafInTabs(props.node.id, state.leafId, beforeId)
          } else {
            workspaceActions.moveLeafToTabs(state.leafId, props.node.id, beforeId)
          }
          setDragState(null)
        }}
      >
        <For each={props.node.children}>
          {(leaf) => {
            const isActive = createMemo(() => leaf.id === props.node.activeLeafId)
            const isPinned = () => leaf.pinned
            const def = () => getView(leaf.viewState.type)
            const isPanelLeaf = () => def()?.kind === 'panel'
            const isDraggable = () => !isPanelLeaf() || props.area !== 'main'
            const isBeingDragged = () => dragState()?.leafId === leaf.id
            const showCursorBefore = () => tabBarOver() && insertBeforeId() === leaf.id

            return (
              <>
                <Show when={showCursorBefore()}>
                  <div class="tab-insert-cursor" />
                </Show>
                <div
                  data-ctx={!isPanelLeaf() ? 'tab' : undefined}
                  data-leaf-id={leaf.id}
                  data-tabs-id={props.node.id}
                  draggable={isDraggable()}
                  onDragStart={(e) => {
                    if (!isDraggable()) return
                    setDragState({ leafId: leaf.id, sourceTabsId: props.node.id, sourceArea: props.area })
                    e.dataTransfer!.effectAllowed = 'move'
                    const ghost = (e.currentTarget as HTMLElement).cloneNode(true) as HTMLElement
                    ghost.style.cssText = 'position:fixed;top:-200px;left:0;opacity:0.8;pointer-events:none;z-index:9999'
                    document.body.appendChild(ghost)
                    e.dataTransfer!.setDragImage(ghost, 16, 12)
                    requestAnimationFrame(() => document.body.removeChild(ghost))
                  }}
                  onDragEnd={() => setDragState(null)}
                  class={`flex items-center gap-1.5 px-3 border-r border-(--border)] cursor-pointer text-[11px] shrink-0
                    ${isActive()
                      ? 'bg-(--bg-base) text-(--text) border-b-2 border-b-(--accent) -mb-px'
                      : 'text-(--text-3) hover:bg-(--bg-hover)'}
                    ${isBeingDragged() ? 'opacity-40' : ''}`}
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
                    class={`max-w-30 truncate ${!isPanelLeaf() && !isPinned() && leaf.viewState.state.file ? 'italic' : ''}`}
                  >
                    {getTabLabel(leaf)}
                  </span>
                  {!isPanelLeaf() && (
                    <button
                      class="text-(--text-4) hover:text-(--text-2) text-[13px] leading-none ml-0.5"
                      onClick={(e) => {
                        e.stopPropagation()
                        workspaceActions.closeLeaf(leaf.id)
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              </>
            )
          }}
        </For>
        {/* End-of-list insert cursor */}
        <Show when={tabBarOver() && insertBeforeId() === '__end__'}>
          <div class="tab-insert-cursor" />
        </Show>
      </div>
      {props.isRoot && (
        <button
          class="px-2 shrink-0 text-(--text-3) hover:text-(--text-2) hover:bg-(--bg-hover) flex items-center transition-colors"
          onClick={() => workspaceActions.toggleSidebar('right')}
          title="切换右侧栏"
        >
          <PanelRight size={15} />
        </button>
      )}
    </div>
    {/* Leaf area */}
    <div class="flex-1 relative overflow-hidden">
      <For each={props.node.children}>
        {(leaf) => {
          const isActive = createMemo(() => leaf.id === props.node.activeLeafId)
          return (
            <div
              class="absolute inset-0 flex flex-col overflow-hidden"
              style={{ display: isActive() ? 'flex' : 'none' }}
            >
              <WorkspaceLeafView leaf={leaf} isActive={isActive()} />
            </div>
          )
        }}
      </For>
    </div>
  </div>
)
```

- [ ] **Step 4: Add insert cursor CSS in index.css**

Append to the end of `src/index.css`:

```css
/* Tab drag-and-drop */
.tab-insert-cursor {
  width: 2px;
  min-width: 2px;
  height: 20px;
  background: var(--accent);
  border-radius: 1px;
  align-self: center;
  flex-shrink: 0;
  pointer-events: none;
}
```

- [ ] **Step 5: Type-check**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit
```
Expected: No type errors.

- [ ] **Step 6: Start dev server and manually test**

```bash
cd /home/huxzhi/4-code/symbol-notes && npm run dev
```

Open 3 files. Verify:
- Drag a tab left/right within the same group → tabs reorder, insert cursor appears
- Drag a tab to another group's tab bar → tab moves into that group
- Dragged tab shows `opacity-40` while dragging

- [ ] **Step 7: Commit**

```bash
git add src/components/workspace/WorkspaceTabsView.tsx src/index.css
git commit -m "feat: tab bar drag-to-reorder and drag-to-join tabs group"
```

---

### Task 6: Edge drop zones (left / right / bottom splits)

**Files:**
- Modify: `src/components/workspace/WorkspaceTabsView.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Add `activeZone` signal inside WorkspaceTabsView (after existing signals)**

```tsx
const [activeZone, setActiveZone] = createSignal<'left' | 'right' | 'bottom' | null>(null)
```

- [ ] **Step 2: Add `makeZone` helper inside the WorkspaceTabsView function body (before the return)**

```tsx
function makeZone(zone: 'left' | 'right' | 'bottom') {
  return (
    <div
      class={`tab-drop-zone tab-drop-zone-${zone}${activeZone() === zone ? ' tab-drop-zone-active' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer!.dropEffect = 'move'
        setActiveZone(zone)
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
          setActiveZone(null)
        }
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setActiveZone(null)
        const state = dragState()
        if (!state || state.sourceArea !== 'main') return
        workspaceActions.moveLeafAsSplit(state.leafId, props.node.id, zone)
        setDragState(null)
      }}
    />
  )
}
```

- [ ] **Step 3: Add zones inside the leaf area div**

In the leaf area `<div class="flex-1 relative overflow-hidden">`, add zones after the `<For>`:

```tsx
<div class="flex-1 relative overflow-hidden">
  <For each={props.node.children}>
    {(leaf) => {
      const isActive = createMemo(() => leaf.id === props.node.activeLeafId)
      return (
        <div
          class="absolute inset-0 flex flex-col overflow-hidden"
          style={{ display: isActive() ? 'flex' : 'none' }}
        >
          <WorkspaceLeafView leaf={leaf} isActive={isActive()} />
        </div>
      )
    }}
  </For>
  <Show when={isDraggingMainTab() && props.area === 'main'}>
    {makeZone('left')}
    {makeZone('right')}
    {makeZone('bottom')}
  </Show>
</div>
```

- [ ] **Step 4: Add drop zone CSS in index.css**

```css
.tab-drop-zone {
  position: absolute;
  pointer-events: all;
  z-index: 50;
}

.tab-drop-zone-left  { left: 0;   top: 0; width: 30%; height: 100%; }
.tab-drop-zone-right { right: 0;  top: 0; width: 30%; height: 100%; }
.tab-drop-zone-bottom { bottom: 0; left: 0; width: 100%; height: 30%; }

.tab-drop-zone-active.tab-drop-zone-left {
  border-left: 3px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}
.tab-drop-zone-active.tab-drop-zone-right {
  border-right: 3px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}
.tab-drop-zone-active.tab-drop-zone-bottom {
  border-bottom: 3px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}
```

- [ ] **Step 5: Type-check**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit
```
Expected: No type errors.

- [ ] **Step 6: Start dev server and test splits**

```bash
cd /home/huxzhi/4-code/symbol-notes && npm run dev
```

Open 2 files. Drag one tab:
- To the **bottom zone** of the other → top/bottom split created, blue highlight on bottom edge during drag
- To the **right zone** of the other → left/right split created, blue highlight on right edge
- To the **left zone** of the other → left/right split created, new panel on left, blue highlight on left edge

Also verify: dragging a tab does NOT show zones on sidebar tabs views.

- [ ] **Step 7: Commit**

```bash
git add src/components/workspace/WorkspaceTabsView.tsx src/index.css
git commit -m "feat: edge drop zones for panel splitting (left/right/bottom)"
```

---

### Task 7: Sidebar panel tab drag between sidebars

**Files:**
- Modify: `src/components/workspace/WorkspaceTabsView.tsx`

Sidebar tabs all have `kind: 'panel'`, so `isPanelLeaf()` returns true. The `isDraggable()` predicate from Task 5 (`!isPanelLeaf() || props.area !== 'main'`) already makes panel leaves in sidebars draggable. The tab bar `onDrop` handler from Task 5 already handles `moveSidebarLeaf`. This task verifies and polishes.

- [ ] **Step 1: Verify draggable condition covers sidebar panels**

In `WorkspaceTabsView.tsx`, confirm the `isDraggable` computed is:
```tsx
const isDraggable = () => !isPanelLeaf() || props.area !== 'main'
```
This evaluates to `true` for panel leaves in left/right sidebars (since `props.area !== 'main'`), and `false` for panel leaves in main (shouldn't exist, but guarded).

- [ ] **Step 2: Verify onDragStart guards against main panel leaves**

Confirm `onDragStart` has this guard:
```tsx
onDragStart={(e) => {
  if (!isDraggable()) return
  // ... rest of handler
}}
```

- [ ] **Step 3: Verify the onDrop sidebar branch in tab bar**

Confirm the tab bar `onDrop` has:
```tsx
if (props.area !== 'main') {
  if (state.sourceArea !== 'main' && state.sourceArea !== props.area) {
    workspaceActions.moveSidebarLeaf(
      state.leafId,
      state.sourceArea as 'left' | 'right',
      props.area as 'left' | 'right',
    )
  }
  setDragState(null)
  return
}
```
This handles: drag from left to right sidebar (and vice versa). Same-sidebar drags are ignored (no reorder within sidebar tabs, per spec).

- [ ] **Step 4: Start dev server and test sidebar drag**

```bash
cd /home/huxzhi/4-code/symbol-notes && npm run dev
```

Drag the "Files" tab from left sidebar to the right sidebar's tab bar → verify it appears in right sidebar. Drag "Links" from right to left → verify it moves.

Verify: dropping a sidebar tab on the main area does nothing (no drop zones visible, tab bar of main ignores non-main sources).

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/WorkspaceTabsView.tsx
git commit -m "feat: sidebar panel tabs draggable between left and right sidebars"
```

---

### Task 8: Run full test suite and verify

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run
```
Expected: All tests pass (8+ test files).

- [ ] **Step 2: Type-check the whole project**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Manual end-to-end smoke test**

Start dev server. Test all scenarios:
1. Open 3 files → drag to reorder within same tab group → order changes
2. Open a split (`Ctrl+\` or via existing split action) → drag tab to other group's tab bar → tab moves
3. Drag tab to bottom edge → horizontal split (top/bottom)
4. Drag tab to right edge → vertical split (left/right)
5. Drag tab to left edge → vertical split with new panel on left
6. Drag left sidebar tab to right sidebar → tab appears in right sidebar
7. Drag tab away so source group becomes empty → verify source group collapses, split unwraps

- [ ] **Step 4: Final commit if any polish was done**

```bash
git add -p  # stage any small fixes only
git commit -m "fix: tab drag-and-drop polish"
```
(Skip if no changes.)
