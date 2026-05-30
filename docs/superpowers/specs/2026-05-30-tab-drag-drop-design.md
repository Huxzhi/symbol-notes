# Tab Drag & Drop Design

Date: 2026-05-30

## Overview

Obsidian-style tab drag-and-drop for the workspace: reorder tabs within a group, move tabs between groups, and split panels by dragging to edges.

## Scope

- **Main area tabs**: reorder, move to other tabs groups, split into new panels (bottom/left/right)
- **Sidebar tabs (left/right)**: drag between left and right sidebars only — cannot enter main area, cannot trigger splits
- **No external libraries**: native HTML5 Drag & Drop API

---

## Architecture & Data Flow

```
Tab onDragStart
  → write to global dragState signal { leafId, sourceTabsId, sourceArea }

Drag over WorkspaceTabsView
  → onDragOver reads dragState, computes activeZone from mouse position
  → sets local activeZone signal ('tab-bar' | 'left' | 'right' | 'bottom' | null)

onDrop
  → calls workspaceStore action
  → clears dragState and activeZone

workspaceStore action
  → mutates workspace tree (move leaf, create split)
  → cleans up empty tabs (auto-collapse splits)

SolidJS reactive update
```

**New file: `src/lib/tabDragState.ts`**

```ts
interface TabDragState {
  leafId: string
  sourceTabsId: string
  sourceArea: 'left' | 'main' | 'right'
}
// createSignal<TabDragState | null>(null)
```

---

## Drop Zone Rules

### Zone Layout (per WorkspaceTabsView)

```
┌─────────────────────────────────┐
│  [tab][tab][tab]   ← tab bar    │  → join this tabs group (show insert cursor)
├─────────────────────────────────┤
│        │              │         │
│  left  │    center    │  right  │  left/right each 30% width
│  30%   │   (ignore)   │  30%    │
│        │              │         │
├────────┴──────────────┴─────────┤
│           bottom 30%            │  → split below
└─────────────────────────────────┘
```

### Behaviour Table

| Drag source | Target zone | Action |
|-------------|-------------|--------|
| main tab | tab bar (same group) | reorder — show insert cursor |
| main tab | tab bar (different group) | move into target tabs group |
| main tab | bottom | split below target (direction: vertical) |
| main tab | left | split left of target (direction: horizontal) |
| main tab | right | split right of target (direction: horizontal) |
| sidebar tab | tab bar (opposite sidebar) | move into opposite sidebar tabs |
| sidebar tab | any main zone | **no-op** |
| main tab | any sidebar tab bar | **no-op** |

### Visual Feedback

- Drag start: dragged tab becomes `opacity: 0.4`
- Hover bottom/left/right zone: 4px blue highlight bar on corresponding edge
- Hover tab bar: vertical insert cursor between tabs at computed position

---

## WorkspaceStore New Actions

### `reorderLeafInTabs(tabsId, leafId, insertBeforeLeafId | null)`
Reorder within the same tabs group. `null` means append to end.

### `moveLeafToTabs(leafId, targetTabsId, insertBeforeLeafId | null)`
Remove leaf from source tabs, insert into target tabs at given position. Triggers empty-tabs cleanup.

### `moveLeafAsSplit(leafId, targetTabsId, side: 'left' | 'right' | 'bottom')`
Remove leaf from source, create a new `WorkspaceTabs` wrapping it, then replace `targetTabsId` node with a new `WorkspaceSplit`:

- `bottom` → `direction: 'vertical'`, order: `[targetTabs, newTabs]`
- `right` → `direction: 'horizontal'`, order: `[targetTabs, newTabs]`
- `left` → `direction: 'horizontal'`, order: `[newTabs, targetTabs]`

Triggers empty-tabs cleanup.

### `moveSidebarLeaf(leafId, fromSide, toSide)`
Remove from `fromSide` first tabs, append to `toSide` first tabs.

### Shared Empty-Tabs Cleanup

```
removeLeafFromSourceTabs(tabsId, leafId):
  1. Remove leaf from tabs.children
  2. Update tabs.activeLeafId to previous sibling or null
  3. If tabs.children is now empty:
       - Find parent split → remove this tabs from split.children
       - If split has 1 child left → replace split node with that child
       - If split has 0 children → replace with empty tabs (ROOT_TABS_ID fallback)
  4. Update layout.activeLeafId if it pointed to the removed leaf
```

---

## Component Changes

### New file: `src/lib/tabDragState.ts`
Exports `dragState` signal, `setDragState`, and `isDraggingMainTab()` helper.

### `WorkspaceTabsView.tsx`

**New prop:**
```ts
area: 'left' | 'main' | 'right'
```

**Each tab element:**
- `draggable={!isPanelLeaf()}`
- `onDragStart` → sets `dragState`, sets ghost image via `e.dataTransfer.setDragImage`
- `onDragEnd` → clears `dragState`

**Tab bar:**
- `onDragOver` → compute insert position from mouse X, set local `insertBeforeId` signal
- `onDrop` → call `reorderLeafInTabs` or `moveLeafToTabs`
- Render insert cursor (absolute-positioned vertical line) at computed position

**Three overlay divs (main area only, visible only when `isDraggingMainTab()`):**
```tsx
<Show when={isDraggingMainTab()}>
  <div class="drop-zone-left"   onDragOver=... onDrop=... />
  <div class="drop-zone-right"  onDragOver=... onDrop=... />
  <div class="drop-zone-bottom" onDragOver=... onDrop=... />
</Show>
```

Each overlay sets a local `activeZone` signal on `onDragOver` and calls `moveLeafAsSplit` on `onDrop`.

**Sidebar drop target:**
- When `isDragging()` and `dragState().sourceArea !== 'main'`: tab bar of opposite sidebar shows drop highlight and accepts `onDrop` → calls `moveSidebarLeaf`.

### `WorkspaceSplitView.tsx`
No changes needed — split layout is purely driven by store data.

### `SidebarRenderer.tsx`
Pass `area` prop down to `WorkspaceTabsView` for sidebar tabs.

---

## Edge Cases

| Case | Handling |
|------|----------|
| Drag tab onto its own tab bar (same position) | No-op: `reorderLeafInTabs` checks source = dest |
| Last tab in a tabs group dragged to split zone | Cleanup removes the now-empty source tabs and collapses its parent split |
| Drag into a tabs group that is itself inside a split | `moveLeafToTabs` finds the tabs by ID anywhere in the tree, works correctly |
| Split a leaf that is the only tab in ROOT_TABS_ID | Creates split; ROOT_TABS_ID becomes empty → replaced by ROOT_TABS_ID with 0 children (still valid as drop target) |
