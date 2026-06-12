# Per-Tab Navigation Bar (Back/Forward + Breadcrumb Path)

**Date:** 2026-06-12
**Status:** Approved design

## Problem

The main editor area shows files in tabs (leaves). Opening a file *reuses the active
unpinned leaf* — replacing its `viewState.state.file` in place (see
`workspaceStore.openLeaf`) — so a single tab's file changes over time, Obsidian-style.
But there is no way to go *back* to the previously-shown file in that tab, and no
always-visible indicator of the current file's path.

## Goals

Add a navigation bar **below the tab bar** of each main-area tab group, like Obsidian:

1. **Back / forward buttons** that walk that tab's own history of opened files.
2. A **breadcrumb** showing the current file's path (folder segments + filename).

## Non-Goals / Decisions

- **Per-tab history** (each leaf has its own back/forward stack; switching tabs switches
  the visible history). Not a single shared per-pane history.
- **Main area only.** Sidebars host panels, not CM6 file editors — no nav bar there.
- **Runtime-only** history (stored in the ephemeral runtime store; resets on app reload).
  No persistence in v1.
- **Folder breadcrumb segments are a reserved no-op** in v1 (hover-styled, clickable
  element, but `onClick` does nothing yet) — easy to later wire to "reveal in Files panel".
- **No** mouse back/forward buttons or Alt+←/→ shortcuts in v1 (buttons only).

## Design

### 1. Runtime state — `LeafRuntimeState` (`stores/types.ts`)

Add two fields:

```ts
history: string[]      // file paths this leaf has shown, oldest→newest
historyIndex: number   // current position in history; -1 when empty
```

A leaf with no runtime entry, or with an empty history, is treated as "no history"
(both arrows disabled). Default for a new entry: `history: [], historyIndex: -1`.

### 2. Pure history reducer (`stores/leafHistory.ts`, new)

```ts
// Append `file` as the new current entry. De-dupes when it equals the current
// entry; truncates any forward entries first (a new branch discards redo).
// `prevFile` seeds an empty history with the leaf's prior file so the first
// navigation in a restored/seeded leaf can still go Back.
export function pushHistory(
  history: string[], index: number, file: string, prevFile?: string,
): { history: string[]; index: number }
```

Behavior (unit-tested):
- empty history + `prevFile` given → seed `[prevFile]` before appending.
- `file === history[index]` → unchanged (no duplicate consecutive entry).
- otherwise → `history.slice(0, index + 1).concat(file)`, `index = len - 1`.

### 3. Recording in `workspaceStore`

A small `recordNav(leafId, prevFile, newFile)` applies `pushHistory` into
`leafInstances` via `produce`, creating the runtime entry if absent. It skips when
`newFile` is not a string.

Wire-in points:
- **`createLeaf(tabsId, viewState)`** — if `viewState.state.file` is set, initialize the
  new leaf's runtime entry to `history: [file], historyIndex: 0`.
- **`openLeaf` reuse branch** (active unpinned, non-calendar leaf): capture
  `prevFile = activeLeaf.viewState.state.file` before replacing, then after
  `setLeafViewState(...)` call `recordNav(activeLeafId, prevFile, newFile)`.
- **`renameLeafPath(oldPath, newPath)`** — also remap matching entries inside every
  leaf's runtime `history` array (so Back doesn't target a stale path).

`setLeafViewState` itself is **not** globally wrapped — non-navigation patches (e.g. the
calendar `{mode}` viewState) must not record history.

### 4. Navigation actions (`workspaceStore`)

```ts
navigateBack(leafId): void     // index>0 → index--, open history[index] in place
navigateForward(leafId): void  // index<len-1 → index++, open history[index] in place
```

Both move the runtime `historyIndex`, then set the leaf's viewState **directly**
(`{ type: getFileViewForPath(path).type, state: { file: path } }`) — bypassing
`openLeaf`/`recordNav` so the move is not re-recorded. No-op when out of bounds.

### 5. Breadcrumb helper (`components/workspace/breadcrumb.ts`, new)

```ts
// "journal/2026/note.md" → [{ name: 'journal', path: 'journal' },
//   { name: '2026', path: 'journal/2026' }] for folders, plus a file part.
export function splitBreadcrumb(path: string): {
  folders: { name: string; path: string }[]
  file: string   // filename without trailing .md
}
```

Unit-tested: nested path, root-level file (no folders), `.md` stripped.

### 6. `WorkspaceNavBar.tsx` (new component)

Rendered in `WorkspaceTabsView` between the tab bar and the leaf area, **only when
`props.area === 'main'`**. Props: the `WorkspaceTabs` node (or its active leaf).

- Resolves the active leaf via `node.activeLeafId`; reads `leafInstances[leafId]` for
  `history`/`historyIndex` and the leaf's `viewState`.
- **Back** ‹ : disabled when `historyIndex <= 0`; click → `navigateBack(leafId)`.
- **Forward** › : disabled when `historyIndex >= history.length - 1`; click →
  `navigateForward(leafId)`.
- **Breadcrumb**: when the active leaf has a file → render `splitBreadcrumb(file)`:
  folder segments as hover-styled buttons (`onClick` reserved no-op) joined by `/`, then
  the filename emphasized. When the active leaf has **no** file (e.g. the calendar page) →
  show the view's `getDisplayText()`; both arrows disabled.
- Styling mirrors existing toolbars: `h-7`, `border-b border-(--border)`, muted text,
  `text-[11px]`, hover backgrounds via theme vars.
- Hidden when the tab group is empty (no active leaf).

### 7. `WorkspaceTabsView.tsx` change

After the tab-bar `<div>` and before the `{/* Leaf area */}` block, add:

```tsx
<Show when={props.area === 'main' && props.node.activeLeafId}>
  <WorkspaceNavBar node={props.node} />
</Show>
```

## Files

| File | Change |
|---|---|
| `stores/types.ts` | `LeafRuntimeState` += `history`, `historyIndex` |
| `stores/leafHistory.ts` | **new** — pure `pushHistory` reducer |
| `stores/__tests__/leafHistory.test.ts` | **new** — `pushHistory` cases |
| `stores/workspaceStore.ts` | `recordNav`; wire into `createLeaf`/`openLeaf`/`renameLeafPath`; `navigateBack`/`navigateForward` |
| `components/workspace/breadcrumb.ts` | **new** — pure `splitBreadcrumb` |
| `components/workspace/__tests__/breadcrumb.test.ts` | **new** — `splitBreadcrumb` cases |
| `components/workspace/WorkspaceNavBar.tsx` | **new** — the nav bar |
| `components/workspace/WorkspaceTabsView.tsx` | render `WorkspaceNavBar` for main area |

## Testing

- Unit: `pushHistory` (seed/dedupe/truncate/append), `splitBreadcrumb` (nested / root /
  `.md` strip).
- Manual: open files in a tab → back returns to prior file, forward redoes; opening a new
  file after going back truncates the forward stack; switching tabs shows that tab's own
  history; breadcrumb tracks the current file; arrows disable at the ends; calendar page
  tab shows its name with disabled arrows.

## Risks

- **Runtime entry creation order:** the editor plugin also writes `leafInstances[leafId]`
  (cmView/isDirty). `recordNav`/init must merge into any existing entry via `produce`, not
  overwrite it. Initialization uses spread/defaults to preserve sibling fields.
- **Stale history paths** on delete: a deleted file can remain in history; navigating to it
  opens a missing file. Rename is handled (§3); delete is accepted as a minor v1 gap.
