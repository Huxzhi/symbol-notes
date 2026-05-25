# Context Menu Design

**Date:** 2026-05-25
**Status:** Approved

## Overview

Add right-click context menus to two surfaces:
1. **Tabs** — Close, Close Others, Close to Right
2. **Directory entries in FilesPanel** — New File, New Folder, Delete Folder (with confirm)

## Architecture: Global ContextMenu — Event Delegation + Registry

### Event delegation

One `contextmenu` listener on `document` (in `ContextMenu.tsx`). On right-click, it walks up the DOM from `e.target` to find the nearest element with a `data-ctx` attribute, then looks up the registered item factory for that type, builds items from `dataset`, and shows the menu.

```
document contextmenu → walk up to [data-ctx] → registry[type](dataset) → show menu
```

Elements declare their type and data via attributes:
```tsx
<div data-ctx="directory" data-path={entry.path}>
<div data-ctx="tab" data-leaf-id={leaf.id} data-tabs-id={node.id}>
```

### Registry: `src/lib/contextMenuRegistry.ts`

```ts
type MenuItem =
  | { label: string; action: () => void; disabled?: boolean }
  | { separator: true }

type ItemFactory = (dataset: DOMStringMap) => MenuItem[]

export function registerContextMenu(type: string, factory: ItemFactory): void
export function getMenuItems(type: string, dataset: DOMStringMap): MenuItem[]
```

Factories are registered once at app startup (e.g., in `App.tsx` or alongside the relevant action files).

### Component: `src/components/ContextMenu.tsx`

Rendered once in `App.tsx` via `Portal` (attached to `document.body`). Holds a module-level signal for `{ x, y, items }`.

**Public API:**

```ts
// Internal — called by the document contextmenu handler
function showMenuAt(x: number, y: number, items: MenuItem[]): void

// Rendered once in App.tsx
export function ContextMenu(): JSX.Element
```

**Close behavior:**
- Click outside: `document` `mousedown` listener
- Press `Escape`: `document` `keydown` listener
- Click any menu item: closes after running action

**Positioning:** Menu renders at `(e.clientX, e.clientY)`. If menu would overflow viewport right/bottom edge, it flips to render left/above the cursor.

**Styling:** Uses existing CSS variables — `--bg-surface`, `--border`, `--text`, `--text-2`, `--bg-hover`, `--accent`. Separator is a `1px` `--border` horizontal rule.

**No extra packages needed** — event listeners added directly in `createEffect`/`onMount` with `onCleanup`.

## Tab Context Menu

**Location:** `src/components/workspace/WorkspaceTabsView.tsx`

Each tab `div` gains `onContextMenu`. The menu is built dynamically based on tab position:

| Item | Condition | Action |
|------|-----------|--------|
| 关闭 | Always | `workspaceActions.closeLeaf(leaf.id)` |
| 关闭其他 | `siblings.length > 1` | `workspaceActions.closeOtherLeaves(tabsId, leaf.id)` |
| 关闭右侧 | Leaf is not last in tabs | `workspaceActions.closeRightLeaves(tabsId, leaf.id)` |

**New workspace actions:**

```ts
closeOtherLeaves(tabsId: string, keepLeafId: string): void
// Removes all leaves in the tabs group except keepLeafId.
// Cleans up runtimeStore.leafInstances for each removed leaf.
// Sets activeLeafId to keepLeafId.

closeRightLeaves(tabsId: string, leafId: string): void
// Removes all leaves to the right of leafId in the tabs group.
// Cleans up runtimeStore.leafInstances for each removed leaf.
// If activeLeafId was among removed leaves, sets activeLeafId to leafId.
```

Both actions use `setLayout` (the scoped setter) and `produce` for leafInstances cleanup, consistent with existing `closeLeaf`.

## Directory Context Menu

**Location:** `src/components/panels/FilesPanel.tsx`

Directory `div` in `FileTreeNode` carries `data-ctx="directory"` and `data-path`. The item factory (registered in `App.tsx`) produces:

| Item | Action |
|------|--------|
| 新建文件 | `setRuntimeStore('pendingCreate', { mode: 'file', prefix: path + '/' })` |
| 新建文件夹 | `setRuntimeStore('pendingCreate', { mode: 'folder', prefix: path + '/' })` |
| 删除文件夹 | `confirm()` dialog → `fsActions.deleteDirectory(path)` |

**`pendingCreate` in `runtimeStore`:**

`RuntimeState` gains a new field:
```ts
pendingCreate: { mode: 'file' | 'folder'; prefix: string } | null
```

`FilesPanel` watches `runtimeStore.pendingCreate` reactively. When non-null, it shows the inline input pre-filled with `prefix` and `mode`. On confirm or cancel, it sets `pendingCreate` back to `null`.

The existing local `createMode`/`newName` signals in `FilesPanel` are replaced by reading from `runtimeStore.pendingCreate`. The toolbar buttons (new file, new folder) also write to `runtimeStore.pendingCreate` (with `prefix: ''`).

**New fs action:**

```ts
async deleteDirectory(path: string): Promise<void>
```

Implementation:
1. Navigate to the parent directory via `rootHandle`
2. Call `parentDir.removeEntry(dirName, { recursive: true })`
3. Collect all `fileMap` entries where `entry.path === path || entry.path.startsWith(path + '/')`
4. For each removed entry with `kind === 'file'`: call `invalidateFile`, `deleteFileStatEntry`, `knowledgeActions.removeFileMeta`
5. Remove all collected entries from `fileMap` in one `produce` call

## File Structure Changes

| File | Change |
|------|--------|
| `src/stores/types.ts` | Add `pendingCreate` field to `RuntimeState` |
| `src/stores/runtimeStore.ts` | Initialize `pendingCreate: null` |
| `src/lib/contextMenuRegistry.ts` | New — registry + `registerContextMenu` / `getMenuItems` |
| `src/components/ContextMenu.tsx` | New — event delegation listener + Portal menu component |
| `src/App.tsx` | Add `<ContextMenu />` + register all factories |
| `src/components/workspace/WorkspaceTabsView.tsx` | Add `data-ctx="tab"` + `data-leaf-id` + `data-tabs-id` to tab divs; remove inline × close button logic (now in menu) — or keep × and add menu alongside |
| `src/actions/workspaceActions.ts` | Add `closeOtherLeaves`, `closeRightLeaves` |
| `src/components/panels/FilesPanel.tsx` | Add `data-ctx="directory"` + `data-path` to dir entries; replace local `createMode`/`newName` signals with `runtimeStore.pendingCreate` |
| `src/actions/fsActions.ts` | Add `deleteDirectory` |

## Out of Scope

- File (non-directory) right-click menu
- Rename via context menu
- Drag-and-drop reordering
