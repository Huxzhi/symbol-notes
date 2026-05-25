# Context Menu Design

**Date:** 2026-05-25
**Status:** Approved

## Overview

Two parallel concerns addressed together:

1. **Right-click context menus** on tabs and file tree entries
2. **File operation state lifted to `runtimeStore`** — create, rename, delete all go through `runtimeStore.fileOp` so `FilesPanel` becomes a pure reactive view and any caller (toolbar, context menu) uses the same API

## File Operation State: `runtimeStore.fileOp`

### State shape

```ts
// src/stores/types.ts
type FileOp =
  | { type: 'create-file' | 'create-folder'; prefix: string }
  | { type: 'rename'; path: string }
  | null

interface RuntimeState {
  rootHandle: FileSystemDirectoryHandle | null
  leafInstances: Record<string, LeafRuntimeState>
  fileOp: FileOp   // replaces nothing — this is new
}
```

- `create-file` / `create-folder`: inline input shown in FilesPanel; `prefix` pre-fills the input (e.g. `'notes/'` for in-directory create, `''` for root)
- `rename`: inline input shown on the target entry; `path` identifies which entry to rename

### Actions: `src/actions/fileOpActions.ts` (new file)

Thin wrappers around `setRuntimeStore` + `fsActions`:

```ts
export const fileOpActions = {
  startCreate(mode: 'file' | 'folder', prefix = ''): void,
  startRename(path: string): void,
  cancel(): void,
  async confirmCreate(name: string): Promise<void>,
  async confirmRename(path: string, newName: string): Promise<void>,
  async deleteFile(path: string): Promise<void>,       // delegates to fsActions
  async deleteDirectory(path: string): Promise<void>,  // new in fsActions
}
```

`confirmCreate` calls `fsActions.createFile` or `fsActions.createDirectory`, then sets `fileOp` to `null`.
`confirmRename` calls `fsActions.renameFile`, then sets `fileOp` to `null`.
Both `cancel()` and any successful confirm set `fileOp` to `null`.

### FilesPanel changes

`FilesPanel` removes its local `createMode`/`newName` signals entirely. Instead:

- Reads `runtimeStore.fileOp` reactively
- Shows inline input when `fileOp.type` is `create-*` or `rename`
- Toolbar buttons call `fileOpActions.startCreate('file')` / `fileOpActions.startCreate('folder')`
- Input `onKeyDown`/`onBlur` call `fileOpActions.confirmCreate` / `fileOpActions.confirmRename` / `fileOpActions.cancel`

Rename input appears inline on the entry being renamed (identified by `fileOp.path`), pre-filled with the current filename (without `.md`).

## Global ContextMenu — Event Delegation + Registry

### Event delegation

One `contextmenu` listener on `document` (set up inside `ContextMenu.tsx` on mount). On right-click it walks up the DOM from `e.target` to find the nearest element with `data-ctx`, looks up the registered factory, builds items from `dataset`, and shows the menu.

```
document contextmenu → walk up to [data-ctx] → registry[type](dataset) → show menu
```

Elements declare their type and data via attributes:

```tsx
<div data-ctx="file"      data-path={entry.path}>
<div data-ctx="directory" data-path={entry.path}>
<div data-ctx="tab"       data-leaf-id={leaf.id} data-tabs-id={node.id}>
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

Factories registered once at app startup in `App.tsx`.

### Component: `src/components/ContextMenu.tsx`

Rendered once in `App.tsx` via SolidJS `Portal` (attached to `document.body`). Holds a module-level signal for `{ x, y, items }`.

**Close behavior:**
- Click outside (`document` `mousedown`)
- Press `Escape` (`document` `keydown`)
- Clicking any item (runs action then closes)

**Positioning:** Renders at `(clientX, clientY)`. Flips left/up if menu would overflow viewport edge.

**Styling:** CSS variables — `--bg-surface`, `--border`, `--text`, `--text-2`, `--bg-hover`, `--accent`. Separator is a 1px `--border` `<hr>`. No new packages.

## Tab Context Menu

Tab `div` in `WorkspaceTabsView` gets `data-ctx="tab"` + `data-leaf-id` + `data-tabs-id`. Factory registered in `App.tsx`:

| Item | Condition | Action |
|------|-----------|--------|
| 关闭 | Always | `workspaceActions.closeLeaf(d.leafId)` |
| 关闭其他 | `siblings.length > 1` | `workspaceActions.closeOtherLeaves(d.tabsId, d.leafId)` |
| 关闭右侧 | Not last tab | `workspaceActions.closeRightLeaves(d.tabsId, d.leafId)` |

Factory needs sibling count to conditionally disable items — it reads `activeLayout().root` to find the tabs node by `tabsId`.

**New workspace actions:**

```ts
closeOtherLeaves(tabsId: string, keepLeafId: string): void
// Keeps only keepLeafId, removes all others. Cleans leafInstances. Sets activeLeafId = keepLeafId.

closeRightLeaves(tabsId: string, leafId: string): void
// Removes all leaves after leafId in the tabs array. Cleans leafInstances.
// If layout.activeLeafId was removed, sets activeLeafId = leafId.
```

Both use `setLayout` + `produce(s => { delete s[id] })` for leafInstances, consistent with `closeLeaf`.

## File / Directory Context Menu

### File entry (`data-ctx="file"`)

| Item | Action |
|------|--------|
| 重命名 | `fileOpActions.startRename(path)` |
| 删除 | `confirm()` → `fileOpActions.deleteFile(path)` |

### Directory entry (`data-ctx="directory"`)

| Item | Action |
|------|--------|
| 新建文件 | `fileOpActions.startCreate('file', path + '/')` |
| 新建文件夹 | `fileOpActions.startCreate('folder', path + '/')` |
| 重命名 | `fileOpActions.startRename(path)` |
| — separator — | |
| 删除文件夹 | `confirm()` → `fileOpActions.deleteDirectory(path)` |

### `fsActions.deleteDirectory` (new)

```ts
async deleteDirectory(path: string): Promise<void>
```

1. Navigate to parent dir via `rootHandle`, call `removeEntry(name, { recursive: true })`
2. Collect all `fileMap` entries where `entry.path === path || entry.path.startsWith(path + '/')`
3. For each entry with `kind === 'file'`: `invalidateFile`, `deleteFileStatEntry`, `knowledgeActions.removeFileMeta`
4. Remove all collected entries from `fileMap` in one `produce` call

## File Structure Changes

| File | Change |
|------|--------|
| `src/stores/types.ts` | Add `FileOp` type; add `fileOp: FileOp` to `RuntimeState` |
| `src/stores/runtimeStore.ts` | Initialize `fileOp: null` |
| `src/actions/fileOpActions.ts` | **New** — `startCreate`, `startRename`, `cancel`, `confirmCreate`, `confirmRename`, `deleteFile`, `deleteDirectory` |
| `src/actions/fsActions.ts` | Add `deleteDirectory` |
| `src/lib/contextMenuRegistry.ts` | **New** — registry + `registerContextMenu` / `getMenuItems` |
| `src/components/ContextMenu.tsx` | **New** — event delegation + Portal menu |
| `src/App.tsx` | Add `<ContextMenu />`; register all factories |
| `src/components/workspace/WorkspaceTabsView.tsx` | Add `data-ctx="tab"` + data attrs to tab divs |
| `src/actions/workspaceActions.ts` | Add `closeOtherLeaves`, `closeRightLeaves` |
| `src/components/panels/FilesPanel.tsx` | Add `data-ctx` + data attrs; replace local signals with `runtimeStore.fileOp` + `fileOpActions` |

## Out of Scope

- Directory rename (File System Access API requires copy+delete; deferred)
- Drag-and-drop reordering
