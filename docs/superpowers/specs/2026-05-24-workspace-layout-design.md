# Workspace Layout Redesign

**Date:** 2026-05-24
**Branch:** feat/global-store-refactor

## Goal

Unify left/main/right panels under a single workspace tree (similar to Obsidian), support splits and tab switching in both sidebars, and allow multiple named workspaces to be switched via the StatusBar.

---

## Data Model (`src/stores/types.ts`)

### Deletions

- `SidebarSplit` (old top-level field form)
- `WorkspaceState.left`, `.right` (moved into `WorkspaceRoot`)
- `WorkspaceState.leftPanelView`, `.rightPanelView` (replaced by tree)
- `WorkspaceState.activeLeafId` (moved into `WorkspaceLayout`)
- `WorkspaceState.main` (moved into `WorkspaceRoot`)

### New Types

```ts
// Sidebar container — not a WorkspaceNode, not part of the main union
export interface SidebarSplit {
  id: string
  width: number
  collapsed: boolean
  children: WorkspaceNode[]   // inner tree: WorkspaceTabs / WorkspaceSplit / WorkspaceLeaf
}

// Root of the whole workspace tree
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

// Top-level workspace state
export interface WorkspaceState {
  layouts: WorkspaceLayout[]
  activeLayoutId: string
  // Global settings — not per-layout
  theme: ThemeId
  customCSS: string
  showSettings: boolean
  autoTimestamps: boolean
  showOtherFiles: boolean
}
```

`WorkspaceNode` union is unchanged: `WorkspaceSplit | WorkspaceTabs | WorkspaceLeaf`.

Panel leaves in sidebars reuse `WorkspaceLeaf` with `viewState.type` pointing to a registered `kind: 'panel'` view (e.g. `'files'`, `'links'`).

---

## Store (`src/stores/globalStore.ts`)

### Initial Layout

```ts
export const DEFAULT_LAYOUT_ID = 'default'

const initialLayout: WorkspaceLayout = {
  id: DEFAULT_LAYOUT_ID,
  name: '默认',
  root: {
    left: {
      id: 'left-root', width: 190, collapsed: false,
      children: [{
        type: 'tabs', id: 'left-tabs',
        activeLeafId: 'leaf-files',
        children: [{ type: 'leaf', id: 'leaf-files',
          viewState: { type: 'files', state: {} }, pinned: false }],
      }],
    },
    main: { type: 'tabs', id: ROOT_TABS_ID, activeLeafId: null, children: [] },
    right: {
      id: 'right-root', width: 200, collapsed: false,
      children: [{
        type: 'tabs', id: 'right-tabs',
        activeLeafId: 'leaf-links',
        children: [{ type: 'leaf', id: 'leaf-links',
          viewState: { type: 'links', state: {} }, pinned: false }],
      }],
    },
  },
  activeLeafId: null,
}
```

### Derived Helpers

```ts
export function activeLayout(): WorkspaceLayout
export function activeRoot(): WorkspaceRoot
export function activeFilePath(): string | null  // searches main tree only
```

`findLeafInTree` is extended to `findLeafInRoot(root, leafId)` which searches left.children + main + right.children.

---

## Actions (`src/actions/workspaceActions.ts`)

### Internal Path Helper

All mutations target the active layout:

```ts
function layoutIdx(): number  // index in layouts array
// path prefix: ['workspace', 'layouts', layoutIdx(), ...]
```

### Modified Actions

- `createLeaf`, `closeLeaf`, `activateLeaf`, `setLeafViewState`, `setLeafPinned`, `splitLeaf`, `openPage`, `clearAllLeaves`, `renameLeafPath` — path updated to go through `layouts[layoutIdx()].root.main`

### New Sidebar Actions (replace old toggleLeft/toggleRight/resizeSidebar)

```ts
toggleSidebar(side: 'left' | 'right'): void
resizeSidebar(side: 'left' | 'right', width: number): void

// Add a panel leaf to a specific tabs group in a sidebar
addSidebarLeaf(side: 'left' | 'right', tabsId: string, type: string): void

// Split a sidebar tabs group vertically (stacks panels)
splitSidebarLeaf(side: 'left' | 'right', leafId: string): void
```

### New Layout Actions

```ts
createLayout(name: string): string   // clones current sidebar structure, clears main; returns new id
switchLayout(id: string): void
renameLayout(id: string, name: string): void
deleteLayout(id: string): void       // no-op if only one layout remains
```

---

## Components

### `SidebarRenderer` (`src/components/workspace/SidebarRenderer.tsx`)

Simplified to use `WorkspaceNodeRenderer` for the inner tree:

```tsx
export function SidebarRenderer(props: { side: 'left' | 'right' }) {
  const sidebar = () => activeRoot()[props.side]
  return (
    <div style={{ width: sidebar().collapsed ? '0px' : `${sidebar().width}px` }} ...>
      <WorkspaceNodeRenderer node={sidebar().children[0]} />
    </div>
  )
}
```

The hardcoded `LeftContent` / `RightContent` components are deleted. The right sidebar's tab bar now comes from `WorkspaceTabsView` like everything else.

### `WorkspaceTabsView` — sidebar context

Add a `context?: 'main' | 'sidebar'` prop. When `context === 'sidebar'`:
- Hide close (×) button on tabs
- Disable pin double-click

Detection can also be done inside by checking `getView(type)?.kind === 'panel'` per leaf, which avoids prop drilling.

### `App.tsx`

Structure unchanged. `globalStore.workspace.left/right` → `activeRoot().left/right`.

### `StatusBar` — workspace switcher

Clicking the current layout name opens a floating panel above the StatusBar:

```
┌─────────────────────────┐
│ ✓ 默认          [重命名] │
│   工作区 2      [重命名] │
├─────────────────────────┤
│ + 新建工作区             │
└─────────────────────────┘
```

- Click name → `switchLayout(id)`
- `✓` marks active layout
- Hover shows delete button (only when ≥ 2 layouts exist)
- Rename: inline `<input>` on click of rename button → `renameLayout(id, name)`
- New: `createLayout('工作区 N')` — clones sidebar structure, empty main

---

## localStorage Migration

Old key `sn-workspace` contains the flat structure (`left.width`, `leftPanelView`, etc.). On load:

1. Detect old format by checking for `leftPanelView` key.
2. Convert: wrap old `main` into `root.main`, build default sidebar trees, create a single `WorkspaceLayout` named `'默认'`.
3. On parse failure, silently use `initialLayout`.

---

## File Change Summary

| File | Change |
|---|---|
| `src/stores/types.ts` | Add `SidebarSplit`, `WorkspaceRoot`, `WorkspaceLayout`; rewrite `WorkspaceState` |
| `src/stores/globalStore.ts` | New initial state, `activeLayout()`, `activeRoot()`, `findLeafInRoot()` |
| `src/actions/workspaceActions.ts` | Path updates, new sidebar/layout actions |
| `src/components/workspace/SidebarRenderer.tsx` | Simplify to delegate to `WorkspaceNodeRenderer` |
| `src/components/workspace/WorkspaceTabsView.tsx` | Add sidebar context (hide close button for panel leaves) |
| `src/components/StatusBar.tsx` | Workspace switcher UI |
| `src/App.tsx` | `activeRoot()` instead of `globalStore.workspace.left/right` |
