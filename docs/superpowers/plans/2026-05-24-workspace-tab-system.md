# Workspace Tab System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the middle column's nested `<Show>` routing with a workspace/tab system where every open pane stays in DOM, all content sources open tabs via `WorkspaceService`, and preview tab replacement swaps CM6 doc content in-place via `view.setState`.

**Architecture:** `ViewRegistry` maps extensions/page types to components; `WorkspaceService` owns all tab lifecycle (open/close/pin/preview-replace); `ContentPane` renders all tabs with `display: none` toggling so each `EditorPane` keeps its CM6 `EditorView` alive for the tab's lifetime.

**Tech Stack:** SolidJS (store, createEffect, For, Dynamic), CodeMirror 6 (EditorView.setState, EditorState.create), TypeScript, Vitest

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| **New** | `src/lib/viewRegistry.ts` | Register/look up view defs by type or extension |
| **New** | `src/services/workspaceService.ts` | Single authority for tab lifecycle |
| **New** | `src/components/ContentPane.tsx` | Render all tabs; CSS toggle active |
| **New** | `src/components/EditorPane.tsx` | Per-tab CM6 editor + FileTitle + save |
| **Modify** | `src/stores/uiStore.ts` | Add Tab, tabs, activeTabId; helpers activeFilePath/renameTabPath/clearTabs |
| **Modify** | `src/services/fileSystemService.ts` | Add readFile/writeFile/loadFileContent; remove old tab API; createFile returns path |
| **Modify** | `src/components/ImageViewer.tsx` | Props → `{ tabId; isActive }` |
| **Modify** | `src/components/TabBar.tsx` | Use viewRegistry + workspace API |
| **Modify** | `src/components/App.tsx` | Register views; use ContentPane |
| **Modify** | `src/components/Sidebar.tsx` | Use workspace.openFile |
| **Modify** | `src/components/CalendarPanel.tsx` | Use workspace.openFile |
| **Modify** | `src/components/CalendarPage.tsx` | Use workspace.openFile; accept tabId/isActive |
| **Modify** | `src/components/Ribbon.tsx` | Use workspace.openPage |
| **Modify** | `src/components/RightPanel.tsx` | Use activeFilePath() helper |
| **Modify** | `src/components/PropertiesPanel.tsx` | Read/write via editorStore.cmView |
| **Modify** | `src/components/StatusBar.tsx` | Remove editorStore.content usage |
| **Modify** | `src/stores/editorStore.ts` | Remove content field |
| **Modify** | `src/stores/fileSystemStore.ts` | Remove activeFilePath, openFilePaths |
| **Delete** | `src/components/Editor.tsx` | Absorbed into EditorPane |
| **Delete** | `src/components/FileTitle.tsx` | Absorbed into EditorPane |
| **Delete** | `src/lib/pageRegistry.ts` | Replaced by viewRegistry |

---

### Task 1: viewRegistry.ts

**Files:**
- Create: `src/lib/viewRegistry.ts`
- Create: `src/lib/__tests__/viewRegistry.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/lib/__tests__/viewRegistry.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerView,
  getView,
  getFileViewForExt,
  _clearRegistryForTest,
} from '../viewRegistry'

beforeEach(() => _clearRegistryForTest())

const makeFileDef = (type: string, ext: string) => ({
  kind: 'file' as const,
  type,
  getDisplayText: (p: string) => p.split('/').pop()!,
  canAcceptFile: (e: string) => e === ext,
  component: (() => null) as any,
})

describe('getView', () => {
  it('returns undefined for unregistered type', () => {
    expect(getView('markdown')).toBeUndefined()
  })
  it('returns the registered def', () => {
    const def = makeFileDef('markdown', '.md')
    registerView(def)
    expect(getView('markdown')).toBe(def)
  })
})

describe('getFileViewForExt', () => {
  it('returns undefined when no match', () => {
    expect(getFileViewForExt('.xyz')).toBeUndefined()
  })
  it('matches by extension', () => {
    const def = makeFileDef('markdown', '.md')
    registerView(def)
    expect(getFileViewForExt('.md')).toBe(def)
    expect(getFileViewForExt('.png')).toBeUndefined()
  })
  it('ignores page defs', () => {
    registerView({
      kind: 'page', type: 'calendar',
      getDisplayText: () => '日历',
      component: (() => null) as any,
    })
    expect(getFileViewForExt('.md')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests and confirm they fail**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run src/lib/__tests__/viewRegistry.test.ts
```

Expected: `Cannot find module '../viewRegistry'`

- [ ] **Step 3: Implement viewRegistry.ts**

```typescript
// src/lib/viewRegistry.ts
import type { Component } from 'solid-js'
import type { JSX } from 'solid-js'

export interface FileViewDef {
  kind: 'file'
  type: string
  getDisplayText(path: string): string
  getIcon?(): JSX.Element
  canAcceptFile(ext: string): boolean
  component: Component<{ tabId: string; isActive: boolean }>
}

export interface PageViewDef {
  kind: 'page'
  type: string
  getDisplayText(): string
  getIcon?(): JSX.Element
  component: Component<{ tabId: string; isActive: boolean }>
}

export type ViewDef = FileViewDef | PageViewDef

const registry = new Map<string, ViewDef>()

export function registerView(def: ViewDef): void {
  registry.set(def.type, def)
}

export function getView(type: string): ViewDef | undefined {
  return registry.get(type)
}

export function getFileViewForExt(ext: string): FileViewDef | undefined {
  for (const def of registry.values()) {
    if (def.kind === 'file' && def.canAcceptFile(ext)) return def as FileViewDef
  }
  return undefined
}

/** Only for use in tests. */
export function _clearRegistryForTest(): void {
  registry.clear()
}
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run src/lib/__tests__/viewRegistry.test.ts
```

Expected: all 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/viewRegistry.ts src/lib/__tests__/viewRegistry.test.ts
git commit -m "feat: add viewRegistry for workspace tab system"
```

---

### Task 2: uiStore.ts – Tab data model

**Files:**
- Modify: `src/stores/uiStore.ts`

- [ ] **Step 1: Replace uiStore.ts with new data model**

```typescript
// src/stores/uiStore.ts
import { createStore } from 'solid-js/store'

export type ThemeId = 'dark' | 'light' | 'nord'
export type SidebarView = 'files' | 'calendar'

export interface Tab {
  id: string
  type: string       // matches a ViewDef.type in viewRegistry
  path?: string      // present for file tabs, absent for page tabs
  pinned: boolean
}

interface UIState {
  showLeft: boolean
  showRight: boolean
  sidebarView: SidebarView
  tabs: Record<string, Tab>
  tabOrder: string[]         // ordered list of tab IDs
  activeTabId: string | null
  theme: ThemeId
  customCSS: string
  showSettings: boolean
  autoTimestamps: boolean
  showOtherFiles: boolean
}

function saved<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw !== null ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

const [uiStore, setUIStore] = createStore<UIState>({
  showLeft: true,
  showRight: true,
  sidebarView: 'files',
  tabs: {},
  tabOrder: [],
  activeTabId: null,
  showSettings: false,
  theme: saved<ThemeId>('sn-theme', 'dark'),
  customCSS: saved<string>('sn-customCSS', ''),
  autoTimestamps: saved<boolean>('sn-autoTimestamps', true),
  showOtherFiles: saved<boolean>('sn-showOtherFiles', true),
})

/** Derived helper: path of the active file tab, or null. */
export function activeFilePath(): string | null {
  const { tabs, activeTabId } = uiStore
  return activeTabId ? (tabs[activeTabId]?.path ?? null) : null
}

/** Update every tab whose path matches oldPath. Called by fileSystemService.renameFile. */
export function renameTabPath(oldPath: string, newPath: string): void {
  for (const id of uiStore.tabOrder) {
    if (uiStore.tabs[id]?.path === oldPath) {
      setUIStore('tabs', id, 'path', newPath)
    }
  }
}

/** Reset all workspace tab state. Called when opening a new directory. */
export function clearTabs(): void {
  setUIStore({ tabs: {}, tabOrder: [], activeTabId: null })
}

export { uiStore, setUIStore }
```

- [ ] **Step 2: Type-check**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1 | head -30
```

Expected: errors about old uiStore exports (`openPage`, `closePage`, `isPageTab`, `activePageId`) being missing — these will be fixed in later tasks. The uiStore itself should be type-clean.

- [ ] **Step 3: Commit**

```bash
git add src/stores/uiStore.ts
git commit -m "feat(uiStore): add Tab type, tabs/activeTabId data model, workspace helpers"
```

---

### Task 3: fileSystemService.ts – add I/O helpers

**Files:**
- Modify: `src/services/fileSystemService.ts`

Add three new exports (`readFile`, `writeFile`, `loadFileContent`) without removing any existing code. This task is purely additive.

- [ ] **Step 1: Add helpers after the `getFileHandle` function (around line 101)**

Open `src/services/fileSystemService.ts`. After the `getFileHandle` function (ends around line 101), insert:

```typescript
/** Pure file read — no side effects. */
export async function readFile(path: string): Promise<string> {
  const handle = await getFileHandle(path)
  const file = await handle.getFile()
  return file.text()
}

/** Pure file write — no side effects. */
export async function writeFile(path: string, content: string): Promise<void> {
  const handle = await getFileHandle(path)
  const writable = await handle.createWritable()
  await writable.write(content)
  await writable.close()
}

/**
 * Read a file and apply auto-timestamps on first open (created/updated fields).
 * Used by EditorPane on mount and on preview-tab replacement.
 */
export async function loadFileContent(path: string): Promise<string> {
  const handle = await getFileHandle(path)
  const file = await handle.getFile()
  let content = await file.text()

  if (uiStore.autoTimestamps) {
    const { frontmatter } = parseFrontmatter(content)
    const ts = formatTimestamp(file.lastModified)
    let updated = content
    if (!frontmatter.created) updated = setFrontmatterField(updated, 'created', ts)
    if (!frontmatter.updated) updated = setFrontmatterField(updated, 'updated', ts)
    if (updated !== content) {
      const writable = await handle.createWritable()
      await writable.write(updated)
      await writable.close()
      content = updated
    }
  }

  return content
}
```

- [ ] **Step 2: Type-check**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1 | grep "fileSystemService" | head -10
```

Expected: no new errors from fileSystemService.ts

- [ ] **Step 3: Commit**

```bash
git add src/services/fileSystemService.ts
git commit -m "feat(fileSystemService): add readFile/writeFile/loadFileContent helpers"
```

---

### Task 4: workspaceService.ts

**Files:**
- Create: `src/services/workspaceService.ts`

- [ ] **Step 1: Create workspaceService.ts**

```typescript
// src/services/workspaceService.ts
import { batch } from 'solid-js'
import { uiStore, setUIStore, type Tab } from '../stores/uiStore'
import { editorStore, setEditorStore } from '../stores/editorStore'
import { getFileViewForExt, getView } from '../lib/viewRegistry'
import { writeFile } from './fileSystemService'

function generateId(): string {
  return crypto.randomUUID()
}

function getExt(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(dot).toLowerCase()
}

export function setActiveTab(id: string): void {
  setUIStore('activeTabId', id)
}

export function pinTab(id: string): void {
  setUIStore('tabs', id, 'pinned', true)
}

export function closeTab(id: string): void {
  const { tabOrder, activeTabId } = uiStore
  const idx = tabOrder.indexOf(id)
  const nextId = idx > 0 ? tabOrder[idx - 1] : (tabOrder[idx + 1] ?? null)
  const newTabs = { ...uiStore.tabs }
  delete newTabs[id]
  batch(() => {
    setUIStore('tabs', newTabs)
    setUIStore('tabOrder', tabOrder.filter(t => t !== id))
    if (activeTabId === id) setUIStore('activeTabId', nextId)
  })
  if (uiStore.activeTabId === null) {
    setEditorStore({ cmView: null, isDirty: false, outLinks: [], headings: [] })
  }
}

/**
 * Return the tab ID to use for the next openFile call.
 * - newTab=true → always create a fresh ID
 * - newTab=false → reuse active tab if it is an unpinned file tab (preview replacement)
 */
function getLeaf(newTab: boolean): { id: string; isNew: boolean } {
  if (newTab) return { id: generateId(), isNew: true }
  const { activeTabId, tabs } = uiStore
  if (activeTabId) {
    const tab = tabs[activeTabId]
    if (tab && tab.path !== undefined && !tab.pinned) {
      return { id: activeTabId, isNew: false }
    }
  }
  return { id: generateId(), isNew: true }
}

/**
 * Open a file in the workspace.
 * - If already open in a tab, activate that tab.
 * - If the active tab is an unpinned file tab, replace it (preview mode).
 * - Otherwise open a new tab.
 */
export async function openFile(
  path: string,
  opts: { newTab?: boolean; pin?: boolean } = {},
): Promise<void> {
  const ext = getExt(path)
  const def = getFileViewForExt(ext)
  if (!def) return

  // Already open → just activate
  for (const [id, tab] of Object.entries(uiStore.tabs)) {
    if (tab.path === path) {
      setActiveTab(id)
      return
    }
  }

  const { id, isNew } = getLeaf(opts.newTab ?? false)

  if (!isNew) {
    // Preview replacement: save dirty content before switching
    if (editorStore.isDirty && editorStore.cmView) {
      const content = editorStore.cmView.state.doc.toString()
      const oldPath = uiStore.tabs[id]?.path
      if (oldPath) await writeFile(oldPath, content)
      setEditorStore('isDirty', false)
    }
    batch(() => {
      setUIStore('tabs', id, 'path', path)
      setUIStore('tabs', id, 'type', def.type)
    })
  } else {
    const tab: Tab = { id, type: def.type, path, pinned: opts.pin ?? false }
    batch(() => {
      setUIStore('tabs', id, tab)
      setUIStore('tabOrder', [...uiStore.tabOrder, id])
    })
  }

  setActiveTab(id)
}

/**
 * Open a plugin page tab (e.g. 'calendar').
 * If already open, activates it. Page tabs are always pinned.
 */
export function openPage(type: string): void {
  const def = getView(type)
  if (!def || def.kind !== 'page') return

  for (const [id, tab] of Object.entries(uiStore.tabs)) {
    if (tab.type === type) {
      setActiveTab(id)
      return
    }
  }

  const id = generateId()
  const tab: Tab = { id, type, pinned: true }
  batch(() => {
    setUIStore('tabs', id, tab)
    setUIStore('tabOrder', [...uiStore.tabOrder, id])
  })
  setActiveTab(id)
}
```

- [ ] **Step 2: Type-check**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1 | grep "workspaceService" | head -10
```

Expected: no errors from workspaceService.ts itself

- [ ] **Step 3: Commit**

```bash
git add src/services/workspaceService.ts
git commit -m "feat: add workspaceService – single authority for tab lifecycle"
```

---

### Task 5: EditorPane.tsx

**Files:**
- Create: `src/components/EditorPane.tsx`

Absorbs all logic from `Editor.tsx` (CM6 init, save, reindex) and `FileTitle.tsx` (inline rename). Each tab gets its own `EditorView` instance that lives for the tab's lifetime.

- [ ] **Step 1: Create EditorPane.tsx**

```typescript
// src/components/EditorPane.tsx
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from 'solid-js'
import { EditorView } from '@codemirror/view'
import { EditorState, Transaction } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting } from '@codemirror/language'
import { GFM } from '@lezer/markdown'
import { darkTheme, darkHighlightStyle } from '../lib/cmTheme'
import { wikiLinkParser, wikiEmbedParser } from '../lib/wikiLinkParser'
import { livePreviewExtension } from '../lib/livePreviewExtension'
import { embedPreviewPlugin, embedTheme } from '../lib/embedExtension'
import { frontmatterField } from '../lib/frontmatterField'
import { outLinksField } from '../lib/outLinksField'
import { inlineTagsField, inlineTagDecoField } from '../lib/inlineTagsField'
import { headingsField } from '../lib/headingsField'
import { editorStore, setEditorStore } from '../stores/editorStore'
import { uiStore } from '../stores/uiStore'
import {
  loadFileContent,
  writeFile,
  renameFile,
} from '../services/fileSystemService'
import { reindexFile } from '../services/knowledgeService'
import { startBackgroundParsing } from '../services/backgroundParser'
import {
  formatTimestamp,
  setFrontmatterField,
} from '../lib/parseFrontmatter'

function buildExtensions(
  onDocChange: (update: import('@codemirror/view').ViewUpdate) => void,
  onKeyDown: (e: KeyboardEvent) => void,
) {
  return [
    markdown({
      codeLanguages: languages,
      extensions: [GFM, wikiLinkParser, wikiEmbedParser],
    }),
    syntaxHighlighting(darkHighlightStyle),
    darkTheme,
    livePreviewExtension,
    embedPreviewPlugin,
    embedTheme,
    frontmatterField,
    outLinksField,
    inlineTagsField,
    inlineTagDecoField,
    headingsField,
    EditorView.updateListener.of(onDocChange),
    EditorView.domEventHandlers({ keydown: onKeyDown }),
    EditorView.lineWrapping,
  ]
}

export function EditorPane(props: { tabId: string; isActive: boolean }) {
  let container!: HTMLDivElement
  let view: EditorView | null = null
  let reindexTimer: ReturnType<typeof setTimeout> | null = null
  let localDirty = false

  const tab = () => uiStore.tabs[props.tabId]
  const filePath = () => tab()?.path ?? null

  function handleDocChange(update: import('@codemirror/view').ViewUpdate) {
    if (!update.docChanged) return
    const isRemote = update.transactions.some(tr =>
      tr.annotation(Transaction.remote),
    )
    if (!isRemote) {
      localDirty = true
      if (props.isActive) setEditorStore('isDirty', true)
    }
    if (reindexTimer !== null) clearTimeout(reindexTimer)
    reindexTimer = setTimeout(() => {
      reindexTimer = null
      const p = filePath()
      if (p && view) void reindexFile(p, view.state.doc.toString())
    }, 800)
    if (props.isActive) {
      setEditorStore('outLinks', update.state.field(outLinksField))
      setEditorStore('headings', update.state.field(headingsField))
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      void saveFile()
    }
  }

  async function saveFile(): Promise<void> {
    const p = filePath()
    if (!view || !p) return
    let content = view.state.doc.toString()
    if (uiStore.autoTimestamps) {
      const ts = formatTimestamp(Date.now())
      const withUpdated = setFrontmatterField(content, 'updated', ts)
      if (withUpdated !== content) {
        let from = 0
        while (
          from < content.length &&
          from < withUpdated.length &&
          content[from] === withUpdated[from]
        )
          from++
        let toOld = content.length
        let toNew = withUpdated.length
        while (
          toOld > from &&
          toNew > from &&
          content[toOld - 1] === withUpdated[toNew - 1]
        ) {
          toOld--
          toNew--
        }
        view.dispatch({
          changes: { from, to: toOld, insert: withUpdated.slice(from, toNew) },
          annotations: Transaction.remote.of(true),
        })
        content = withUpdated
      }
    }
    await writeFile(p, content)
    localDirty = false
    if (props.isActive) setEditorStore('isDirty', false)
    await reindexFile(p, content)
  }

  onMount(async () => {
    const p = filePath()
    if (!p) return
    const doc = await loadFileContent(p)
    view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: 0 },
        extensions: buildExtensions(handleDocChange, handleKeyDown),
      }),
      parent: container,
    })
    // Guard: path may have changed during async load (preview replacement)
    if (filePath() === p && props.isActive) {
      setEditorStore({
        cmView: view,
        outLinks: view.state.field(outLinksField),
        headings: view.state.field(headingsField),
        isDirty: false,
      })
    }
    void startBackgroundParsing(p)
  })

  onCleanup(() => {
    if (reindexTimer !== null) clearTimeout(reindexTimer)
    view?.destroy()
    view = null
    if (props.isActive) {
      setEditorStore({ cmView: null, isDirty: false, outLinks: [], headings: [] })
    }
  })

  // Preview tab replacement: path changes without unmount.
  // Runs AFTER onMount because view is null on first reactive pass.
  createEffect(async () => {
    const p = filePath()
    if (!view || !p) return
    const newContent = await loadFileContent(p)
    const newState = EditorState.create({
      doc: newContent,
      selection: { anchor: 0 },
      extensions: buildExtensions(handleDocChange, handleKeyDown),
    })
    view.setState(newState)
    view.scrollDOM.scrollTop = 0
    localDirty = false
    if (props.isActive) {
      setEditorStore({
        isDirty: false,
        outLinks: view.state.field(outLinksField),
        headings: view.state.field(headingsField),
      })
    }
    void startBackgroundParsing(p)
  })

  // Sync editorStore when this pane becomes the active tab.
  createEffect(() => {
    if (props.isActive && view) {
      setEditorStore({
        cmView: view,
        outLinks: view.state.field(outLinksField),
        headings: view.state.field(headingsField),
        isDirty: localDirty,
      })
    }
  })

  // ── FileTitle (inline rename) ────────────────────────────────────────────
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal('')
  let handled = false

  const stem = createMemo(() => {
    const p = filePath()
    if (!p) return ''
    return (p.split('/').pop() ?? p).replace(/\.md$/, '')
  })

  const startEdit = () => {
    handled = false
    setDraft(stem())
    setEditing(true)
  }
  const cancel = () => {
    handled = true
    setEditing(false)
  }
  const confirmRename = async () => {
    if (handled) return
    handled = true
    setEditing(false)
    const name = draft().trim()
    const p = filePath()
    if (!name || name === stem() || !p) return
    await renameFile(p, name)
  }
  const onTitleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void confirmRename()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
  }

  return (
    <div class="flex flex-col flex-1 overflow-hidden">
      <Show when={filePath()}>
        <div class="px-8 pt-6 pb-1 shrink-0 min-w-0">
          <Show
            when={editing()}
            fallback={
              <h1
                class="text-[22px] font-bold text-[var(--text)] cursor-text hover:text-[var(--accent)] transition-colors truncate leading-tight"
                onClick={startEdit}
                title="点击修改文件名"
              >
                {stem() || '未命名'}
              </h1>
            }
          >
            <input
              class="w-full bg-transparent border-b-2 border-[var(--accent)] outline-none text-[22px] font-bold text-[var(--text)] pb-0.5 leading-tight"
              value={draft()}
              onInput={e => setDraft(e.currentTarget.value)}
              onKeyDown={onTitleKeyDown}
              onBlur={() => void confirmRename()}
              ref={el => setTimeout(() => { el.focus(); el.select() }, 0)}
              spellcheck={false}
            />
          </Show>
        </div>
      </Show>
      <div
        ref={container}
        class="flex-1 overflow-auto bg-[#0f0f1c]"
        style={{ 'min-height': '0' }}
      />
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1 | grep "EditorPane" | head -10
```

Expected: no errors from EditorPane.tsx itself (errors from other files using old APIs are expected)

- [ ] **Step 3: Commit**

```bash
git add src/components/EditorPane.tsx
git commit -m "feat: add EditorPane – per-tab CM6 editor with preview-replacement and inline rename"
```

---

### Task 6: ImageViewer.tsx + ContentPane.tsx

**Files:**
- Modify: `src/components/ImageViewer.tsx`
- Create: `src/components/ContentPane.tsx`

- [ ] **Step 1: Update ImageViewer.tsx to accept tabId+isActive props**

```typescript
// src/components/ImageViewer.tsx
import { createResource, Match, Switch } from 'solid-js'
import { fileSystemStore } from '../stores/fileSystemStore'
import { uiStore } from '../stores/uiStore'

async function readImageDataUrl(
  path: string,
  root: FileSystemDirectoryHandle,
): Promise<string> {
  const parts = path.split('/')
  let dir: FileSystemDirectoryHandle = root
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i])
  }
  const handle = await dir.getFileHandle(parts[parts.length - 1])
  const file = await handle.getFile()
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function ImageViewer(props: { tabId: string; isActive: boolean }) {
  const path = () => uiStore.tabs[props.tabId]?.path ?? null

  const [dataUrl] = createResource(
    () => {
      const p = path()
      const root = fileSystemStore.rootHandle
      return p && root ? { path: p, root } : null
    },
    ({ path, root }) => readImageDataUrl(path, root),
  )

  const fileName = () => path()?.split('/').pop() ?? ''

  return (
    <div class="flex-1 flex flex-col overflow-hidden bg-[var(--bg-base)]">
      <div class="h-9 px-4 flex items-center border-b border-[var(--border)] shrink-0">
        <span class="text-[12px] text-[var(--text-2)] truncate">{fileName()}</span>
      </div>
      <div class="flex-1 flex items-center justify-center overflow-auto p-6">
        <Switch>
          <Match when={dataUrl.error}>
            <div class="text-[12px] text-[var(--text-4)]">无法加载图片</div>
          </Match>
          <Match when={dataUrl.loading}>
            <div class="text-[12px] text-[var(--text-4)]">加载中…</div>
          </Match>
          <Match when={dataUrl()}>
            <img
              src={dataUrl()!}
              alt={fileName()}
              class="max-w-full max-h-full object-contain rounded shadow-sm select-none"
              draggable={false}
            />
          </Match>
        </Switch>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create ContentPane.tsx**

```typescript
// src/components/ContentPane.tsx
import { For } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { uiStore } from '../stores/uiStore'
import { getView } from '../lib/viewRegistry'

export function ContentPane() {
  return (
    <div class="flex-1 relative overflow-hidden">
      <For each={uiStore.tabOrder}>
        {(tabId) => {
          const tab = () => uiStore.tabs[tabId]
          const def = () => (tab() ? getView(tab().type) : undefined)
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

- [ ] **Step 3: Type-check**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1 | grep -E "ContentPane|ImageViewer" | head -10
```

Expected: no errors from these two files

- [ ] **Step 4: Commit**

```bash
git add src/components/ImageViewer.tsx src/components/ContentPane.tsx
git commit -m "feat: update ImageViewer props; add ContentPane for workspace rendering"
```

---

### Task 7: App.tsx + TabBar.tsx switchover

**Files:**
- Modify: `src/components/App.tsx`
- Modify: `src/components/TabBar.tsx`

This is the go-live commit. After this task the app uses the new workspace system.

- [ ] **Step 1: Replace App.tsx**

```typescript
// src/App.tsx
import { createEffect, onMount, Show } from 'solid-js'
import { CalendarRange } from 'lucide-solid'
import { Ribbon } from './components/Ribbon'
import { Sidebar } from './components/Sidebar'
import { CalendarPanel } from './components/CalendarPanel'
import { TabBar } from './components/TabBar'
import { ContentPane } from './components/ContentPane'
import { RightPanel } from './components/RightPanel'
import { StatusBar } from './components/StatusBar'
import { Settings } from './components/Settings'
import { restoreDirectory } from './services/fileSystemService'
import { uiStore } from './stores/uiStore'
import { registerView } from './lib/viewRegistry'
import { EditorPane } from './components/EditorPane'
import { ImageViewer } from './components/ImageViewer'
import { CalendarPage } from './components/CalendarPage'

const customStyleEl = document.createElement('style')
document.head.appendChild(customStyleEl)

const IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif',
])

registerView({
  kind: 'file',
  type: 'markdown',
  getDisplayText: path => path.split('/').pop()!,
  canAcceptFile: ext => ext === '.md',
  component: EditorPane,
})

registerView({
  kind: 'file',
  type: 'image',
  getDisplayText: path => path.split('/').pop()!,
  canAcceptFile: ext => IMAGE_EXTS.has(ext),
  component: ImageViewer,
})

registerView({
  kind: 'page',
  type: 'calendar',
  getDisplayText: () => '日历',
  getIcon: () => <CalendarRange size={11} />,
  component: CalendarPage,
})

export default function App() {
  createEffect(() => {
    document.documentElement.setAttribute('data-theme', uiStore.theme)
  })

  createEffect(() => {
    customStyleEl.textContent = uiStore.customCSS
  })

  onMount(async () => {
    await restoreDirectory()
  })

  return (
    <div class="h-full flex flex-col bg-[var(--bg-base)] text-[var(--text)] overflow-hidden">
      <div class="flex flex-1 overflow-hidden">
        <Ribbon />
        <div
          class={`transition-all duration-200 overflow-hidden ${uiStore.showLeft ? 'w-47.5' : 'w-0'}`}
        >
          <Show when={uiStore.sidebarView === 'calendar'} fallback={<Sidebar />}>
            <CalendarPanel />
          </Show>
        </div>
        <div class="flex-1 flex flex-col overflow-hidden min-w-0">
          <TabBar />
          <ContentPane />
        </div>
        <div
          class={`transition-all duration-200 overflow-hidden ${uiStore.showRight ? 'w-50' : 'w-0'}`}
        >
          <RightPanel />
        </div>
      </div>
      <StatusBar />
      <Show when={uiStore.showSettings}>
        <Settings />
      </Show>
    </div>
  )
}
```

- [ ] **Step 2: Replace TabBar.tsx**

```typescript
// src/components/TabBar.tsx
import { For } from 'solid-js'
import { PanelRight } from 'lucide-solid'
import { uiStore, setUIStore } from '../stores/uiStore'
import { closeTab, setActiveTab, pinTab } from '../services/workspaceService'
import { getView } from '../lib/viewRegistry'

export function TabBar() {
  return (
    <div class="h-8 bg-[var(--bg-base)] border-b border-[var(--border)] flex items-stretch shrink-0 overflow-y-hidden">
      <div class="flex flex-1 overflow-x-auto overflow-y-hidden">
        <For each={uiStore.tabOrder}>
          {(tabId) => {
            const tab = () => uiStore.tabs[tabId]
            const def = () => (tab() ? getView(tab().type) : undefined)
            const isActive = () => uiStore.activeTabId === tabId
            const label = () => {
              const d = def()
              if (!d) return tabId
              return d.kind === 'file'
                ? d.getDisplayText(tab().path!)
                : d.getDisplayText()
            }
            const isPinned = () => tab()?.pinned ?? false

            return (
              <div
                class={`flex items-center gap-1.5 px-3 border-r border-[var(--border)] cursor-pointer text-[11px] shrink-0
                  ${
                    isActive()
                      ? 'bg-[var(--bg-base)] text-[var(--text)] border-b-2 border-b-[var(--accent)] -mb-px'
                      : 'text-[var(--text-3)] hover:bg-[var(--bg-hover)]'
                  }`}
                onClick={() => setActiveTab(tabId)}
                onDblClick={() => pinTab(tabId)}
              >
                {def()?.getIcon?.()}
                <span
                  class={`max-w-[120px] truncate ${!isPinned() && tab()?.path ? 'italic' : ''}`}
                >
                  {label()}
                </span>
                <button
                  class="text-[var(--text-4)] hover:text-[var(--text-2)] text-[13px] leading-none ml-0.5"
                  onClick={e => {
                    e.stopPropagation()
                    closeTab(tabId)
                  }}
                >
                  ×
                </button>
              </div>
            )
          }}
        </For>
      </div>
      <button
        class="px-2 shrink-0 text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--bg-hover)] flex items-center transition-colors"
        onClick={() => setUIStore('showRight', v => !v)}
        title="切换右侧栏"
      >
        <PanelRight size={15} />
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Type-check**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1 | head -40
```

Expected: errors about old APIs still used in Sidebar, Ribbon, CalendarPage, CalendarPanel, RightPanel, PropertiesPanel, StatusBar — these are fixed in subsequent tasks. App.tsx and TabBar.tsx should be clean.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/components/TabBar.tsx
git commit -m "feat: wire App.tsx and TabBar.tsx to workspace/viewRegistry system"
```

---

### Task 8: Sidebar.tsx + CalendarPanel.tsx + CalendarPage.tsx

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/CalendarPanel.tsx`
- Modify: `src/components/CalendarPage.tsx`

- [ ] **Step 1: Replace Sidebar.tsx**

```typescript
// src/components/Sidebar.tsx
import { For, Show, createSignal } from 'solid-js'
import { FolderOpen } from 'lucide-solid'
import { fileSystemStore } from '../stores/fileSystemStore'
import { uiStore, activeFilePath } from '../stores/uiStore'
import {
  openDirectory,
  createFile,
  createDirectory,
} from '../services/fileSystemService'
import { openFile } from '../services/workspaceService'
import type { FileNode } from '../stores/fileSystemStore'

const IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif',
])
const MD_EXT = '.md'

function fileIcon(name: string): string {
  if (name.endsWith(MD_EXT)) return '◻'
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return IMAGE_EXTS.has(ext) ? '⊡' : '◫'
}

function displayName(name: string): string {
  return name.endsWith(MD_EXT) ? name.slice(0, -3) : name
}

function isOtherFile(name: string): boolean {
  return !name.endsWith(MD_EXT)
}

function canOpen(name: string): boolean {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return name.endsWith(MD_EXT) || IMAGE_EXTS.has(ext)
}

function FileTreeNode(props: { node: FileNode; depth: number }) {
  const isActive = () => activeFilePath() === props.node.path
  const isOther = () => props.node.kind === 'file' && isOtherFile(props.node.name)
  const show = () =>
    props.node.kind === 'directory' ||
    !isOtherFile(props.node.name) ||
    uiStore.showOtherFiles

  return (
    <Show when={show()}>
      <div>
        <div
          class={`flex items-center gap-1 py-0.5 text-[11px] cursor-pointer hover:bg-[var(--bg-hover)] select-none
            ${
              isActive()
                ? 'bg-[var(--bg-hover)] border-l-2 border-[var(--accent)] text-[var(--text)]'
                : isOther()
                  ? 'text-[var(--text-4)] border-l-2 border-transparent'
                  : 'text-[var(--text-2)] border-l-2 border-transparent'
            }`}
          style={{ 'padding-left': `${6 + props.depth * 14}px` }}
          onClick={() => {
            if (props.node.kind !== 'file') return
            if (!canOpen(props.node.name)) return
            void openFile(props.node.path)
          }}
          onDblClick={() => {
            if (props.node.kind !== 'file') return
            if (!canOpen(props.node.name)) return
            void openFile(props.node.path, { newTab: true, pin: true })
          }}
        >
          <span class="text-[9px] text-[var(--text-3)]">
            {props.node.kind === 'directory' ? '▸' : fileIcon(props.node.name)}
          </span>
          <span class={isActive() ? 'text-[var(--accent)]' : ''}>
            {displayName(props.node.name)}
          </span>
        </div>
        <Show when={props.node.kind === 'directory'}>
          <For each={props.node.children ?? []}>
            {child => <FileTreeNode node={child} depth={props.depth + 1} />}
          </For>
        </Show>
      </div>
    </Show>
  )
}

type CreateMode = 'file' | 'folder' | null

export function Sidebar() {
  const [createMode, setCreateMode] = createSignal<CreateMode>(null)
  const [newName, setNewName] = createSignal('')

  const startCreate = (mode: CreateMode) => {
    setNewName('')
    setCreateMode(mode)
  }
  const cancel = () => {
    setCreateMode(null)
    setNewName('')
  }
  const confirm = async () => {
    const name = newName().trim()
    if (!name) {
      cancel()
      return
    }
    const mode = createMode()
    cancel()
    if (mode === 'file') {
      const path = await createFile(name)
      await openFile(path, { newTab: true, pin: true })
    } else if (mode === 'folder') {
      await createDirectory(name)
    }
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') void confirm()
    else if (e.key === 'Escape') cancel()
  }

  return (
    <div class="w-[190px] h-full bg-[var(--bg-surface)] border-r border-[var(--border)] flex flex-col">
      <div class="border-b border-[var(--border)] shrink-0 flex items-center gap-0.5 pr-1 min-w-0">
        <button
          class="flex items-center gap-1.5 flex-1 px-2.5 py-2 text-left hover:bg-[var(--bg-hover)] transition-colors min-w-0 group"
          onClick={openDirectory}
          title={fileSystemStore.rootHandle ? '切换文件夹' : '打开文件夹'}
        >
          <FolderOpen
            size={12}
            class="shrink-0 text-[var(--accent)] group-hover:text-[var(--accent-2)]"
          />
          <span class="truncate text-[10px] text-[var(--accent)] font-bold tracking-widest uppercase group-hover:text-[var(--accent-2)]">
            {fileSystemStore.rootHandle?.name ?? '打开文件夹'}
          </span>
        </button>
        <Show when={fileSystemStore.rootHandle}>
          <button
            class="shrink-0 text-[var(--text-3)] hover:text-[var(--accent-2)] w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] transition-colors text-[13px]"
            title="新建文件夹"
            onClick={() => startCreate('folder')}
          >
            ⊞
          </button>
          <button
            class="shrink-0 text-[var(--text-3)] hover:text-[var(--accent-2)] w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] transition-colors"
            title="新建文件"
            onClick={() => startCreate('file')}
          >
            +
          </button>
        </Show>
      </div>

      <div class="overflow-y-auto flex-1 py-1">
        <Show when={createMode() !== null}>
          <div class="flex items-center gap-1 px-2 py-1">
            <span class="text-[9px] text-[var(--text-3)]">
              {createMode() === 'folder' ? '▸' : '◻'}
            </span>
            <input
              class="flex-1 bg-[var(--bg-hover)] border border-[var(--accent)] rounded px-1.5 py-0.5 text-[11px] text-[var(--text)] outline-none min-w-0"
              placeholder={
                createMode() === 'folder'
                  ? '文件夹 或 父/子/文件夹'
                  : '文件名 或 目录/文件名'
              }
              value={newName()}
              onInput={e => setNewName(e.currentTarget.value)}
              onKeyDown={onKeyDown}
              onBlur={() => void confirm()}
              ref={el => setTimeout(() => el?.focus(), 0)}
            />
          </div>
        </Show>
        <For each={fileSystemStore.tree}>
          {node => <FileTreeNode node={node} depth={0} />}
        </For>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update CalendarPanel.tsx – replace openFile import**

In `src/components/CalendarPanel.tsx`, replace:
```typescript
import { openFile } from '../services/fileSystemService'
```
with:
```typescript
import { openFile } from '../services/workspaceService'
```

All three `onClick={() => openFile(path)}` calls remain unchanged (same function signature).

- [ ] **Step 3: Update CalendarPage.tsx – replace openFile import and add props**

In `src/components/CalendarPage.tsx`:

Replace the import:
```typescript
import { openFile } from '../services/fileSystemService'
```
with:
```typescript
import { openFile } from '../services/workspaceService'
```

Change the function signature from:
```typescript
export function CalendarPage() {
```
to:
```typescript
export function CalendarPage(_props: { tabId: string; isActive: boolean }) {
```

- [ ] **Step 4: Type-check**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1 | grep -E "Sidebar|CalendarP" | head -10
```

Expected: no errors from these files

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx src/components/CalendarPanel.tsx src/components/CalendarPage.tsx
git commit -m "feat: update Sidebar/CalendarPanel/CalendarPage to use workspaceService"
```

---

### Task 9: Ribbon.tsx

**Files:**
- Modify: `src/components/Ribbon.tsx`

- [ ] **Step 1: Replace openPage import and activePageId reference**

Replace the full `src/components/Ribbon.tsx`:

```typescript
// src/components/Ribbon.tsx
import {
  Search,
  Network,
  Settings,
  CalendarDays,
  CalendarRange,
  PanelLeft,
} from 'lucide-solid'
import { uiStore, setUIStore } from '../stores/uiStore'
import { openPage } from '../services/workspaceService'

export function Ribbon() {
  const switchView = (view: 'files' | 'calendar') => {
    if (uiStore.sidebarView === view && uiStore.showLeft) {
      setUIStore('showLeft', false)
    } else {
      setUIStore('sidebarView', view)
      setUIStore('showLeft', true)
    }
  }

  const calendarPageActive = () =>
    Object.values(uiStore.tabs).some(
      t => t.type === 'calendar' && uiStore.activeTabId === t.id,
    )

  return (
    <div class="w-9 bg-[var(--bg-base)] border-r border-[var(--border)] flex flex-col items-center py-2 gap-1.5 shrink-0">
      <button
        onClick={() => setUIStore('showLeft', v => !v)}
        class="p-1.5 text-[var(--text-3)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] rounded cursor-pointer transition-colors"
        title="切换左侧栏"
      >
        <PanelLeft size={18} />
      </button>

      <button
        class={`p-1.5 rounded cursor-pointer transition-colors hover:bg-[var(--bg-hover)]
          ${uiStore.sidebarView === 'files' && uiStore.showLeft ? 'text-[var(--accent)]' : 'text-[var(--text-3)] hover:text-[var(--text)]'}`}
        title="文件列表"
        onClick={() => switchView('files')}
      >
        <Search size={18} />
      </button>
      <button
        class={`p-1.5 rounded cursor-pointer transition-colors hover:bg-[var(--bg-hover)]
          ${uiStore.sidebarView === 'calendar' && uiStore.showLeft ? 'text-[var(--accent)]' : 'text-[var(--text-3)] hover:text-[var(--text)]'}`}
        title="日历"
        onClick={() => switchView('calendar')}
      >
        <CalendarDays size={18} />
      </button>
      <button
        class={`p-1.5 rounded cursor-pointer transition-colors hover:bg-[var(--bg-hover)]
          ${calendarPageActive() ? 'text-[var(--accent)]' : 'text-[var(--text-3)] hover:text-[var(--text)]'}`}
        title="日历大图"
        onClick={() => openPage('calendar')}
      >
        <CalendarRange size={18} />
      </button>
      <button
        class="p-1.5 text-[var(--text-3)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] rounded cursor-pointer transition-colors"
        title="知识图谱"
      >
        <Network size={18} />
      </button>
      <div class="flex-1" />
      <button
        class="p-1.5 text-[var(--text-3)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] rounded cursor-pointer transition-colors"
        title="设置"
        onClick={() => setUIStore('showSettings', true)}
      >
        <Settings size={18} />
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1 | grep "Ribbon" | head -5
```

Expected: no errors from Ribbon.tsx

- [ ] **Step 3: Commit**

```bash
git add src/components/Ribbon.tsx
git commit -m "feat: update Ribbon to use workspaceService.openPage"
```

---

### Task 10: RightPanel.tsx + PropertiesPanel.tsx + StatusBar.tsx

**Files:**
- Modify: `src/components/RightPanel.tsx`
- Modify: `src/components/PropertiesPanel.tsx`
- Modify: `src/components/StatusBar.tsx`

- [ ] **Step 1: Update RightPanel.tsx – replace fileSystemStore.activeFilePath**

In `src/components/RightPanel.tsx`, make these changes:

Remove the import of `fileSystemStore`:
```typescript
import { fileSystemStore } from '../stores/fileSystemStore'
```

Add the import of `activeFilePath`:
```typescript
import { activeFilePath } from '../stores/uiStore'
```

Replace both occurrences of `fileSystemStore.activeFilePath` with `activeFilePath()`.

The two `createMemo` blocks become:
```typescript
const currentMeta = createMemo(() => {
  const path = activeFilePath()
  return path ? (knowledgeStore.index[path] ?? null) : null
})
```
```typescript
const backlinks = createMemo(() => {
  const path = activeFilePath()
  if (!path) return []
  // ... rest unchanged
```

Also remove the `openFile` import from fileSystemService and replace the wikilink click handler in RightPanel (search for `openFile(` in RightPanel and replace with `workspace.openFile(`):

Add at top of imports:
```typescript
import { openFile } from '../services/workspaceService'
```

- [ ] **Step 2: Update PropertiesPanel.tsx – read/write via cmView**

Replace the full `src/components/PropertiesPanel.tsx`:

```typescript
// src/components/PropertiesPanel.tsx
import { For, createMemo, Show } from 'solid-js'
import { Transaction } from '@codemirror/state'
import { parseFrontmatter, serializeFrontmatter } from '../lib/parseFrontmatter'
import { editorStore, setEditorStore } from '../stores/editorStore'
import { activeFilePath } from '../stores/uiStore'

export function PropertiesPanel() {
  const text = () => editorStore.cmView?.state.doc.toString() ?? ''
  const parsed = createMemo(() => parseFrontmatter(text()))
  const fields = createMemo(() => Object.entries(parsed().frontmatter))

  function applyText(newText: string) {
    const view = editorStore.cmView
    if (!view) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: newText },
      annotations: Transaction.remote.of(true),
    })
    setEditorStore('isDirty', true)
  }

  function updateField(key: string, value: string) {
    const { frontmatter, body } = parsed()
    applyText(serializeFrontmatter({ ...frontmatter, [key]: value }, body))
  }

  function deleteField(key: string) {
    const { frontmatter, body } = parsed()
    const { [key]: _, ...rest } = frontmatter as Record<string, unknown>
    applyText(serializeFrontmatter(rest, body))
  }

  function addField() {
    const { frontmatter, body } = parsed()
    const newKey = `field${Object.keys(frontmatter).length + 1}`
    applyText(serializeFrontmatter({ ...frontmatter, [newKey]: '' }, body))
  }

  return (
    <Show when={activeFilePath()}>
      <div class="bg-[#16162a] border-b border-[#2d2d4a] px-4 py-2.5 shrink-0">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-[10px] text-[#6c63ff] font-bold tracking-widest uppercase">
            Properties
          </span>
          <button
            onClick={addField}
            class="text-[10px] text-[#a09cf7] bg-[#6c63ff22] border border-[#6c63ff44] px-2 py-0.5 rounded hover:bg-[#6c63ff33] cursor-pointer"
          >
            +
          </button>
        </div>
        <For each={fields()}>
          {([key, value]) => (
            <div class="flex items-center gap-1 mb-1 group">
              <span class="text-[10px] text-[#a09cf7] w-20 shrink-0 truncate">
                {key}
              </span>
              <input
                class="flex-1 bg-[#1e1e3a] border border-[#2d2d4a] rounded px-1.5 py-0.5 text-[10px] text-[var(--text-2)] outline-none focus:border-[#6c63ff] min-w-0"
                value={String(value)}
                onInput={e => updateField(key, e.currentTarget.value)}
              />
              <button
                class="opacity-0 group-hover:opacity-100 text-[#6c63ff88] hover:text-[#ff6c9d] text-[11px] shrink-0 cursor-pointer"
                onClick={() => deleteField(key)}
              >
                ×
              </button>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}
```

- [ ] **Step 3: Update StatusBar.tsx – remove editorStore.content**

Replace the `stats` memo in `src/components/StatusBar.tsx`:

```typescript
// src/components/StatusBar.tsx
import { createMemo, Show } from 'solid-js'
import { editorStore } from '../stores/editorStore'
import { knowledgeStore } from '../stores/knowledgeStore'
import { parseFrontmatter } from '../lib/parseFrontmatter'

export function StatusBar() {
  const stats = createMemo(() => {
    // cmView is reactive (store prop); re-runs on tab switch.
    // Word count reflects the document at last tab activation.
    const text = editorStore.cmView?.state.doc.toString() ?? ''
    const { body } = parseFrontmatter(text)
    const words = body.trim() ? body.trim().split(/\s+/).length : 0
    const lines = editorStore.cmView?.state.doc.lines ?? 0
    return { words, lines }
  })

  return (
    <div class="h-6 bg-[var(--bg-base)] border-t border-[var(--border)] px-3 flex items-center gap-4 text-[10px] text-[var(--text-4)] shrink-0">
      <span>{stats().words} 字</span>
      <span>{stats().lines} 行</span>
      <div class="flex-1" />
      <Show when={knowledgeStore.isIndexing}>
        <span class="flex items-center gap-1 text-[var(--text-3)]">
          <span class="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
          后台检测中
        </span>
      </Show>
      <span class={editorStore.isDirty ? 'text-[var(--accent)]' : ''}>
        {editorStore.isDirty ? '未保存' : '已保存'}
      </span>
    </div>
  )
}
```

- [ ] **Step 4: Type-check**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1 | grep -E "RightPanel|PropertiesPanel|StatusBar" | head -10
```

Expected: no errors from these files

- [ ] **Step 5: Commit**

```bash
git add src/components/RightPanel.tsx src/components/PropertiesPanel.tsx src/components/StatusBar.tsx
git commit -m "feat: update RightPanel/PropertiesPanel/StatusBar to workspace APIs"
```

---

### Task 11: fileSystemService.ts – remove old tab API + update renameFile/createFile

**Files:**
- Modify: `src/services/fileSystemService.ts`

- [ ] **Step 1: Remove tab-related imports and logic from openDirectory and restoreDirectory**

In `openDirectory`, replace:
```typescript
setFileSystemStore({
  rootHandle: handle,
  activeFilePath: null,
  openFilePaths: [],
})
```
with:
```typescript
import { clearTabs } from '../stores/uiStore'
// (add clearTabs to the uiStore import at top of file)

setFileSystemStore({ rootHandle: handle })
clearTabs()
```

In `restoreDirectory`, the `setFileSystemStore({ rootHandle: handle })` line stays as-is (no tab state to clear here since it's a fresh page load).

- [ ] **Step 2: Update createFile to return the path and NOT call openFile**

Replace the `createFile` function with:

```typescript
export async function createFile(
  name: string,
  dirPath?: string,
): Promise<string> {
  const { rootHandle } = fileSystemStore
  if (!rootHandle) return ''
  const combined = dirPath ? `${dirPath}/${name}` : name
  const parts = combined.split('/').filter(Boolean)
  const rawFilename = parts[parts.length - 1]
  const dirParts = parts.slice(0, -1)
  const filename = rawFilename.endsWith('.md')
    ? rawFilename
    : `${rawFilename}.md`
  let dir: FileSystemDirectoryHandle = rootHandle
  for (const part of dirParts) {
    dir = await dir.getDirectoryHandle(part, { create: true })
  }
  const filePath = [...dirParts, filename].join('/')
  const handle = await dir.getFileHandle(filename, { create: true })
  const writable = await handle.createWritable()
  await writable.write('')
  await writable.close()
  setFileSystemStore('tree', await buildTree(rootHandle))
  return filePath
}
```

- [ ] **Step 3: Update renameFile to use renameTabPath + cmView for content**

In `renameFile`, replace:
```typescript
const content = editorStore.content
```
with:
```typescript
const content = editorStore.cmView?.state.doc.toString() ?? ''
```

Replace the tab-manipulation block (lines that call `setFileSystemStore('openFilePaths', ...)`, `setUIStore('tabOrder', ...)`, `setFileSystemStore('activeFilePath', newPath)`):

```typescript
// Replace three setXStore calls with:
import { renameTabPath } from '../stores/uiStore'
// (add renameTabPath to the uiStore import at top)

renameTabPath(oldPath, newPath)
```

Also remove the `setEditorStore({ isDirty: false })` call that followed those lines (isDirty is managed by EditorPane now).

- [ ] **Step 4: Delete the old openFile, openImageFile, closeFile, saveCurrentFile exports**

Remove these four exported functions entirely from `fileSystemService.ts`:
- `export async function openImageFile(path: string): Promise<void>` (lines ~201–208)
- `export async function openFile(path: string): Promise<void>` (lines ~210–242)
- `export async function saveCurrentFile(): Promise<void>` (lines ~244–287)
- `export function closeFile(path: string): void` (lines ~384–397)

Also remove any imports that are now unused: `setEditorStore`, imports of `openPage`/`closePage` if any.

- [ ] **Step 5: Type-check**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1 | head -30
```

Expected: errors only from `editorStore.content` (fixed next task) and `fileSystemStore.activeFilePath`/`openFilePaths` (fixed next task)

- [ ] **Step 6: Commit**

```bash
git add src/services/fileSystemService.ts
git commit -m "refactor(fileSystemService): remove tab API; update renameFile/createFile to workspace model"
```

---

### Task 12: editorStore.ts + fileSystemStore.ts – remove deprecated fields

**Files:**
- Modify: `src/stores/editorStore.ts`
- Modify: `src/stores/fileSystemStore.ts`

- [ ] **Step 1: Remove content from editorStore.ts**

```typescript
// src/stores/editorStore.ts
import { createStore } from 'solid-js/store'
import type { EditorView } from '@codemirror/view'
import type { OutLink } from '../lib/outLinksField'
import type { Heading } from '../lib/headingsField'

export interface EditorState {
  isDirty: boolean
  cmView: EditorView | null
  outLinks: OutLink[]
  headings: Heading[]
}

const [editorStore, setEditorStore] = createStore<EditorState>({
  isDirty: false,
  cmView: null,
  outLinks: [],
  headings: [],
})

export { editorStore, setEditorStore }
```

- [ ] **Step 2: Remove activeFilePath and openFilePaths from fileSystemStore.ts**

```typescript
// src/stores/fileSystemStore.ts
import { createStore } from 'solid-js/store'

export interface FileNode {
  name: string
  path: string
  kind: 'file' | 'directory'
  children?: FileNode[]
}

export interface FileSystemState {
  rootHandle: FileSystemDirectoryHandle | null
  tree: FileNode[]
}

const [fileSystemStore, setFileSystemStore] = createStore<FileSystemState>({
  rootHandle: null,
  tree: [],
})

export { fileSystemStore, setFileSystemStore }
```

- [ ] **Step 3: Type-check – expect zero errors**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1
```

Expected: **zero errors**. If any errors appear, fix them before committing.

- [ ] **Step 4: Commit**

```bash
git add src/stores/editorStore.ts src/stores/fileSystemStore.ts
git commit -m "refactor: remove deprecated content/activeFilePath/openFilePaths from stores"
```

---

### Task 13: Delete old files + clean up unused imports

**Files:**
- Delete: `src/components/Editor.tsx`
- Delete: `src/components/FileTitle.tsx`
- Delete: `src/lib/pageRegistry.ts`

- [ ] **Step 1: Delete the three files**

```bash
rm /home/huxzhi/4-code/symbol-notes/src/components/Editor.tsx
rm /home/huxzhi/4-code/symbol-notes/src/components/FileTitle.tsx
rm /home/huxzhi/4-code/symbol-notes/src/lib/pageRegistry.ts
```

- [ ] **Step 2: Verify zero TypeScript errors and all existing tests pass**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1
npx vitest run
```

Expected: zero type errors; all tests pass

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: delete Editor.tsx, FileTitle.tsx, pageRegistry.ts (absorbed/replaced)"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| WorkspaceService as single authority | Task 4 |
| ViewRegistry maps types to components | Task 1 |
| Tab data model (id, type, path, pinned) | Task 2 |
| ContentPane CSS-toggles tabs | Task 6 |
| EditorPane: one CM6 view per tab | Task 5 |
| Preview replacement via tab.path change + view.setState | Task 5 (createEffect on filePath()) |
| Scroll/undo/cursor reset on replacement | Task 5 (view.setState + scrollDOM.scrollTop = 0) |
| Save dirty content before preview replace | Task 4 (workspaceService.openFile) |
| Sidebar calls workspace.openFile | Task 8 |
| Double-click opens pinned tab | Task 8 (Sidebar onDblClick) |
| Ribbon calls workspace.openPage | Task 9 |
| fileSystemService reduced to pure I/O | Task 11 |
| activeFilePath() derived helper | Task 2 |
| renameTabPath() for rename | Task 2, 11 |
| clearTabs() on openDirectory | Task 11 |
| CalendarPanel/CalendarPage use workspace | Task 8 |
| imageViewer accepts tabId+isActive | Task 6 |
| RightPanel uses activeFilePath() | Task 10 |
| Delete Editor.tsx, FileTitle.tsx, pageRegistry.ts | Task 13 |

All spec requirements covered. No gaps found.

**Type consistency:** `Tab` is defined once in uiStore.ts (Task 2) and imported by workspaceService (Task 4). `ViewDef`/`FileViewDef`/`PageViewDef` defined once in viewRegistry (Task 1) and imported wherever needed. `activeFilePath()` and `renameTabPath()` exported from uiStore, consumed in Tasks 8–11.

**Edge case: livePreviewExtension wikilink clicks** — check if this extension calls `openFile`. If so, update it to call `workspace.openFile(path, { newTab: true, pin: true })`. Run `grep -n "openFile" src/lib/livePreviewExtension.ts` before Task 13.
