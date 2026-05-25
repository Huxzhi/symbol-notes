# Context Menu Design

**Date:** 2026-05-25
**Status:** Approved

## Overview

Add right-click context menus to two surfaces:
1. **Tabs** — Close, Close Others, Close to Right
2. **Directory entries in FilesPanel** — New File, New Folder, Delete Folder (with confirm)

## Architecture: Global ContextMenu Singleton

### Component: `src/components/ContextMenu.tsx`

A single context menu component rendered once at the app root via SolidJS `Portal` (attached to `document.body`). All consumers share one instance.

**State shape (module-level signal):**

```ts
type MenuItem =
  | { label: string; action: () => void; disabled?: boolean }
  | { separator: true }

type MenuState = { x: number; y: number; items: MenuItem[] } | null
```

**Public API:**

```ts
// Called by any component to open the menu
export function showContextMenu(e: MouseEvent, items: MenuItem[]): void

// Rendered once in App.tsx
export function ContextMenu(): JSX.Element
```

**Close behavior:**
- Click outside: `document` `mousedown` listener (via `@solid-primitives/event-listener`)
- Press `Escape`: `document` `keydown` listener
- Click any menu item: closes after running action

**Positioning:** Menu renders at `(e.clientX, e.clientY)`. If menu would overflow viewport right/bottom edge, it flips to render left/above the cursor.

**Styling:** Uses existing CSS variables — `--bg-surface`, `--border`, `--text`, `--text-2`, `--bg-hover`, `--accent`. Separator is a `1px` `--border` horizontal rule. No external style library needed.

**Installation:** `@solid-primitives/event-listener` added to dependencies.

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

Directory `div` in `FileTreeNode` gains `onContextMenu`. Menu items:

| Item | Action |
|------|--------|
| 新建文件 | Pre-fills inline input with `entry.path + '/'` prefix; user types the filename |
| 新建文件夹 | Pre-fills inline input with `entry.path + '/'` prefix; user types folder name |
| 删除文件夹 | `confirm()` dialog → `fsActions.deleteDirectory(entry.path)` |

**Inline input pre-fill:** `FilesPanel` already has `newName` signal and `createMode`. Extend `startCreate` to accept an optional `prefix` string, which is set into `newName` so the input is pre-filled with `parentPath/`.

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
| `src/components/ContextMenu.tsx` | New — global context menu component + `showContextMenu` |
| `src/App.tsx` | Add `<ContextMenu />` at bottom |
| `src/components/workspace/WorkspaceTabsView.tsx` | Add `onContextMenu` to tab divs |
| `src/actions/workspaceActions.ts` | Add `closeOtherLeaves`, `closeRightLeaves` |
| `src/components/panels/FilesPanel.tsx` | Add `onContextMenu` to directory entries; extend `startCreate` with prefix |
| `src/actions/fsActions.ts` | Add `deleteDirectory` |

## Out of Scope

- File (non-directory) right-click menu
- Rename via context menu
- Drag-and-drop reordering
