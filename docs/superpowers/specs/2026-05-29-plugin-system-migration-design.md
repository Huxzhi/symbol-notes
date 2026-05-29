# Plugin System Migration Design

**Date:** 2026-05-29  
**Status:** Approved

## Overview

Migrate all core UI features (panels, viewers, ribbon items, context menus) into the plugin system, making each feature self-contained. Simultaneously expand `PluginContext` to close API gaps that currently force plugins to import directly from internal stores.

## Goals

- App.tsx becomes a pure plugin registration list with no inline `registerView` / `registerRibbonItem` / `registerContextMenu` calls
- Every feature (core or optional) follows the same plugin pattern
- CalendarPlugin no longer bypasses `ctx.workspace` by importing from `workspaceStore` directly
- Panels and viewer components are co-located with their plugin, not in `components/`

## Directory Structure

### After migration

```
src/
  plugins/
    calendar/index.tsx   ← already exists; CalendarPanel/CalendarViewer moved inline
    files/index.tsx      ← FilesPanel component + files ribbon + file/dir context menus
    editor/index.tsx     ← EditorViewer + ImageViewer components + tab context menu
    links/index.tsx      ← LinksPanel component
    outline/index.tsx    ← OutlinePanel component
    tags/index.tsx       ← TagsPanel component
    search/index.tsx     ← SearchPanel component
    app/index.tsx        ← settings ribbon + graph ribbon (placeholder)
  components/
    workspace/           ← unchanged (WorkspaceLeafView, WorkspaceNodeRenderer, etc.)
    Ribbon.tsx           ← unchanged (pure UI reading ribbonRegistry)
    Settings.tsx         ← unchanged (pure UI reading settingsTabRegistry)
    StatusBar.tsx
    ContextMenu.tsx
    ToastContainer.tsx
    ConfirmModal.tsx
    panels/              ← emptied (components moved into plugins)
    viewer/              ← emptied (components moved into plugins)
```

### App.tsx final shape

```ts
registerPlugin(FilesPlugin)
registerPlugin(EditorPlugin)
registerPlugin(LinksPlugin)
registerPlugin(OutlinePlugin)
registerPlugin(TagsPlugin)
registerPlugin(SearchPlugin)
registerPlugin(AppPlugin)
registerPlugin(CalendarPlugin)
startPlugins()
```

No `registerView`, `registerRibbonItem`, or `registerContextMenu` calls remain in App.tsx.

## PluginContext API

### Existing (unchanged)

```ts
ctx.view(def: ViewDef): void
ctx.ribbon(def: RibbonItemDef): void
ctx.settings.tab(def: SettingsTabInput): void
ctx.settings.getConfig<T>(defaults: T): T
ctx.settings.setConfig(patch): void
ctx.workspace.openFile(path, opts?)
ctx.workspace.openPage(type)
ctx.workspace.openPanel(area, type, state?)
ctx.workspace.getLeafsByType(type)
ctx.workspace.activeLeafId(): string | null
```

### New additions

```ts
// workspace selectors
ctx.workspace.activeFilePath(): string | null
  // Returns the file path of the active leaf in the main area.
  // Panels use this to react to editor focus changes.

ctx.workspace.activeSidebarType(side: 'left' | 'right'): string | null
  // Returns the view type of the currently visible sidebar tab.
  // Used by ribbon isActive() callbacks.

ctx.workspace.switchSidebarPanel(side: 'left' | 'right', type: string): void
  // Toggles a sidebar panel: opens it if not active, closes if already active.
  // Standard action for ribbon items that control panels.

// context menu registration
ctx.contextMenu(
  type: string,
  factory: (data: ContextMenuData) => ContextMenuItem[]
): void
  // Registers a context menu factory for the given trigger type.
  // Called inside setup(); automatically unregistered on plugin teardown.
```

### Future slot (not in scope)

```ts
ctx.keybinding(def: KeybindingDef): void
  // Reserved for future keyboard shortcut registration.
  // Requires a separate keybinding registry design.
```

## Plugin Definitions

### FilesPlugin (`core: true`)

Registers:
- `ctx.view({ kind: 'panel', position: 'left', type: 'files', ... })` — FilesPanel component defined inline
- `ctx.ribbon({ id: 'files', ... onClick: switchSidebarPanel('left', 'files') })`
- `ctx.contextMenu('file', factory)` — rename, delete
- `ctx.contextMenu('directory', factory)` — new file, new folder, delete folder

### EditorPlugin (`core: true`)

Registers:
- `ctx.view({ kind: 'file', type: 'markdown', canAcceptFile: ext => ext === '.md', ... })` — EditorViewer inline
- `ctx.view({ kind: 'file', type: 'image', canAcceptFile: ext => IMAGE_EXTS.has(ext), ... })` — ImageViewer inline
- `ctx.contextMenu('tab', factory)` — close, close others, close right

### LinksPlugin / OutlinePlugin / TagsPlugin / SearchPlugin (`core: true`)

Each registers one `ctx.view({ kind: 'panel', position: 'right', type: '...', ... })` with component defined inline. No ribbon or context menu.

### AppPlugin (`core: true`)

Registers:
- `ctx.ribbon({ id: 'graph', title: '知识图谱', ... })` — placeholder, no-op onClick
- `ctx.ribbon({ id: 'settings', position: 'bottom', ... onClick: appActions.toggleSettings() })`

### CalendarPlugin (updated)

Replace direct store imports with ctx calls:

| Before (direct import) | After (via ctx) |
|---|---|
| `activeSidebarType('left')` | `ctx.workspace.activeSidebarType('left')` |
| `workspaceActions.switchSidebarPanel(...)` | `ctx.workspace.switchSidebarPanel(...)` |
| `activeLayout()` + `findLeafInTree(...)` for calendar-page isActive | `ctx.workspace.getLeafsByType('calendar').includes(ctx.workspace.activeLeafId() ?? '')` |
| `workspaceActions.openPage(...)` | `ctx.workspace.openPage(...)` (already correct) |

## Implementation Notes

### PluginContext wiring (pluginRegistry.ts)

The three new `ctx.workspace` methods delegate to existing exported functions:

```ts
workspace: {
  // ... existing ...
  activeFilePath: () => activeFilePath(),           // from workspaceStore
  activeSidebarType: (side) => activeSidebarType(side), // from workspaceStore
  switchSidebarPanel: (side, type) => workspaceActions.switchSidebarPanel(side, type),
}
```

The new `ctx.contextMenu` method mirrors the `ctx.ribbon` pattern — register on call, unregister via `onCleanup`:

```ts
contextMenu(type, factory) {
  registerContextMenu(type, factory)
  onCleanup(() => unregisterContextMenu(type))
}
```

This requires `unregisterContextMenu(type)` to be added to `contextMenuRegistry.ts`.

### contextMenuRegistry cleanup

`contextMenuRegistry.ts` currently has no `unregisterContextMenu`. Add:

```ts
export function unregisterContextMenu(type: string): void {
  setMenus(prev => { const n = new Map(prev); n.delete(type); return n })
}
```

(Core plugins are `core: true` so they never unregister in practice, but the API must be correct for optional plugins.)

### Component co-location

Components are moved, not rewritten. The migration is mechanical:
1. Copy component source into the plugin file (or a sibling file in the plugin directory for large components)
2. Update imports to reflect the new location
3. Delete the old file in `components/panels/` or `components/viewer/`

Large components (FilesPanel, EditorViewer) may warrant a sibling file rather than inlining into `index.tsx` directly, e.g. `src/plugins/files/FilesPanel.tsx` imported by `src/plugins/files/index.tsx`. This is an implementation decision, not a constraint.

## Migration Order

1. Expand `PluginContext` (workspace additions + contextMenu)
2. Add `unregisterContextMenu` to contextMenuRegistry
3. Update CalendarPlugin to use ctx instead of direct store imports
4. Migrate core plugins one at a time: files → editor → links → outline → tags → search → app
5. Remove leftover empty files in `components/panels/` and `components/viewer/`
6. Verify App.tsx has no remaining raw registry calls
