# Store Domain Split Design

Date: 2026-05-26

## Goal

Split the monolithic `globalStore` into four domain stores, each co-located with its actions and responsible for its own persistence. Delete the `src/actions/` directory entirely.

## New File Structure

```
src/stores/
  types.ts           # Pure types only; remove GlobalState (no longer needed)
  cacheStore.ts      # CacheState + cacheActions + IndexedDB persistence
  workspaceStore.ts  # WorkspaceState + workspaceActions + localStorage sync
  settingsStore.ts   # SettingsState + settingsActions + localStorage sync
  runtimeStore.ts    # RuntimeState + appActions + fileActions (replaces both action files)

src/actions/         # Deleted entirely
```

`globalStore.ts` is deleted. `runtimeStore.ts` gains the actions that were in `appActions.ts` and `fileActions.ts`.

## Domain Breakdown

### `settingsStore.ts`

**State:** `SettingsState` — theme, customCSS, autoTimestamps, showOtherFiles

**Actions (from `appActions.ts`):**
- `setTheme`, `setCustomCSS`, `setAutoTimestamps`, `setShowOtherFiles`

**Persistence:** Reactive localStorage sync via `createRoot(() => createEffect(...))` at module level.
- Read: `loadFromStorage('sn-settings', defaults)` at init
- Write: `saveToStorage('sn-settings', { ...settingsStore })` on every change

**Exports:**
```ts
export { settingsStore, setSettingsStore }
export { settingsActions }
export type { ThemeId }
```

---

### `workspaceStore.ts`

**State:** `WorkspaceState` — layouts, activeLayoutId

**Actions (all of `workspaceActions.ts`):**
- Leaf: `createLeaf`, `closeLeaf`, `closeOtherLeaves`, `closeRightLeaves`, `activateLeaf`, `setLeafViewState`, `setLeafPinned`, `splitLeaf`, `clearAllLeaves`, `renameLeafPath`
- Navigation: `openFile`, `openPage`
- Sidebar: `toggleSidebar`, `activateSidebarLeaf`, `activateSidebarLeafById`, `splitSidebarLeaf`
- Layout: `createLayout`, `switchLayout`, `renameLayout`, `deleteLayout`

**Selectors (from `globalStore.ts`):**
- `activeLayout()`, `activeRoot()`, `activeFilePath()`
- `findLeafInTree()`, `findLeafInRoot()`

**Persistence:** Reactive localStorage sync.
- Read: `loadFromStorage('sn-workspace', { layouts: [initialLayout], activeLayoutId: DEFAULT_LAYOUT_ID })` with validator at init
- Write: `saveToStorage('sn-workspace', { layouts: workspaceStore.layouts, activeLayoutId: workspaceStore.activeLayoutId })` on every change

**Exports:**
```ts
export { workspaceStore, setWorkspaceStore }
export { workspaceActions }
export { activeLayout, activeRoot, activeFilePath, findLeafInTree, findLeafInRoot }
export { ROOT_TABS_ID, DEFAULT_LAYOUT_ID }
```

---

### `cacheStore.ts`

**State:** `CacheState` — files, backlinkMap, tagMap

**Actions (all of `cacheActions.ts`):**
- `reindexFile`, `remapFileLink`, `removeCacheEntry`

**Persistence:** IndexedDB via `idb-keyval`.
- Read: `initCacheStore(): Promise<void>` — calls `get('sn-cache')`, restores snapshot via `reconcile()`, called from App before vault scan
- Write: `createRoot(() => createEffect(...))` + 500 ms debounce → `set('sn-cache', snapshot)` on any cache change

**Exports:**
```ts
export { cacheStore, setCacheStore }
export { cacheActions }
export { initCacheStore }
export type { CmParsed }
```

---

### `runtimeStore.ts`

**State:** `RuntimeState` — rootHandle, leafInstances, fileOp, isIndexing, showSettings (unchanged)

**Actions added (from `appActions.ts`):**
- `openVault()` — directory picker → set rootHandle → clearAllLeaves → scanAndIndex
- `restoreVault()` — IDB rootHandle restore → scanAndIndex
- `toggleSettings()`, `isSettingsOpen()`

**Actions added (all of `fileActions.ts`):**
- All file CRUD/rename/move/delete operations

**No persistence** — runtime state is intentionally ephemeral.

**Exports:**
```ts
export { runtimeStore, setRuntimeStore }
export { appActions }
export { fileActions }
```

---

## Persistence Pattern

### localStorage (workspace + settings)

```ts
// At module level in each store file
createRoot(() => {
  createEffect(() => saveToStorage('sn-settings', { ...settingsStore }))
})
```

`createRoot` at module level is the standard SolidJS pattern for non-component reactive code. The effect runs once synchronously on module load (saving initial state), then re-runs on any tracked change.

### IndexedDB (cache)

```ts
// initCacheStore — called once from App.tsx before vault scan
export async function initCacheStore(): Promise<void> {
  const saved = await get<CacheState>('sn-cache')
  if (saved) setCacheStore(reconcile(saved))
}

// Debounced reactive save at module level
let _saveTimer: ReturnType<typeof setTimeout> | null = null
createRoot(() => {
  createEffect(() => {
    const snapshot = JSON.parse(JSON.stringify(cacheStore)) as CacheState
    if (_saveTimer) clearTimeout(_saveTimer)
    _saveTimer = setTimeout(() => set('sn-cache', snapshot), 500)
  })
})
```

`reconcile` (from `solid-js/store`) diffs the snapshot into the store without replacing all signal references, preserving component subscriptions.

---

## Consumer Import Migration

All ~18 files that currently import from `globalStore` or `src/actions/*` are updated:

| Old import | New import |
|---|---|
| `globalStore, setGlobalStore` (cache fields) | `cacheStore, setCacheStore` from `../stores/cacheStore` |
| `globalStore, setGlobalStore` (workspace fields) | `workspaceStore, setWorkspaceStore` from `../stores/workspaceStore` |
| `globalStore, setGlobalStore` (settings fields) | `settingsStore, setSettingsStore` from `../stores/settingsStore` |
| `activeLayout, activeRoot, findLeafInTree, ...` | from `../stores/workspaceStore` |
| `cacheActions` | from `../stores/cacheStore` |
| `workspaceActions` | from `../stores/workspaceStore` |
| `appActions` | from `../stores/runtimeStore` |
| `fileActions` | from `../stores/runtimeStore` |

`types.ts` removes `GlobalState` interface; all other types stay.

---

## Out of Scope

- No changes to `runtimeStore` state shape
- No changes to `fileCacheService` or `indexService` internals
- No new persistence for `runtimeStore` (ephemeral by design)
- No changes to component behavior or UI
