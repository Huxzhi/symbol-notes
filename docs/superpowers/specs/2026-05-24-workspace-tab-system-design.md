# Workspace Tab System Design

**Date:** 2026-05-24  
**Status:** Approved

## Overview

Redesign the middle column's content switching from nested `<Show>` components into a proper workspace/tab system. All open panes stay in the DOM and are CSS-toggled for visibility, preserving CM6 editor state, image data URLs, and plugin page state across tab switches.

The architecture mirrors Obsidian's model: a `WorkspaceService` is the single authority for tab lifecycle, a `ViewRegistry` maps content types to components, and every content source (file browser, wikilinks, plugins) opens panes through the workspace API.

---

## Data Model

### Tab

```ts
interface Tab {
  id: string       // opaque ID generated with nanoid()
  type: string     // view type key — matches a ViewDef in the registry
  path?: string    // FileView only: the file path
  pinned: boolean
}
```

`path` is the only tab-level state. Plugin pages manage their own internal state (signals, localStorage) — nothing extra goes into Tab.

### uiStore changes

```ts
// ADD
tabs: Record<string, Tab>   // id → Tab
tabOrder: string[]           // ordered list of tab IDs
activeTabId: string | null   // currently visible tab

// REMOVE
activePageId: string | null  // replaced by activeTabId
```

`fileSystemStore.activeFilePath` and `fileSystemStore.openFilePaths` are removed. Consumers that need the active file path use a derived helper:

```ts
export const activeFilePath = (): string | null => {
  const { tabs, activeTabId } = uiStore
  return activeTabId ? (tabs[activeTabId]?.path ?? null) : null
}
```

### editorStore changes

```ts
// REMOVE
content: string   // CM6 view is the source of truth; no longer pushed through store
```

`cmView`, `isDirty`, `outLinks`, `headings` remain. The active `EditorPane` updates these when it becomes active.

---

## View Registry

**File:** `src/lib/viewRegistry.ts`

```ts
interface FileViewDef {
  kind: 'file'
  type: string
  getDisplayText(path: string): string
  getIcon?(): JSX.Element
  canAcceptFile(ext: string): boolean
  component: Component<{ tabId: string; isActive: boolean }>
}

interface PageViewDef {
  kind: 'page'
  type: string
  getDisplayText(): string
  getIcon?(): JSX.Element
  component: Component<{ tabId: string; isActive: boolean }>
}

type ViewDef = FileViewDef | PageViewDef

registerView(def: ViewDef): void
getView(type: string): ViewDef | undefined
getFileViewForExt(ext: string): FileViewDef | undefined
```

Built-in registrations (called at app startup):

```ts
registerView({
  kind: 'file', type: 'markdown',
  getDisplayText: path => path.split('/').pop()!,
  canAcceptFile: ext => ext === 'md',
  component: EditorPane,
})

registerView({
  kind: 'file', type: 'image',
  getDisplayText: path => path.split('/').pop()!,
  canAcceptFile: ext => ['png','jpg','jpeg','gif','svg','webp'].includes(ext),
  component: ImageViewer,
})

registerView({
  kind: 'page', type: 'calendar',
  getDisplayText: () => '日历',
  getIcon: () => <CalendarRange size={11} />,
  component: CalendarPage,
})
```

`pageRegistry.ts` and the `isImagePath` helper in `fileTypes.ts` are deleted — `canAcceptFile` replaces both.

---

## WorkspaceService

**File:** `src/services/workspaceService.ts`

Single authority for all tab lifecycle operations. No other module directly mutates `tabs`, `tabOrder`, or `activeTabId`.

### API

```ts
// Open a file. Resolves view type via canAcceptFile.
openFile(path: string, opts?: { newTab?: boolean; pin?: boolean }): Promise<void>

// Open a plugin page by view type.
openPage(type: string, opts?: { newTab?: boolean }): void

// Close a tab, activate the nearest neighbour.
closeTab(id: string): void

// Activate an existing tab.
setActiveTab(id: string): void

// Pin a tab (prevent preview replacement).
pinTab(id: string): void

// Internal: resolve or create the target leaf ID.
getLeaf(newTab: boolean): string
```

### openFile logic

```
1. Find FileViewDef via getFileViewForExt(ext)
2. If the file is already open in a tab → setActiveTab(existingId); return
3. targetId = getLeaf(opts.newTab ?? false)
4. If targetId is a preview tab: save if dirty, update tabs[targetId].path + type
5. If newTab: create new Tab, push to tabOrder
6. Apply auto-timestamps (read → write if needed) via fileSystemService
7. setActiveTab(targetId)
```

### getLeaf logic

```
- newTab = true  → always create a new Tab ID
- newTab = false →
    active tab is unpinned file tab?  → return its ID (preview replacement)
    otherwise (pinned / page / image / none) → create a new Tab ID
```

### Preview tab save-on-replace

When `getLeaf` returns an existing unpinned tab and its `EditorPane` is dirty, `workspaceService` calls `saveFile` before replacing the tab's path. The `isDirty` flag is read from `editorStore`.

---

## ContentPane

**File:** `src/components/ContentPane.tsx`

Replaces the nested `<Show>` blocks in `App.tsx`.

```tsx
function ContentPane() {
  return (
    <div class="flex-1 relative overflow-hidden">
      <For each={uiStore.tabOrder}>
        {(tabId) => {
          const tab = () => uiStore.tabs[tabId]
          const def = () => getView(tab().type)
          const isActive = () => uiStore.activeTabId === tabId
          return (
            <div
              class="absolute inset-0 flex flex-col overflow-hidden"
              style={{ display: isActive() ? 'flex' : 'none' }}
            >
              <Dynamic
                component={def()?.component}
                tabId={tabId}
                isActive={isActive()}
              />
            </div>
          )
        }}
      </For>
    </div>
  )
}
```

Adding a new view type requires only `registerView` — `ContentPane` and `App.tsx` need no changes.

---

## EditorPane

**File:** `src/components/EditorPane.tsx`

Per-tab editor. One CM6 `EditorView` instance per open markdown file. Stays in DOM for the lifetime of the tab.

```
Props: { tabId: string; isActive: boolean }

On mount:
  1. Read tab.path from uiStore.tabs[tabId]
  2. fileSystemService.readFile(path) → initial content
  3. Create CM6 EditorView with that content
  4. Register updateListener: updates own isDirty, triggers reindex debounce

createEffect on isActive → true:
  setEditorStore({ cmView: view, outLinks, headings, isDirty })

Ctrl+S:
  fileSystemService.writeFile(path, cmView.state.doc.toString())
  setEditorStore('isDirty', false)

onCleanup:
  view.destroy()
  if this was active: setEditorStore({ cmView: null })
```

`FileTitle` is rendered inside `EditorPane` (it already knows the path from the tab).

---

## fileSystemService

**File:** `src/services/fileSystemService.ts`

Scope reduced to pure file I/O. All tab/workspace logic removed.

**Keeps:**
- `openDirectory()` — directory picker
- `restoreDirectory()` — restore from IDB
- `buildTree()` — file tree
- `scanDirectory()` — knowledge indexing
- `readFile(path): Promise<string>`
- `writeFile(path, content): Promise<void>`
- `createFile()`, `deleteFile()`, `renameFile()`

**Removes:**
- `openFile()` — moved to `workspaceService`
- `openImageFile()` — merged into `workspaceService.openFile`
- `closeFile()` — moved to `workspaceService.closeTab`
- All `setEditorStore`, `setUIStore('activePageId')`, `setFileSystemStore('activeFilePath')` calls

---

## Sidebar (File Browser Plugin)

`Sidebar.tsx` treats itself as a plugin that calls through the workspace:

```ts
// single click
onClick={() => workspace.openFile(path)}

// double click or Ctrl+click
onDblClick={() => workspace.openFile(path, { newTab: true, pin: true })}
onClick with Ctrl => workspace.openFile(path, { newTab: true, pin: true })
```

No direct manipulation of `uiStore`, `editorStore`, or `fileSystemStore` tab fields.

---

## TabBar

`TabBar.tsx` reads display text and icon from the view registry:

```ts
const def = getView(tab.type)
const label = def.kind === 'file'
  ? def.getDisplayText(tab.path!)
  : def.getDisplayText()
const Icon = def.getIcon?.()
```

Active highlight: `uiStore.activeTabId === tabId`  
Unpinned tab: render label in italic  
Double-click tab → `workspace.pinTab(tabId)`  
Close button → `workspace.closeTab(tabId)`

---

## App.tsx

Middle column simplifies to:

```tsx
<div class="flex-1 flex flex-col overflow-hidden min-w-0">
  <TabBar />
  <ContentPane />
</div>
```

---

## Tab Opening Rules Summary

| Trigger | Call | Result |
|---------|------|--------|
| Sidebar single click | `workspace.openFile(path)` | Replace preview tab or new tab |
| Sidebar double/Ctrl click | `workspace.openFile(path, { newTab: true, pin: true })` | New pinned tab |
| Wikilink click | `workspace.openFile(path, { newTab: true, pin: true })` | New pinned tab |
| Ribbon / command | `workspace.openPage('calendar')` | New or existing page tab |

---

## Files Summary

| Action | File |
|--------|------|
| **New** | `src/lib/viewRegistry.ts` |
| **New** | `src/services/workspaceService.ts` |
| **New** | `src/components/ContentPane.tsx` |
| **New** | `src/components/EditorPane.tsx` (CM6 logic from Editor.tsx + FileTitle) |
| **Modify** | `src/stores/uiStore.ts` |
| **Modify** | `src/stores/fileSystemStore.ts` |
| **Modify** | `src/stores/editorStore.ts` |
| **Modify** | `src/services/fileSystemService.ts` |
| **Modify** | `src/components/TabBar.tsx` |
| **Modify** | `src/components/Sidebar.tsx` |
| **Modify** | `src/components/ImageViewer.tsx` |
| **Modify** | `src/components/App.tsx` |
| **Delete** | `src/lib/pageRegistry.ts` |
| **Delete** | `src/components/Editor.tsx` (absorbed into EditorPane) |
| **Delete** | `src/components/FileTitle.tsx` (absorbed into EditorPane) |
