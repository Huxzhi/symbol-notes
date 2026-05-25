# Global Store & WorkspaceSplit Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 4 scattered stores + 3 service files with a unified `globalStore` (namespaced, serializable) + `runtimeStore` (non-serializable) + 4 domain action files, and replace the flat-tab UI with a recursive WorkspaceSplit renderer.

**Architecture:** All serializable state lives in `globalStore` under `fs`, `knowledge`, `workspace` namespaces. Non-serializable objects (`FileSystemDirectoryHandle`, CM6 `EditorView`) live in `runtimeStore`. Components read only from stores; all mutations go through domain-grouped action files. The workspace layout is a recursive `WorkspaceSplit` tree (split/tabs/leaf), and all leaves are always mounted in the DOM—only `display` toggles to preserve CM6 state across tab switches.

**Tech Stack:** SolidJS (`solid-js/store`, `produce`), TypeScript, Vitest, CodeMirror 6

---

## File Map

| Action | Path                                                 |
| ------ | ---------------------------------------------------- |
| Create | `src/stores/types.ts`                                |
| Create | `src/stores/globalStore.ts`                          |
| Create | `src/stores/runtimeStore.ts`                         |
| Create | `src/lib/knowledgeUtils.ts`                          |
| Create | `src/actions/knowledgeActions.ts`                    |
| Create | `src/actions/fsActions.ts`                           |
| Create | `src/actions/workspaceActions.ts`                    |
| Create | `src/actions/appActions.ts`                          |
| Create | `src/components/workspace/WorkspaceLeafView.tsx`     |
| Create | `src/components/workspace/WorkspaceTabsView.tsx`     |
| Create | `src/components/workspace/WorkspaceSplitView.tsx`    |
| Create | `src/components/workspace/WorkspaceNodeRenderer.tsx` |
| Create | `src/components/workspace/SidebarRenderer.tsx`       |
| Modify | `src/lib/viewRegistry.ts`                            |
| Modify | `src/App.tsx`                                        |
| Modify | `src/components/EditorPane.tsx`                      |
| Modify | `src/components/ImageViewer.tsx`                     |
| Modify | `src/components/CalendarPage.tsx`                    |
| Modify | `src/components/Sidebar.tsx`                         |
| Modify | `src/components/Ribbon.tsx`                          |
| Modify | `src/components/RightPanel.tsx`                      |
| Modify | `src/components/StatusBar.tsx`                       |
| Modify | `src/components/Settings.tsx`                        |
| Modify | `src/services/backgroundParser.ts`                   |
| Modify | `src/__tests__/knowledgeService.test.ts`             |
| Delete | `src/stores/fileSystemStore.ts`                      |
| Delete | `src/stores/knowledgeStore.ts`                       |
| Delete | `src/stores/uiStore.ts`                              |
| Delete | `src/stores/editorStore.ts`                          |
| Delete | `src/services/fileSystemService.ts`                  |
| Delete | `src/services/knowledgeService.ts`                   |
| Delete | `src/services/workspaceService.ts`                   |
| Delete | `src/components/TabBar.tsx`                          |
| Delete | `src/components/ContentPane.tsx`                     |

---

## Task 1: Define all types in `src/stores/types.ts`

**Files:**

- Create: `src/stores/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// src/stores/types.ts
import type { EditorView } from '@codemirror/view'
import type { OutLink } from '../lib/outLinksField'
import type { Heading } from '../lib/headingsField'

// ── Workspace tree ──────────────────────────────────────────────────────────

export interface ViewState {
  type: string
  state: Record<string, unknown>
}

export interface WorkspaceSplit {
  type: 'split'
  id: string
  direction: 'horizontal' | 'vertical'
  children: WorkspaceNode[]
}

export interface WorkspaceTabs {
  type: 'tabs'
  id: string
  activeLeafId: string | null
  children: WorkspaceLeaf[]
}

export interface WorkspaceLeaf {
  type: 'leaf'
  id: string
  viewState: ViewState
  pinned: boolean
}

export type WorkspaceNode = WorkspaceSplit | WorkspaceTabs | WorkspaceLeaf

// Sidebar panels (top-level split with width + collapsed)
export interface SidebarSplit {
  type: 'split'
  direction: 'horizontal'
  width: number
  collapsed: boolean
  children: WorkspaceNode[]
}

// ── Theme ───────────────────────────────────────────────────────────────────

export type ThemeId = 'dark' | 'light' | 'nord'
export type SidebarView = 'files' | 'calendar'

// ── File system ─────────────────────────────────────────────────────────────

export interface FileNode {
  name: string
  path: string
  kind: 'file' | 'directory'
  children?: FileNode[]
}

// ── Knowledge ───────────────────────────────────────────────────────────────

export interface FileMetadata {
  path: string
  frontmatter: Record<string, unknown>
  outLinks: string[]
  tags: string[]
  aliases: string[]
}

// ── Global store shape ──────────────────────────────────────────────────────

export interface FsState {
  tree: FileNode[]
}

export interface KnowledgeState {
  index: Record<string, FileMetadata>
  backlinkMap: Record<string, string[]>
  tagMap: Record<string, string[]>
  isIndexing: boolean
}

export interface WorkspaceState {
  main: WorkspaceNode
  left: SidebarSplit
  right: SidebarSplit
  activeLeafId: string | null
  sidebarView: SidebarView
  theme: ThemeId
  customCSS: string
  showSettings: boolean
  autoTimestamps: boolean
  showOtherFiles: boolean
}

export interface GlobalState {
  fs: FsState
  knowledge: KnowledgeState
  workspace: WorkspaceState
}

// ── Runtime store shape (non-serializable) ──────────────────────────────────

export interface LeafRuntimeState {
  cmView: EditorView | null
  isDirty: boolean
  outLinks: OutLink[]
  headings: Heading[]
}

export interface RuntimeState {
  rootHandle: FileSystemDirectoryHandle | null
  leafInstances: Record<string, LeafRuntimeState>
}

// ── View registry ───────────────────────────────────────────────────────────

export interface ViewComponentProps {
  leafId: string
  isActive: boolean
  viewState: Record<string, unknown>
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit --skipLibCheck 2>&1 | head -30
```

Expected: errors only from existing files (not from the new types.ts). The file itself should have zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/stores/types.ts
git commit -m "feat: add unified GlobalState and RuntimeState type definitions"
```

---

## Task 2: Create `globalStore.ts` and `runtimeStore.ts`

**Files:**

- Create: `src/stores/globalStore.ts`
- Create: `src/stores/runtimeStore.ts`

- [ ] **Step 1: Create `globalStore.ts`**

```typescript
// src/stores/globalStore.ts
import { createStore } from 'solid-js/store'
import type { GlobalState, ThemeId, WorkspaceNode } from './types'

function saved<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw !== null ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export const ROOT_TABS_ID = 'root-tabs'

const initialMain: WorkspaceNode = {
  type: 'tabs',
  id: ROOT_TABS_ID,
  activeLeafId: null,
  children: [],
}

const [globalStore, setGlobalStore] = createStore<GlobalState>({
  fs: {
    tree: [],
  },
  knowledge: {
    index: {},
    backlinkMap: {},
    tagMap: {},
    isIndexing: false,
  },
  workspace: {
    main: initialMain,
    left: {
      type: 'split',
      direction: 'horizontal',
      width: 190,
      collapsed: false,
      children: [],
    },
    right: {
      type: 'split',
      direction: 'horizontal',
      width: 200,
      collapsed: false,
      children: [],
    },
    activeLeafId: null,
    sidebarView: 'files',
    theme: saved<ThemeId>('sn-theme', 'dark'),
    customCSS: saved<string>('sn-customCSS', ''),
    showSettings: false,
    autoTimestamps: saved<boolean>('sn-autoTimestamps', true),
    showOtherFiles: saved<boolean>('sn-showOtherFiles', true),
  },
})

/** Derived: path of the active file leaf, or null. */
export function activeFilePath(): string | null {
  const { activeLeafId } = globalStore.workspace
  if (!activeLeafId) return null
  const leaf = findLeafInTree(globalStore.workspace.main, activeLeafId)
  return (leaf?.viewState.state.file as string | undefined) ?? null
}

/** Find a WorkspaceLeaf by id anywhere in the tree. */
export function findLeafInTree(
  node: WorkspaceNode,
  leafId: string,
): import('./types').WorkspaceLeaf | null {
  if (node.type === 'leaf') return node.id === leafId ? node : null
  if (node.type === 'tabs') {
    return node.children.find((l) => l.id === leafId) ?? null
  }
  for (const child of node.children) {
    const found = findLeafInTree(child, leafId)
    if (found) return found
  }
  return null
}

export { globalStore, setGlobalStore }
```

- [ ] **Step 2: Create `runtimeStore.ts`**

```typescript
// src/stores/runtimeStore.ts
import { createStore } from 'solid-js/store'
import type { RuntimeState } from './types'

const [runtimeStore, setRuntimeStore] = createStore<RuntimeState>({
  rootHandle: null,
  leafInstances: {},
})

export { runtimeStore, setRuntimeStore }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | head -30
```

Expected: same errors as before (from old files), zero new errors from globalStore.ts or runtimeStore.ts.

- [ ] **Step 4: Commit**

```bash
git add src/stores/globalStore.ts src/stores/runtimeStore.ts
git commit -m "feat: create globalStore and runtimeStore with namespaced state"
```

---

## Task 3: Extract pure functions to `lib/knowledgeUtils.ts`, update test

**Files:**

- Create: `src/lib/knowledgeUtils.ts`
- Modify: `src/__tests__/knowledgeService.test.ts`

The functions `extractLinks`, `extractTags`, `extractAliases`, `extractBodyTags`, `mergeTagsWithBody`, `buildBacklinkMap`, `buildTagMap`, `expandEtag` in `knowledgeService.ts` are pure (no store side-effects). Move them to a separate lib file so they can be tested and used independently of the store.

- [ ] **Step 1: Create `src/lib/knowledgeUtils.ts` with the pure functions**

````typescript
// src/lib/knowledgeUtils.ts
import type { FileMetadata } from '../stores/types'

export function extractLinks(content: string): string[] {
  const matches = [...content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)]
  return [
    ...new Set(
      matches.map((m) => {
        const t = m[1].trim()
        const stem = t.split('/').pop()!
        return stem.includes('.') ? t : `${t}.md`
      }),
    ),
  ]
}

export function extractTags(raw: unknown): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === 'string')
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  return []
}

export function extractAliases(raw: unknown): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean)
  if (typeof raw === 'string')
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  return []
}

const BODY_TAG_RE = /(?<!\S)#([a-zA-Z_一-龥][a-zA-Z0-9_一-龥\/-]*)/g

export function extractBodyTags(body: string): string[] {
  const stripped = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]+`/g, '')
  const seen = new Set<string>()
  for (const m of stripped.matchAll(BODY_TAG_RE)) seen.add(m[1])
  return [...seen]
}

function expandEtag(etag: string): string[] {
  const parts = etag.split('/')
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}

export function mergeTagsWithBody(
  fmTags: string[],
  bodyEtags: string[],
): string[] {
  const set = new Set(fmTags)
  for (const etag of bodyEtags) {
    for (const t of expandEtag(etag)) set.add(t)
  }
  return [...set]
}

export function buildBacklinkMap(
  index: Record<string, FileMetadata>,
): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  for (const path of Object.keys(index)) {
    if (!map[path]) map[path] = []
  }
  for (const [path, meta] of Object.entries(index)) {
    for (const link of meta.outLinks) {
      if (!map[link]) map[link] = []
      if (!map[link].includes(path)) map[link].push(path)
    }
  }
  return map
}

export function buildTagMap(
  index: Record<string, FileMetadata>,
): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  for (const [path, meta] of Object.entries(index)) {
    for (const tag of meta.tags) {
      if (!map[tag]) map[tag] = []
      map[tag].push(path)
    }
  }
  return map
}
````

- [ ] **Step 2: Update the test to import from the new location**

Replace the import in `src/__tests__/knowledgeService.test.ts`:

```typescript
// Old:
import {
  extractLinks,
  extractTags,
  buildBacklinkMap,
} from '../services/knowledgeService'

// New:
import {
  extractLinks,
  extractTags,
  buildBacklinkMap,
} from '../lib/knowledgeUtils'
```

- [ ] **Step 3: Run tests to confirm they still pass**

```bash
npx vitest run
```

Expected output: all existing tests pass (5 test files, all green).

- [ ] **Step 4: Commit**

```bash
git add src/lib/knowledgeUtils.ts src/__tests__/knowledgeService.test.ts
git commit -m "refactor: extract pure knowledge functions to lib/knowledgeUtils"
```

---

## Task 4: Create `src/actions/knowledgeActions.ts`

**Files:**

- Create: `src/actions/knowledgeActions.ts`

This replaces the store-writing portions of `knowledgeService.ts`. Uses `globalStore`/`setGlobalStore` for the `knowledge` namespace, and `runtimeStore` (for `rootHandle`).

- [ ] **Step 1: Create the file**

```typescript
// src/actions/knowledgeActions.ts
import { produce } from 'solid-js/store'
import { globalStore, setGlobalStore } from '../stores/globalStore'
import { runtimeStore } from '../stores/runtimeStore'
import { parseFrontmatter } from '../lib/parseFrontmatter'
import {
  hashContent,
  getCachedMeta,
  setCachedMeta,
  pruneCache,
} from '../services/fileCacheService'
import {
  extractLinks,
  extractTags,
  extractAliases,
  extractBodyTags,
  mergeTagsWithBody,
  buildBacklinkMap,
  buildTagMap,
} from '../lib/knowledgeUtils'
import type { FileMetadata } from '../stores/types'

async function readAllFiles(
  dirHandle: FileSystemDirectoryHandle,
  path = '',
): Promise<Array<{ path: string; content: string | null }>> {
  const results: Array<{ path: string; content: string | null }> = []
  for await (const [name, handle] of dirHandle.entries()) {
    if (name.startsWith('.')) continue
    const nodePath = path ? `${path}/${name}` : name
    if (handle.kind === 'directory') {
      const sub = await readAllFiles(
        handle as FileSystemDirectoryHandle,
        nodePath,
      )
      results.push(...sub)
    } else if (name.endsWith('.md')) {
      const file = await (handle as FileSystemFileHandle).getFile()
      results.push({ path: nodePath, content: await file.text() })
    } else {
      results.push({ path: nodePath, content: null })
    }
  }
  return results
}

export const knowledgeActions = {
  async scanDirectory(): Promise<void> {
    const { rootHandle } = runtimeStore
    if (!rootHandle) return
    const files = await readAllFiles(rootHandle)
    const index: Record<string, FileMetadata> = {}
    const activeHashes = new Set<string>()

    await Promise.all(
      files.map(async ({ path, content }) => {
        if (content === null) {
          index[path] = {
            path,
            frontmatter: {},
            outLinks: [],
            tags: [],
            aliases: [],
          }
          return
        }
        const hash = hashContent(content)
        activeHashes.add(hash)
        const cached = await getCachedMeta(hash)
        if (cached) {
          index[path] = { path, ...cached }
          return
        }
        const { frontmatter, body } = parseFrontmatter(content)
        const parsed = {
          frontmatter,
          outLinks: extractLinks(body),
          tags: mergeTagsWithBody(
            extractTags(frontmatter.tags),
            extractBodyTags(body),
          ),
          aliases: extractAliases(frontmatter.aliases),
        }
        index[path] = { path, ...parsed }
        await setCachedMeta(hash, parsed)
      }),
    )

    const backlinkMap = buildBacklinkMap(index)
    const tagMap = buildTagMap(index)
    setGlobalStore('knowledge', { index, backlinkMap, tagMap })
    pruneCache(activeHashes).catch(() => {})
  },

  async reindexFile(path: string, content: string): Promise<void> {
    const hash = hashContent(content)
    const cached = await getCachedMeta(hash)
    let parsed: Omit<FileMetadata, 'path'>
    if (cached) {
      parsed = cached
    } else {
      const { frontmatter, body } = parseFrontmatter(content)
      parsed = {
        frontmatter,
        outLinks: extractLinks(body),
        tags: mergeTagsWithBody(
          extractTags(frontmatter.tags),
          extractBodyTags(body),
        ),
        aliases: extractAliases(frontmatter.aliases),
      }
      await setCachedMeta(hash, parsed)
    }
    knowledgeActions._applyFileMeta(
      { path, ...parsed },
      globalStore.knowledge.index[path],
    )
  },

  _applyFileMeta(newMeta: FileMetadata, prevMeta?: FileMetadata): void {
    setGlobalStore('knowledge', 'index', newMeta.path, newMeta)

    const prevLinks = new Set(prevMeta?.outLinks ?? [])
    const nextLinks = new Set(newMeta.outLinks)
    for (const t of prevLinks) {
      if (!nextLinks.has(t))
        setGlobalStore(
          'knowledge',
          'backlinkMap',
          t,
          (list) => list?.filter((p) => p !== newMeta.path) ?? [],
        )
    }
    for (const t of nextLinks) {
      if (!prevLinks.has(t))
        setGlobalStore('knowledge', 'backlinkMap', t, (list) =>
          list ? [...list, newMeta.path] : [newMeta.path],
        )
    }

    const prevTags = new Set(prevMeta?.tags ?? [])
    const nextTags = new Set(newMeta.tags)
    for (const t of prevTags) {
      if (!nextTags.has(t))
        setGlobalStore(
          'knowledge',
          'tagMap',
          t,
          (list) => list?.filter((p) => p !== newMeta.path) ?? [],
        )
    }
    for (const t of nextTags) {
      if (!prevTags.has(t))
        setGlobalStore('knowledge', 'tagMap', t, (list) =>
          list ? [...list, newMeta.path] : [newMeta.path],
        )
    }
  },

  removeFileMeta(path: string): void {
    const meta = globalStore.knowledge.index[path]
    if (!meta) return
    for (const t of meta.outLinks) {
      setGlobalStore(
        'knowledge',
        'backlinkMap',
        t,
        (list) => list?.filter((p) => p !== path) ?? [],
      )
    }
    for (const t of meta.tags) {
      setGlobalStore(
        'knowledge',
        'tagMap',
        t,
        (list) => list?.filter((p) => p !== path) ?? [],
      )
    }
    setGlobalStore(
      'knowledge',
      produce((s) => {
        delete s.index[path]
      }),
    )
  },
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | grep "knowledgeActions" | head -20
```

Expected: no errors mentioning `knowledgeActions.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/actions/knowledgeActions.ts
git commit -m "feat: add knowledgeActions using globalStore knowledge namespace"
```

---

## Task 5: Create `src/actions/fsActions.ts`

**Files:**

- Create: `src/actions/fsActions.ts`

Replaces `fileSystemService.ts`. Writes to `globalStore.fs.tree` and `runtimeStore.rootHandle`. The helpers `buildTree`, `getFileHandle`, `replaceWikiLinks`, `updateBacklinks` are copied from `fileSystemService.ts`. After this task, the new file is self-contained but old one is not yet deleted.

- [ ] **Step 1: Create the file**

```typescript
// src/actions/fsActions.ts
import { get, set } from 'idb-keyval'
import { batch } from 'solid-js'
import { globalStore, setGlobalStore } from '../stores/globalStore'
import { runtimeStore, setRuntimeStore } from '../stores/runtimeStore'
import { knowledgeActions } from './knowledgeActions'
import { workspaceActions } from './workspaceActions'
import { clearEmbedUrlCache } from '../lib/embedExtension'
import {
  parseFrontmatter,
  formatTimestamp,
  setFrontmatterField,
} from '../lib/parseFrontmatter'
import type { FileNode } from '../stores/types'

declare global {
  interface Window {
    showDirectoryPicker: (options?: {
      mode?: 'read' | 'readwrite'
    }) => Promise<FileSystemDirectoryHandle>
  }
  interface FileSystemDirectoryHandle {
    requestPermission: (options?: {
      mode?: 'read' | 'readwrite'
    }) => Promise<PermissionState>
  }
}

const DB_KEY = 'rootHandle'

async function buildTree(
  dirHandle: FileSystemDirectoryHandle,
  path = '',
): Promise<FileNode[]> {
  const nodes: FileNode[] = []
  for await (const [name, handle] of dirHandle.entries()) {
    if (name.startsWith('.')) continue
    const nodePath = path ? `${path}/${name}` : name
    if (handle.kind === 'directory') {
      const children = await buildTree(
        handle as FileSystemDirectoryHandle,
        nodePath,
      )
      nodes.push({ name, path: nodePath, kind: 'directory', children })
    } else {
      nodes.push({ name, path: nodePath, kind: 'file' })
    }
  }
  return nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

async function getFileHandle(path: string): Promise<FileSystemFileHandle> {
  const { rootHandle } = runtimeStore
  if (!rootHandle) throw new Error('No root directory')
  const parts = path.split('/')
  let dir: FileSystemDirectoryHandle = rootHandle
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i])
  }
  return dir.getFileHandle(parts[parts.length - 1])
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceWikiLinks(
  content: string,
  oldPath: string,
  newPath: string,
): string {
  const oldBase = oldPath.replace(/\.md$/, '')
  const newBase = newPath.replace(/\.md$/, '')
  const oldStem = oldBase.split('/').pop()!
  const newStem = newBase.split('/').pop()!
  const pairs: [string, string][] = []
  if (oldBase !== oldStem) {
    pairs.push([`${oldBase}.md`, `${newBase}.md`])
    pairs.push([oldBase, newBase])
  }
  pairs.push([`${oldStem}.md`, `${newStem}.md`])
  pairs.push([oldStem, newStem])
  let result = content
  for (const [old, next] of pairs) {
    result = result.replace(
      new RegExp(`\\[\\[${escapeRegex(old)}(\\|[^\\]]*)?\\]\\]`, 'g'),
      (_, alias) => `[[${next}${alias ?? ''}]]`,
    )
  }
  return result
}

async function updateBacklinks(
  backlinks: string[],
  oldPath: string,
  newPath: string,
): Promise<void> {
  for (const bPath of backlinks) {
    try {
      const content = await fsActions.readFile(bPath)
      const updated = replaceWikiLinks(content, oldPath, newPath)
      if (updated !== content) {
        await fsActions.writeFile(bPath, updated)
        await knowledgeActions.reindexFile(bPath, updated)
      }
    } catch {
      /* skip unreadable files */
    }
  }
}

export const fsActions = {
  async openDirectory(): Promise<void> {
    clearEmbedUrlCache()
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
    await set(DB_KEY, handle)
    batch(() => {
      setRuntimeStore('rootHandle', handle)
      setGlobalStore('fs', 'tree', [])
    })
    workspaceActions.clearAllLeaves()
    setGlobalStore('fs', 'tree', await buildTree(handle))
    await knowledgeActions.scanDirectory()
  },

  async restoreDirectory(): Promise<void> {
    const handle = await get<FileSystemDirectoryHandle>(DB_KEY)
    if (!handle) return
    try {
      const perm = await handle.requestPermission({ mode: 'readwrite' })
      if (perm !== 'granted') return
      setRuntimeStore('rootHandle', handle)
      setGlobalStore('fs', 'tree', await buildTree(handle))
      await knowledgeActions.scanDirectory()
    } catch {
      /* handle invalidated */
    }
  },

  async createFile(name: string): Promise<string | null> {
    const { rootHandle } = runtimeStore
    if (!rootHandle) return null
    const parts = name.includes('/') ? name.split('/') : [name]
    const fileName = parts.pop()!
    const finalName = fileName.endsWith('.md') ? fileName : `${fileName}.md`
    let dir = rootHandle
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: true })
    }
    await dir.getFileHandle(finalName, { create: true })
    const path =
      parts.length > 0 ? `${parts.join('/')}/${finalName}` : finalName
    setGlobalStore('fs', 'tree', await buildTree(rootHandle))
    return path
  },

  async createDirectory(name: string): Promise<void> {
    const { rootHandle } = runtimeStore
    if (!rootHandle) return
    const parts = name.split('/')
    let dir = rootHandle
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: true })
    }
    setGlobalStore('fs', 'tree', await buildTree(rootHandle))
  },

  async renameFile(oldPath: string, newName: string): Promise<void> {
    const { rootHandle } = runtimeStore
    if (!rootHandle) return
    const dir = oldPath.includes('/')
      ? oldPath.slice(0, oldPath.lastIndexOf('/'))
      : ''
    const finalName = newName.endsWith('.md') ? newName : `${newName}.md`
    const newPath = dir ? `${dir}/${finalName}` : finalName

    const oldContent = await fsActions.readFile(oldPath)
    let dirHandle: FileSystemDirectoryHandle = rootHandle
    if (dir) {
      for (const part of dir.split('/')) {
        dirHandle = await dirHandle.getDirectoryHandle(part)
      }
    }
    const newHandle = await dirHandle.getFileHandle(finalName, { create: true })
    const writable = await newHandle.createWritable()
    await writable.write(oldContent)
    await writable.close()
    await dirHandle.removeEntry(oldPath.split('/').pop()!)

    const backlinks = globalStore.knowledge.backlinkMap[oldPath] ?? []
    knowledgeActions.removeFileMeta(oldPath)
    workspaceActions.renameLeafPath(oldPath, newPath)
    setGlobalStore('fs', 'tree', await buildTree(rootHandle))
    await knowledgeActions.reindexFile(newPath, oldContent)
    await updateBacklinks(backlinks, oldPath, newPath)
  },

  async deleteFile(path: string): Promise<void> {
    const { rootHandle } = runtimeStore
    if (!rootHandle) return
    const parts = path.split('/')
    const name = parts.pop()!
    let dir: FileSystemDirectoryHandle = rootHandle
    for (const part of parts) dir = await dir.getDirectoryHandle(part)
    await dir.removeEntry(name)
    knowledgeActions.removeFileMeta(path)
    setGlobalStore('fs', 'tree', await buildTree(rootHandle))
  },

  async writeFile(path: string, content: string): Promise<void> {
    const handle = await getFileHandle(path)
    const writable = await handle.createWritable()
    await writable.write(content)
    await writable.close()
  },

  async readFile(path: string): Promise<string> {
    const handle = await getFileHandle(path)
    const file = await handle.getFile()
    return file.text()
  },

  async loadFileContent(path: string): Promise<string> {
    const handle = await getFileHandle(path)
    const file = await handle.getFile()
    let content = await file.text()
    if (globalStore.workspace.autoTimestamps) {
      const { frontmatter } = parseFrontmatter(content)
      const ts = formatTimestamp(file.lastModified)
      let updated = content
      if (!frontmatter.created)
        updated = setFrontmatterField(updated, 'created', ts)
      if (!frontmatter.updated)
        updated = setFrontmatterField(updated, 'updated', ts)
      if (updated !== content) {
        const writable = await handle.createWritable()
        await writable.write(updated)
        await writable.close()
        content = updated
      }
    }
    return content
  },
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | grep "fsActions" | head -20
```

Expected: no errors mentioning `fsActions.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/actions/fsActions.ts
git commit -m "feat: add fsActions using globalStore.fs and runtimeStore.rootHandle"
```

---

## Task 6: Create `src/actions/workspaceActions.ts`

**Files:**

- Create: `src/actions/workspaceActions.ts`

Manages the recursive WorkspaceSplit tree in `globalStore.workspace`. Does NOT know about files—callers pass `viewState` directly. Also manages `runtimeStore.leafInstances` cleanup on close.

- [ ] **Step 1: Create the file**

```typescript
// src/actions/workspaceActions.ts
import { produce } from 'solid-js/store'
import {
  globalStore,
  setGlobalStore,
  ROOT_TABS_ID,
} from '../stores/globalStore'
import { setRuntimeStore } from '../stores/runtimeStore'
import { getView, getFileViewForExt } from '../lib/viewRegistry'
import type {
  WorkspaceNode,
  WorkspaceTabs,
  WorkspaceLeaf,
  ViewState,
} from '../stores/types'

// ── Tree helpers ─────────────────────────────────────────────────────────────

function findParentTabs(
  root: WorkspaceNode,
  leafId: string,
): WorkspaceTabs | null {
  if (root.type === 'tabs') {
    if (root.children.some((l) => l.id === leafId)) return root as WorkspaceTabs
    return null
  }
  if (root.type === 'split') {
    for (const child of root.children) {
      const found = findParentTabs(child, leafId)
      if (found) return found
    }
  }
  return null
}

/** Immutably replace the node with matching id anywhere in the tree. */
function mapNode(
  root: WorkspaceNode,
  id: string,
  updater: (n: WorkspaceNode) => WorkspaceNode,
): WorkspaceNode {
  if ((root as { id: string }).id === id) return updater(root)
  if (root.type === 'split') {
    return {
      ...root,
      children: root.children.map((c) => mapNode(c, id, updater)),
    }
  }
  if (root.type === 'tabs') {
    return {
      ...root,
      children: root.children.map((c) =>
        c.id === id ? (updater(c) as WorkspaceLeaf) : c,
      ),
    }
  }
  return root
}

/** Find a leaf whose viewState.state.file matches path. */
function findLeafWithFile(
  root: WorkspaceNode,
  path: string,
): WorkspaceLeaf | null {
  if (root.type === 'leaf') {
    return root.viewState.state.file === path ? root : null
  }
  if (root.type === 'tabs') {
    return root.children.find((l) => l.viewState.state.file === path) ?? null
  }
  if (root.type === 'split') {
    for (const child of root.children) {
      const found = findLeafWithFile(child, path)
      if (found) return found
    }
  }
  return null
}

// ── Actions ──────────────────────────────────────────────────────────────────

export const workspaceActions = {
  createLeaf(tabsId: string, viewState: ViewState): string {
    const leafId = crypto.randomUUID()
    const leaf: WorkspaceLeaf = {
      type: 'leaf',
      id: leafId,
      viewState,
      pinned: false,
    }
    setGlobalStore('workspace', 'main', (root) =>
      mapNode(root, tabsId, (node) => {
        const tabs = node as WorkspaceTabs
        return {
          ...tabs,
          children: [...tabs.children, leaf],
          activeLeafId: leafId,
        }
      }),
    )
    setGlobalStore('workspace', 'activeLeafId', leafId)
    return leafId
  },

  closeLeaf(leafId: string): void {
    const main = globalStore.workspace.main
    const parentTabs = findParentTabs(main, leafId)
    if (!parentTabs) return
    const remaining = parentTabs.children.filter((l) => l.id !== leafId)
    const nextActiveId =
      parentTabs.activeLeafId === leafId
        ? (remaining[remaining.length - 1]?.id ?? null)
        : parentTabs.activeLeafId
    setGlobalStore('workspace', 'main', (root) =>
      mapNode(root, parentTabs.id, (node) => ({
        ...(node as WorkspaceTabs),
        children: remaining,
        activeLeafId: nextActiveId,
      })),
    )
    if (globalStore.workspace.activeLeafId === leafId) {
      setGlobalStore('workspace', 'activeLeafId', nextActiveId)
    }
    setRuntimeStore(
      'leafInstances',
      produce((s) => {
        delete s[leafId]
      }),
    )
  },

  activateLeaf(leafId: string): void {
    setGlobalStore('workspace', 'activeLeafId', leafId)
    const parentTabs = findParentTabs(globalStore.workspace.main, leafId)
    if (parentTabs) {
      setGlobalStore('workspace', 'main', (root) =>
        mapNode(root, parentTabs.id, (node) => ({
          ...(node as WorkspaceTabs),
          activeLeafId: leafId,
        })),
      )
    }
  },

  setLeafViewState(leafId: string, viewState: ViewState): void {
    setGlobalStore('workspace', 'main', (root) =>
      mapNode(root, leafId, (node) => ({
        ...(node as WorkspaceLeaf),
        viewState,
      })),
    )
  },

  setLeafPinned(leafId: string, pinned: boolean): void {
    setGlobalStore('workspace', 'main', (root) =>
      mapNode(root, leafId, (node) => ({ ...(node as WorkspaceLeaf), pinned })),
    )
  },

  splitLeaf(leafId: string, direction: 'horizontal' | 'vertical'): string {
    const newTabsId = crypto.randomUUID()
    const newLeafId = crypto.randomUUID()
    const parentTabs = findParentTabs(globalStore.workspace.main, leafId)
    if (!parentTabs) return newLeafId

    const newTabs: WorkspaceTabs = {
      type: 'tabs',
      id: newTabsId,
      activeLeafId: newLeafId,
      children: [
        {
          type: 'leaf',
          id: newLeafId,
          viewState: { type: '', state: {} },
          pinned: false,
        },
      ],
    }
    const splitNode: WorkspaceNode = {
      type: 'split',
      id: crypto.randomUUID(),
      direction,
      children: [parentTabs, newTabs],
    }
    setGlobalStore('workspace', 'main', (root) =>
      mapNode(root, parentTabs.id, () => splitNode),
    )
    setGlobalStore('workspace', 'activeLeafId', newLeafId)
    return newLeafId
  },

  openPage(type: string): void {
    const def = getView(type)
    if (!def || def.kind !== 'page') return
    const main = globalStore.workspace.main
    const existing =
      main.type === 'tabs'
        ? main.children.find((l) => l.viewState.type === type)
        : null
    if (existing) {
      workspaceActions.activateLeaf(existing.id)
      return
    }
    workspaceActions.createLeaf(ROOT_TABS_ID, { type, state: {} })
  },

  toggleLeft(): void {
    setGlobalStore('workspace', 'left', 'collapsed', (v) => !v)
  },

  toggleRight(): void {
    setGlobalStore('workspace', 'right', 'collapsed', (v) => !v)
  },

  resizeSidebar(side: 'left' | 'right', width: number): void {
    setGlobalStore('workspace', side, 'width', width)
  },

  /** Called by fsActions.openDirectory to reset all open leaves. */
  clearAllLeaves(): void {
    setGlobalStore('workspace', 'main', {
      type: 'tabs',
      id: ROOT_TABS_ID,
      activeLeafId: null,
      children: [],
    })
    setGlobalStore('workspace', 'activeLeafId', null)
    setRuntimeStore('leafInstances', {})
  },

  /** Called by fsActions.renameFile to update viewState.state.file in open leaves. */
  renameLeafPath(oldPath: string, newPath: string): void {
    const ext = newPath.slice(newPath.lastIndexOf('.')).toLowerCase()
    const def = getFileViewForExt(ext)
    const newType = def?.type ?? 'markdown'
    setGlobalStore('workspace', 'main', (root) => {
      function walk(node: WorkspaceNode): WorkspaceNode {
        if (node.type === 'leaf' && node.viewState.state.file === oldPath) {
          return {
            ...node,
            viewState: { type: newType, state: { file: newPath } },
          }
        }
        if (node.type === 'tabs') {
          return {
            ...node,
            children: node.children.map(walk) as WorkspaceLeaf[],
          }
        }
        if (node.type === 'split') {
          return { ...node, children: node.children.map(walk) }
        }
        return node
      }
      return walk(root)
    })
  },
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | grep "workspaceActions" | head -20
```

Expected: no errors from `workspaceActions.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/actions/workspaceActions.ts
git commit -m "feat: add workspaceActions for WorkspaceSplit tree management"
```

---

## Task 7: Create `src/actions/appActions.ts`

**Files:**

- Create: `src/actions/appActions.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/actions/appActions.ts
import { setGlobalStore } from '../stores/globalStore'
import type { ThemeId } from '../stores/types'

export const appActions = {
  setTheme(theme: ThemeId): void {
    setGlobalStore('workspace', 'theme', theme)
    localStorage.setItem('sn-theme', JSON.stringify(theme))
  },

  setCustomCSS(css: string): void {
    setGlobalStore('workspace', 'customCSS', css)
    localStorage.setItem('sn-customCSS', JSON.stringify(css))
  },

  toggleSettings(): void {
    setGlobalStore('workspace', 'showSettings', (v) => !v)
  },

  setAutoTimestamps(value: boolean): void {
    setGlobalStore('workspace', 'autoTimestamps', value)
    localStorage.setItem('sn-autoTimestamps', JSON.stringify(value))
  },

  setShowOtherFiles(value: boolean): void {
    setGlobalStore('workspace', 'showOtherFiles', value)
    localStorage.setItem('sn-showOtherFiles', JSON.stringify(value))
  },
}
```

- [ ] **Step 2: Commit**

```bash
git add src/actions/appActions.ts
git commit -m "feat: add appActions for theme and settings mutations"
```

---

## Task 8: Update `src/lib/viewRegistry.ts` — new component prop type

**Files:**

- Modify: `src/lib/viewRegistry.ts`

Change the `component` prop type in `FileViewDef` and `PageViewDef` from `{ tabId, isActive }` to `ViewComponentProps` from the types file.

- [ ] **Step 1: Update the file**

```typescript
// src/lib/viewRegistry.ts
import type { Component } from 'solid-js'
import type { JSX } from 'solid-js'
import type { ViewComponentProps } from '../stores/types'

export interface FileViewDef {
  kind: 'file'
  type: string
  getDisplayText(path: string): string
  getIcon?(): JSX.Element
  canAcceptFile(ext: string): boolean
  component: Component<ViewComponentProps>
}

export interface PageViewDef {
  kind: 'page'
  type: string
  getDisplayText(): string
  getIcon?(): JSX.Element
  component: Component<ViewComponentProps>
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

export function _clearRegistryForTest(): void {
  registry.clear()
}
```

- [ ] **Step 2: Verify tests still pass**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/viewRegistry.ts
git commit -m "refactor: update viewRegistry component type to ViewComponentProps"
```

---

## Task 9: Create workspace renderer components

**Files:**

- Create: `src/components/workspace/WorkspaceLeafView.tsx`
- Create: `src/components/workspace/WorkspaceTabsView.tsx`
- Create: `src/components/workspace/WorkspaceSplitView.tsx`
- Create: `src/components/workspace/WorkspaceNodeRenderer.tsx`
- Create: `src/components/workspace/SidebarRenderer.tsx`

These replace `TabBar.tsx` and `ContentPane.tsx`.

- [ ] **Step 1: Create `WorkspaceLeafView.tsx`**

```tsx
// src/components/workspace/WorkspaceLeafView.tsx
import { Dynamic } from 'solid-js/web'
import { getView } from '../../lib/viewRegistry'
import type { WorkspaceLeaf } from '../../stores/types'

export function WorkspaceLeafView(props: {
  leaf: WorkspaceLeaf
  isActive: boolean
}) {
  const def = () => getView(props.leaf.viewState.type)
  return (
    <Dynamic
      component={def()?.component}
      leafId={props.leaf.id}
      isActive={props.isActive}
      viewState={props.leaf.viewState.state}
    />
  )
}
```

- [ ] **Step 2: Create `WorkspaceTabsView.tsx`**

```tsx
// src/components/workspace/WorkspaceTabsView.tsx
import { For, createMemo } from 'solid-js'
import { globalStore } from '../../stores/globalStore'
import { workspaceActions } from '../../actions/workspaceActions'
import { getView } from '../../lib/viewRegistry'
import { WorkspaceLeafView } from './WorkspaceLeafView'
import type { WorkspaceTabs, WorkspaceLeaf } from '../../stores/types'
import { PanelRight } from 'lucide-solid'

function getTabLabel(leaf: WorkspaceLeaf): string {
  const def = getView(leaf.viewState.type)
  if (!def) return leaf.viewState.type
  const file = leaf.viewState.state.file as string | undefined
  return def.kind === 'file' && file
    ? def.getDisplayText(file)
    : def.getDisplayText()
}

export function WorkspaceTabsView(props: {
  node: WorkspaceTabs
  isRoot?: boolean
}) {
  return (
    <div class="flex flex-col h-full">
      {/* Tab bar */}
      <div class="h-8 bg-[var(--bg-base)] border-b border-(--border)] flex items-stretch shrink-0 overflow-y-hidden">
        <div class="flex flex-1 overflow-x-auto overflow-y-hidden">
          <For each={props.node.children}>
            {(leaf) => {
              const isActive = createMemo(
                () => leaf.id === props.node.activeLeafId,
              )
              const isPinned = () => leaf.pinned
              const def = () => getView(leaf.viewState.type)
              return (
                <div
                  class={`flex items-center gap-1.5 px-3 border-r border-(--border)] cursor-pointer text-[11px] shrink-0
                    ${
                      isActive()
                        ? 'bg-[var(--bg-base)] text-[var(--text)] border-b-2 border-b-(--accent) -mb-px'
                        : 'text-[var(--text-3)] hover:bg-(--bg-hover)'
                    }`}
                  onClick={() => workspaceActions.activateLeaf(leaf.id)}
                  onDblClick={() =>
                    workspaceActions.setLeafPinned(leaf.id, true)
                  }
                >
                  {def()?.getIcon?.()}
                  <span
                    class={`max-w-[120px] truncate ${!isPinned() && leaf.viewState.state.file ? 'italic' : ''}`}
                  >
                    {getTabLabel(leaf)}
                  </span>
                  <button
                    class="text-[var(--text-4)] hover:text-[var(--text-2)] text-[13px] leading-none ml-0.5"
                    onClick={(e) => {
                      e.stopPropagation()
                      workspaceActions.closeLeaf(leaf.id)
                    }}
                  >
                    ×
                  </button>
                </div>
              )
            }}
          </For>
        </div>
        {/* Toggle right panel button — only on root tabs */}
        {props.isRoot && (
          <button
            class="px-2 shrink-0 text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-(--bg-hover) flex items-center transition-colors"
            onClick={() => workspaceActions.toggleRight()}
            title="切换右侧栏"
          >
            <PanelRight size={15} />
          </button>
        )}
      </div>
      {/* Leaf area — all leaves mounted, only active shown */}
      <div class="flex-1 relative overflow-hidden">
        <For each={props.node.children}>
          {(leaf) => {
            const isActive = createMemo(
              () => leaf.id === props.node.activeLeafId,
            )
            return (
              <div
                class="absolute inset-0 flex flex-col overflow-hidden"
                style={{ display: isActive() ? 'flex' : 'none' }}
              >
                <WorkspaceLeafView
                  leaf={leaf}
                  isActive={isActive()}
                />
              </div>
            )
          }}
        </For>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create `WorkspaceSplitView.tsx`**

```tsx
// src/components/workspace/WorkspaceSplitView.tsx
import { For } from 'solid-js'
import { WorkspaceNodeRenderer } from './WorkspaceNodeRenderer'
import type { WorkspaceSplit } from '../../stores/types'

export function WorkspaceSplitView(props: { node: WorkspaceSplit }) {
  return (
    <div
      class="flex h-full w-full"
      style={{
        'flex-direction':
          props.node.direction === 'horizontal' ? 'row' : 'column',
      }}
    >
      <For each={props.node.children}>
        {(child) => (
          <div class="flex-1 min-w-0 min-h-0 overflow-hidden">
            <WorkspaceNodeRenderer node={child} />
          </div>
        )}
      </For>
    </div>
  )
}
```

- [ ] **Step 4: Create `WorkspaceNodeRenderer.tsx`**

```tsx
// src/components/workspace/WorkspaceNodeRenderer.tsx
import { Match, Switch } from 'solid-js'
import { ROOT_TABS_ID } from '../../stores/globalStore'
import { WorkspaceSplitView } from './WorkspaceSplitView'
import { WorkspaceTabsView } from './WorkspaceTabsView'
import { WorkspaceLeafView } from './WorkspaceLeafView'
import type { WorkspaceNode } from '../../stores/types'

export function WorkspaceNodeRenderer(props: { node: WorkspaceNode }) {
  return (
    <Switch>
      <Match when={props.node.type === 'split'}>
        <WorkspaceSplitView
          node={props.node as import('../../stores/types').WorkspaceSplit}
        />
      </Match>
      <Match when={props.node.type === 'tabs'}>
        <WorkspaceTabsView
          node={props.node as import('../../stores/types').WorkspaceTabs}
          isRoot={
            (props.node as import('../../stores/types').WorkspaceTabs).id ===
            ROOT_TABS_ID
          }
        />
      </Match>
      <Match when={props.node.type === 'leaf'}>
        <WorkspaceLeafView
          leaf={props.node as import('../../stores/types').WorkspaceLeaf}
          isActive={true}
        />
      </Match>
    </Switch>
  )
}
```

- [ ] **Step 5: Create `SidebarRenderer.tsx`**

```tsx
// src/components/workspace/SidebarRenderer.tsx
import type { JSX } from 'solid-js'
import type { SidebarSplit } from '../../stores/types'

export function SidebarRenderer(props: {
  sidebar: SidebarSplit
  children: JSX.Element
}) {
  return (
    <div
      class="transition-all duration-200 overflow-hidden shrink-0"
      style={{
        width: props.sidebar.collapsed ? '0px' : `${props.sidebar.width}px`,
      }}
    >
      {props.children}
    </div>
  )
}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/workspace/
git commit -m "feat: add WorkspaceNodeRenderer, WorkspaceTabsView, SidebarRenderer components"
```

---

## Task 10: Update `App.tsx`

**Files:**

- Modify: `src/App.tsx`

Replace `TabBar` + `ContentPane` with `WorkspaceNodeRenderer`. Replace old store imports with `globalStore` + new actions. Keep `Sidebar`, `CalendarPanel`, `RightPanel`, `StatusBar`, `Settings` (they will be updated in subsequent tasks, but they still compile because old stores exist in parallel until Task 16).

- [ ] **Step 1: Rewrite `App.tsx`**

```tsx
// src/App.tsx
import { createEffect, onMount, Show } from 'solid-js'
import { CalendarRange } from 'lucide-solid'
import { Ribbon } from './components/Ribbon'
import { Sidebar } from './components/Sidebar'
import { CalendarPanel } from './components/CalendarPanel'
import { RightPanel } from './components/RightPanel'
import { StatusBar } from './components/StatusBar'
import { Settings } from './components/Settings'
import { WorkspaceNodeRenderer } from './components/workspace/WorkspaceNodeRenderer'
import { SidebarRenderer } from './components/workspace/SidebarRenderer'
import { fsActions } from './actions/fsActions'
import { globalStore } from './stores/globalStore'
import { registerView } from './lib/viewRegistry'
import { EditorPane } from './components/EditorPane'
import { ImageViewer } from './components/ImageViewer'
import { CalendarPage } from './components/CalendarPage'

const customStyleEl = document.createElement('style')
document.head.appendChild(customStyleEl)

const IMAGE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.bmp',
  '.avif',
])

registerView({
  kind: 'file',
  type: 'markdown',
  getDisplayText: (path) => path.split('/').pop()!,
  canAcceptFile: (ext) => ext === '.md',
  component: EditorPane,
})

registerView({
  kind: 'file',
  type: 'image',
  getDisplayText: (path) => path.split('/').pop()!,
  canAcceptFile: (ext) => IMAGE_EXTS.has(ext),
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
    document.documentElement.setAttribute(
      'data-theme',
      globalStore.workspace.theme,
    )
  })

  createEffect(() => {
    customStyleEl.textContent = globalStore.workspace.customCSS
  })

  onMount(async () => {
    await fsActions.restoreDirectory()
  })

  return (
    <div class="h-full flex flex-col bg-[var(--bg-base)] text-[var(--text)] overflow-hidden">
      <div class="flex flex-1 overflow-hidden">
        <Ribbon />
        <SidebarRenderer sidebar={globalStore.workspace.left}>
          <Show
            when={globalStore.workspace.sidebarView === 'calendar'}
            fallback={<Sidebar />}
          >
            <CalendarPanel />
          </Show>
        </SidebarRenderer>
        <div class="flex-1 flex flex-col overflow-hidden min-w-0">
          <WorkspaceNodeRenderer node={globalStore.workspace.main} />
        </div>
        <SidebarRenderer sidebar={globalStore.workspace.right}>
          <RightPanel />
        </SidebarRenderer>
      </div>
      <StatusBar />
      <Show when={globalStore.workspace.showSettings}>
        <Settings />
      </Show>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/App.tsx
git commit -m "feat: update App.tsx to use globalStore and WorkspaceNodeRenderer"
```

---

## Task 11: Update `EditorPane.tsx`

**Files:**

- Modify: `src/components/EditorPane.tsx`

Change props from `{ tabId, isActive }` to `ViewComponentProps` (`{ leafId, isActive, viewState }`). Read file path from `viewState.file`. Use `runtimeStore.leafInstances[leafId]` instead of global `editorStore`. Use `fsActions` and `knowledgeActions`.

- [ ] **Step 1: Rewrite `EditorPane.tsx`**

```tsx
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
import { setRuntimeStore } from '../stores/runtimeStore'
import { globalStore } from '../stores/globalStore'
import { fsActions } from '../actions/fsActions'
import { knowledgeActions } from '../actions/knowledgeActions'
import { workspaceActions } from '../actions/workspaceActions'
import { startBackgroundParsing } from '../services/backgroundParser'
import { formatTimestamp, setFrontmatterField } from '../lib/parseFrontmatter'
import type { ViewComponentProps } from '../stores/types'
import type { ViewUpdate } from '@codemirror/view'

function buildEditorState(
  doc: string,
  onDocChange: (u: ViewUpdate) => void,
  onKeyDown: (e: KeyboardEvent) => void,
): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: 0 },
    extensions: [
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
    ],
  })
}

export function EditorPane(props: ViewComponentProps) {
  const filePath = () => props.viewState.file as string | undefined

  let container!: HTMLDivElement
  let view: EditorView | null = null
  let reindexTimer: ReturnType<typeof setTimeout> | null = null
  let localDirty = false

  function setLeafRuntime(
    patch: Partial<{
      cmView: EditorView | null
      isDirty: boolean
      outLinks: any[]
      headings: any[]
    }>,
  ) {
    setRuntimeStore('leafInstances', props.leafId, (prev) => ({
      cmView: null,
      isDirty: false,
      outLinks: [],
      headings: [],
      ...prev,
      ...patch,
    }))
  }

  function handleDocChange(update: ViewUpdate) {
    if (!update.docChanged) return
    const isRemote = update.transactions.some((tr) =>
      tr.annotation(Transaction.remote),
    )
    if (!isRemote) {
      localDirty = true
      if (props.isActive) setLeafRuntime({ isDirty: true })
    }
    if (reindexTimer !== null) clearTimeout(reindexTimer)
    reindexTimer = setTimeout(() => {
      reindexTimer = null
      const p = filePath()
      if (p && view)
        void knowledgeActions.reindexFile(p, view.state.doc.toString())
    }, 800)
    if (props.isActive) {
      setLeafRuntime({
        outLinks: update.state.field(outLinksField),
        headings: update.state.field(headingsField),
      })
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
    if (globalStore.workspace.autoTimestamps) {
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
    await fsActions.writeFile(p, content)
    localDirty = false
    if (props.isActive) setLeafRuntime({ isDirty: false })
    await knowledgeActions.reindexFile(p, content)
  }

  onMount(async () => {
    const p = filePath()
    if (!p) return
    const doc = await fsActions.loadFileContent(p)
    view = new EditorView({
      state: buildEditorState(doc, handleDocChange, handleKeyDown),
      parent: container,
    })
    if (filePath() === p && props.isActive) {
      setLeafRuntime({
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
    if (props.isActive)
      setLeafRuntime({
        cmView: null,
        isDirty: false,
        outLinks: [],
        headings: [],
      })
  })

  // viewState.file changed (preview replacement): reload without unmounting
  createEffect(async () => {
    const p = filePath()
    if (!view || !p) return
    const newContent = await fsActions.loadFileContent(p)
    const newState = buildEditorState(
      newContent,
      handleDocChange,
      handleKeyDown,
    )
    view.setState(newState)
    view.scrollDOM.scrollTop = 0
    localDirty = false
    if (props.isActive) {
      setLeafRuntime({
        isDirty: false,
        outLinks: view.state.field(outLinksField),
        headings: view.state.field(headingsField),
      })
    }
    void startBackgroundParsing(p)
  })

  // Sync runtimeStore when this pane becomes the active tab
  createEffect(() => {
    if (props.isActive && view) {
      setLeafRuntime({
        cmView: view,
        outLinks: view.state.field(outLinksField),
        headings: view.state.field(headingsField),
        isDirty: localDirty,
      })
    }
  })

  // ── Inline file rename ───────────────────────────────────────────────────
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
    await fsActions.renameFile(p, name)
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
                class="text-[22px] font-bold text-[var(--text)] cursor-text hover:text-(--accent) transition-colors truncate leading-tight"
                onClick={startEdit}
                title="点击修改文件名"
              >
                {stem() || '未命名'}
              </h1>
            }
          >
            <input
              class="w-full bg-transparent border-b-2 border-(--accent) outline-none text-[22px] font-bold text-[var(--text)] pb-0.5 leading-tight"
              value={draft()}
              onInput={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={onTitleKeyDown}
              onBlur={() => void confirmRename()}
              ref={(el) =>
                setTimeout(() => {
                  el.focus()
                  el.select()
                }, 0)
              }
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

- [ ] **Step 2: Commit**

```bash
git add src/components/EditorPane.tsx
git commit -m "feat: update EditorPane to use leafId/viewState props and runtimeStore"
```

---

## Task 12: Update `ImageViewer.tsx` and `CalendarPage.tsx`

**Files:**

- Modify: `src/components/ImageViewer.tsx`
- Modify: `src/components/CalendarPage.tsx`

Both switch from `{ tabId, isActive }` to `ViewComponentProps`.

- [ ] **Step 1: Update `ImageViewer.tsx`**

```tsx
// src/components/ImageViewer.tsx
import { createResource, Match, Switch } from 'solid-js'
import { runtimeStore } from '../stores/runtimeStore'
import type { ViewComponentProps } from '../stores/types'

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

export function ImageViewer(props: ViewComponentProps) {
  const path = () => props.viewState.file as string | undefined

  const [dataUrl] = createResource(
    () => {
      const p = path()
      const root = runtimeStore.rootHandle
      return p && root ? { path: p, root } : null
    },
    ({ path, root }) => readImageDataUrl(path, root),
  )

  const fileName = () => path()?.split('/').pop() ?? ''

  return (
    <div class="flex-1 flex flex-col overflow-hidden bg-(--bg-base)">
      <div class="h-9 px-4 flex items-center border-b border-(--border) shrink-0">
        <span class="text-[12px] text-(--text-2) truncate">{fileName()}</span>
      </div>
      <div class="flex-1 flex items-center justify-center overflow-auto p-6">
        <Switch>
          <Match when={dataUrl.error}>
            <div class="text-[12px] text-(--text-4)">无法加载图片</div>
          </Match>
          <Match when={dataUrl.loading}>
            <div class="text-[12px] text-(--text-4)">加载中…</div>
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

- [ ] **Step 2: Update `CalendarPage.tsx` props signature**

Open `src/components/CalendarPage.tsx` and change the component signature from `(props: { tabId: string; isActive: boolean })` to `(props: ViewComponentProps)`. The body of the component does not need other changes since it doesn't use tabId.

Find the line:

```tsx
export function CalendarPage(props: { tabId: string; isActive: boolean }) {
```

Replace with:

```tsx
import type { ViewComponentProps } from '../stores/types'
// ...
export function CalendarPage(props: ViewComponentProps) {
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ImageViewer.tsx src/components/CalendarPage.tsx
git commit -m "feat: update ImageViewer and CalendarPage to ViewComponentProps"
```

---

## Task 13: Update `Sidebar.tsx` and `backgroundParser.ts`

**Files:**

- Modify: `src/components/Sidebar.tsx`
- Modify: `src/services/backgroundParser.ts`

- [ ] **Step 1: Update `Sidebar.tsx`**

```tsx
// src/components/Sidebar.tsx
import { For, Show, createSignal } from 'solid-js'
import { FolderOpen } from 'lucide-solid'
import {
  globalStore,
  activeFilePath,
  findLeafInTree,
  ROOT_TABS_ID,
} from '../stores/globalStore'
import { runtimeStore } from '../stores/runtimeStore'
import { fsActions } from '../actions/fsActions'
import { workspaceActions } from '../actions/workspaceActions'
import { getFileViewForExt } from '../lib/viewRegistry'
import type { FileNode, ViewState, WorkspaceLeaf } from '../stores/types'

const IMAGE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.bmp',
  '.avif',
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

function openFileInWorkspace(
  path: string,
  opts: { newTab?: boolean; pin?: boolean } = {},
): void {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  const def = getFileViewForExt(ext)
  if (!def) return
  const viewState: ViewState = { type: def.type, state: { file: path } }

  // Already open? Activate it.
  const existing = findLeafWithFile(globalStore.workspace.main, path)
  if (existing) {
    workspaceActions.activateLeaf(existing.id)
    return
  }

  const { activeLeafId } = globalStore.workspace
  const activeLeaf = activeLeafId
    ? findLeafInTree(globalStore.workspace.main, activeLeafId)
    : null

  // Preview replacement: replace unpinned active leaf
  if (
    !opts.newTab &&
    activeLeaf &&
    !activeLeaf.pinned &&
    activeLeaf.viewState.type !== 'calendar'
  ) {
    workspaceActions.setLeafViewState(activeLeafId!, viewState)
    if (opts.pin) workspaceActions.setLeafPinned(activeLeafId!, true)
    return
  }

  const leafId = workspaceActions.createLeaf(ROOT_TABS_ID, viewState)
  if (opts.pin) workspaceActions.setLeafPinned(leafId, true)
}

function findLeafWithFile(
  root: import('../stores/types').WorkspaceNode,
  path: string,
): WorkspaceLeaf | null {
  if (root.type === 'leaf' && root.viewState.state.file === path) return root
  if (root.type === 'tabs')
    return root.children.find((l) => l.viewState.state.file === path) ?? null
  if (root.type === 'split') {
    for (const child of root.children) {
      const found = findLeafWithFile(child, path)
      if (found) return found
    }
  }
  return null
}

function FileTreeNode(props: { node: FileNode; depth: number }) {
  const isActive = () => activeFilePath() === props.node.path
  const isOther = () =>
    props.node.kind === 'file' && isOtherFile(props.node.name)
  const show = () =>
    props.node.kind === 'directory' ||
    !isOtherFile(props.node.name) ||
    globalStore.workspace.showOtherFiles

  return (
    <Show when={show()}>
      <div>
        <div
          class={`flex items-center gap-1 py-0.5 text-[11px] cursor-pointer hover:bg-(--bg-hover) select-none
            ${
              isActive()
                ? 'bg-(--bg-hover) border-l-2 border-(--accent) text-[var(--text)]'
                : isOther()
                  ? 'text-[var(--text-4)] border-l-2 border-transparent'
                  : 'text-[var(--text-2)] border-l-2 border-transparent'
            }`}
          style={{ 'padding-left': `${6 + props.depth * 14}px` }}
          onClick={() => {
            if (props.node.kind !== 'file') return
            if (!canOpen(props.node.name)) return
            openFileInWorkspace(props.node.path)
          }}
          onDblClick={() => {
            if (props.node.kind !== 'file') return
            if (!canOpen(props.node.name)) return
            openFileInWorkspace(props.node.path, { newTab: true, pin: true })
          }}
        >
          <span class="text-[9px] text-[var(--text-3)]">
            {props.node.kind === 'directory' ? '▸' : fileIcon(props.node.name)}
          </span>
          <span class={isActive() ? 'text-(--accent)' : ''}>
            {displayName(props.node.name)}
          </span>
        </div>
        <Show when={props.node.kind === 'directory'}>
          <For each={props.node.children ?? []}>
            {(child) => (
              <FileTreeNode
                node={child}
                depth={props.depth + 1}
              />
            )}
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
      const path = await fsActions.createFile(name)
      if (path) openFileInWorkspace(path, { newTab: true, pin: true })
    } else if (mode === 'folder') {
      await fsActions.createDirectory(name)
    }
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') void confirm()
    else if (e.key === 'Escape') cancel()
  }

  return (
    <div class="w-[190px] h-full bg-[var(--bg-surface)] border-r border-(--border)] flex flex-col">
      <div class="border-b border-(--border)] shrink-0 flex items-center gap-0.5 pr-1 min-w-0">
        <button
          class="flex items-center gap-1.5 flex-1 px-2.5 py-2 text-left hover:bg-(--bg-hover) transition-colors min-w-0 group"
          onClick={fsActions.openDirectory}
          title={runtimeStore.rootHandle ? '切换文件夹' : '打开文件夹'}
        >
          <FolderOpen
            size={12}
            class="shrink-0 text-(--accent) group-hover:text-[var(--accent-2)]"
          />
          <span class="truncate text-[10px] text-(--accent) font-bold tracking-widest uppercase group-hover:text-[var(--accent-2)]">
            {runtimeStore.rootHandle?.name ?? '打开文件夹'}
          </span>
        </button>
        <Show when={runtimeStore.rootHandle}>
          <button
            class="shrink-0 text-[var(--text-3)] hover:text-[var(--accent-2)] w-5 h-5 flex items-center justify-center rounded hover:bg-(--bg-hover) transition-colors text-[13px]"
            title="新建文件夹"
            onClick={() => startCreate('folder')}
          >
            ⊞
          </button>
          <button
            class="shrink-0 text-[var(--text-3)] hover:text-[var(--accent-2)] w-5 h-5 flex items-center justify-center rounded hover:bg-(--bg-hover) transition-colors"
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
            <span class="text-[9px] text-(--text-3)">
              {createMode() === 'folder' ? '▸' : '◻'}
            </span>
            <input
              class="flex-1 bg-(--bg-hover) border border-(--accent) rounded px-1.5 py-0.5 text-[11px] text-(--text) outline-none min-w-0"
              placeholder={
                createMode() === 'folder'
                  ? '文件夹 或 父/子/文件夹'
                  : '文件名 或 目录/文件名'
              }
              value={newName()}
              onInput={(e) => setNewName(e.currentTarget.value)}
              onKeyDown={onKeyDown}
              onBlur={() => void confirm()}
              ref={(el) => setTimeout(() => el?.focus(), 0)}
            />
          </div>
        </Show>
        <For each={globalStore.fs.tree}>
          {(node) => (
            <FileTreeNode
              node={node}
              depth={0}
            />
          )}
        </For>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update `backgroundParser.ts`** — change `fileSystemStore.rootHandle` to `runtimeStore.rootHandle`

Open `src/services/backgroundParser.ts`. Find the import:

```ts
import { fileSystemStore } from '../stores/fileSystemStore'
```

Replace with:

```ts
import { runtimeStore } from '../stores/runtimeStore'
```

Then find every occurrence of `fileSystemStore.rootHandle` and replace with `runtimeStore.rootHandle`.

- [ ] **Step 3: Commit**

```bash
git add src/components/Sidebar.tsx src/services/backgroundParser.ts
git commit -m "feat: update Sidebar and backgroundParser to use globalStore and runtimeStore"
```

---

## Task 14: Update `Ribbon.tsx`

**Files:**

- Modify: `src/components/Ribbon.tsx`

- [ ] **Step 1: Rewrite `Ribbon.tsx`**

```tsx
// src/components/Ribbon.tsx
import {
  Search,
  Network,
  Settings,
  CalendarDays,
  CalendarRange,
  PanelLeft,
} from 'lucide-solid'
import { globalStore, setGlobalStore } from '../stores/globalStore'
import { workspaceActions } from '../actions/workspaceActions'
import { appActions } from '../actions/appActions'

export function Ribbon() {
  const switchView = (view: 'files' | 'calendar') => {
    if (
      globalStore.workspace.sidebarView === view &&
      !globalStore.workspace.left.collapsed
    ) {
      workspaceActions.toggleLeft()
    } else {
      setGlobalStore('workspace', 'sidebarView', view)
      setGlobalStore('workspace', 'left', 'collapsed', false)
    }
  }

  const calendarPageActive = () => {
    const main = globalStore.workspace.main
    if (main.type !== 'tabs') return false
    const activeId = globalStore.workspace.activeLeafId
    return main.children.some(
      (l) => l.viewState.type === 'calendar' && l.id === activeId,
    )
  }

  return (
    <div class="w-9 bg-(--bg-base) border-r border-(--border) flex flex-col items-center py-2 gap-1.5 shrink-0">
      <button
        onClick={() => workspaceActions.toggleLeft()}
        class="p-1.5 text-(--text-3) hover:bg-(--bg-hover) hover:text-(--text) rounded cursor-pointer transition-colors"
        title="切换左侧栏"
      >
        <PanelLeft size={18} />
      </button>
      <button
        class={`p-1.5 rounded cursor-pointer transition-colors hover:bg-(--bg-hover)
          ${
            globalStore.workspace.sidebarView === 'files' &&
            !globalStore.workspace.left.collapsed
              ? 'text-(--accent)'
              : 'text-(--text-3) hover:text-(--text)'
          }`}
        title="文件列表"
        onClick={() => switchView('files')}
      >
        <Search size={18} />
      </button>
      <button
        class={`p-1.5 rounded cursor-pointer transition-colors hover:bg-(--bg-hover)
          ${
            globalStore.workspace.sidebarView === 'calendar' &&
            !globalStore.workspace.left.collapsed
              ? 'text-(--accent)'
              : 'text-(--text-3) hover:text-(--text)'
          }`}
        title="日历"
        onClick={() => switchView('calendar')}
      >
        <CalendarDays size={18} />
      </button>
      <button
        class={`p-1.5 rounded cursor-pointer transition-colors hover:bg-(--bg-hover)
          ${calendarPageActive() ? 'text-(--accent)' : 'text-(--text-3) hover:text-(--text)'}`}
        title="日历大图"
        onClick={() => workspaceActions.openPage('calendar')}
      >
        <CalendarRange size={18} />
      </button>
      <button
        class="p-1.5 text-(--text-3) hover:bg-(--bg-hover) hover:text-(--text) rounded cursor-pointer transition-colors"
        title="知识图谱"
      >
        <Network size={18} />
      </button>
      <div class="flex-1" />
      <button
        class="p-1.5 text-(--text-3) hover:bg-(--bg-hover) hover:text-(--text) rounded cursor-pointer transition-colors"
        title="设置"
        onClick={() => appActions.toggleSettings()}
      >
        <Settings size={18} />
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Ribbon.tsx
git commit -m "feat: update Ribbon to use globalStore and workspaceActions"
```

---

## Task 15: Update `RightPanel.tsx`, `StatusBar.tsx`, and `Settings.tsx`

**Files:**

- Modify: `src/components/RightPanel.tsx`
- Modify: `src/components/StatusBar.tsx`
- Modify: `src/components/Settings.tsx`

- [ ] **Step 1: Update `RightPanel.tsx`**

```tsx
// src/components/RightPanel.tsx
import { createSignal, createMemo, For, Show } from 'solid-js'
import { EditorView } from '@codemirror/view'
import { globalStore, activeFilePath } from '../stores/globalStore'
import { runtimeStore } from '../stores/runtimeStore'

type Tab = 'links' | 'outline' | 'tags'

export function RightPanel() {
  const [activeTab, setActiveTab] = createSignal<Tab>('links')

  const activeRuntime = createMemo(() => {
    const id = globalStore.workspace.activeLeafId
    return id ? (runtimeStore.leafInstances[id] ?? null) : null
  })

  const currentMeta = createMemo(() => {
    const path = activeFilePath()
    return path ? (globalStore.knowledge.index[path] ?? null) : null
  })

  const outLinks = createMemo(() => activeRuntime()?.outLinks ?? [])

  const backlinks = createMemo(() => {
    const path = activeFilePath()
    if (!path) return []
    const aliases = globalStore.knowledge.index[path]?.aliases ?? []
    const keys = [path, ...aliases, ...aliases.map((a) => `${a}.md`)]
    const seen = new Set<string>()
    const result: string[] = []
    for (const key of keys) {
      for (const bl of globalStore.knowledge.backlinkMap[key] ?? []) {
        if (!seen.has(bl)) {
          seen.add(bl)
          result.push(bl)
        }
      }
    }
    return result
  })

  const tags = createMemo(() => currentMeta()?.tags ?? [])
  const outline = createMemo(() => activeRuntime()?.headings ?? [])

  const jumpToHeading = (pos: number) => {
    const view = activeRuntime()?.cmView
    if (!view) return
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 40 }),
    })
    view.focus()
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'links', label: '链接' },
    { id: 'outline', label: '大纲' },
    { id: 'tags', label: '标签' },
  ]

  return (
    <div class="w-50 h-full bg-[var(--bg-surface)] border-l border-(--border)] flex flex-col shrink-0">
      <div class="flex border-b border-(--border)] shrink-0">
        <For each={tabs}>
          {(tab) => (
            <button
              class={`flex-1 py-1.5 text-[10px] cursor-pointer transition-colors
                ${
                  activeTab() === tab.id
                    ? 'text-(--accent) border-b-2 border-(--accent) -mb-px'
                    : 'text-[var(--text-3)] hover:text-[var(--text-2)]'
                }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          )}
        </For>
      </div>
      <div class="flex-1 overflow-y-auto p-2 text-[11px]">
        <Show when={activeTab() === 'links'}>
          <div class="text-[var(--text-3)] text-[10px] uppercase tracking-widest mb-1.5">
            出链 ({outLinks().length})
          </div>
          <For each={outLinks()}>
            {(link) => (
              <div class="py-0.5 min-w-0">
                <div
                  class={`flex items-center gap-1 ${link.type === 'wiki' ? 'text-[var(--link)]' : 'text-[var(--link-2)]'}`}
                >
                  <span class="text-(--accent) text-[10px] shrink-0">↗</span>
                  <span class="truncate">{link.label}</span>
                </div>
                <Show when={link.label !== link.target}>
                  <div class="text-[var(--text-4)] text-[9px] truncate pl-4 mt-0.5">
                    {link.target}
                  </div>
                </Show>
              </div>
            )}
          </For>
          <div class="text-[var(--text-3)] text-[10px] uppercase tracking-widest mt-3 mb-1.5">
            入链 ({backlinks().length})
          </div>
          <For each={backlinks()}>
            {(link) => (
              <div class="text-[var(--link-2)] py-0.5 flex items-center gap-1">
                <span class="text-(--accent) text-[10px]">↙</span> {link}
              </div>
            )}
          </For>
          <Show when={outLinks().length === 0 && backlinks().length === 0}>
            <div class="text-[var(--text-4)] italic mt-1">暂无链接</div>
          </Show>
        </Show>
        <Show when={activeTab() === 'outline'}>
          <For each={outline()}>
            {(h) => (
              <div
                class="py-0.5 text-[var(--text-2)] hover:text-(--accent) cursor-pointer truncate transition-colors leading-snug"
                style={{
                  'padding-left': `${(h.level - 1) * 10 + 2}px`,
                  'font-size': h.level === 1 ? '12px' : '11px',
                  'font-weight': h.level === 1 ? '500' : '400',
                }}
                onClick={() => jumpToHeading(h.from)}
                title={h.text}
              >
                <span
                  class="text-[var(--text-4)] mr-1"
                  style={{ 'font-size': '9px' }}
                >
                  {'H' + h.level}
                </span>
                {h.text}
              </div>
            )}
          </For>
          <Show when={outline().length === 0}>
            <div class="text-[var(--text-4)] italic">暂无标题</div>
          </Show>
        </Show>
        <Show when={activeTab() === 'tags'}>
          <div class="flex flex-wrap gap-1.5 mt-1">
            <For each={tags()}>
              {(tag) => (
                <span class="bg-(--accent-bg) border border-(--accent-bg) text-[var(--link-2)] text-[10px] px-2 py-0.5 rounded-full">
                  #{tag}
                </span>
              )}
            </For>
          </div>
          <Show when={tags().length === 0}>
            <div class="text-[var(--text-4)] italic mt-1">暂无标签</div>
          </Show>
        </Show>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update `StatusBar.tsx`**

```tsx
// src/components/StatusBar.tsx
import { createMemo, Show } from 'solid-js'
import { globalStore } from '../stores/globalStore'
import { runtimeStore } from '../stores/runtimeStore'
import { parseFrontmatter } from '../lib/parseFrontmatter'

export function StatusBar() {
  const activeRuntime = createMemo(() => {
    const id = globalStore.workspace.activeLeafId
    return id ? (runtimeStore.leafInstances[id] ?? null) : null
  })

  const stats = createMemo(() => {
    const text = activeRuntime()?.cmView?.state.doc.toString() ?? ''
    const { body } = parseFrontmatter(text)
    const words = body.trim() ? body.trim().split(/\s+/).length : 0
    const lines = activeRuntime()?.cmView?.state.doc.lines ?? 0
    return { words, lines }
  })

  return (
    <div class="h-6 bg-[var(--bg-base)] border-t border-(--border)] px-3 flex items-center gap-4 text-[10px] text-[var(--text-4)] shrink-0">
      <span>{stats().words} 字</span>
      <span>{stats().lines} 行</span>
      <div class="flex-1" />
      <Show when={globalStore.knowledge.isIndexing}>
        <span class="flex items-center gap-1 text-[var(--text-3)]">
          <span class="inline-block w-1.5 h-1.5 rounded-full bg-(--accent) animate-pulse" />
          后台检测中
        </span>
      </Show>
      <span class={activeRuntime()?.isDirty ? 'text-(--accent)' : ''}>
        {activeRuntime()?.isDirty ? '未保存' : '已保存'}
      </span>
    </div>
  )
}
```

- [ ] **Step 3: Update `Settings.tsx`** — replace all `uiStore`/`setUIStore` references with `globalStore` + `appActions`

Open `src/components/Settings.tsx`. Make these substitutions:

- `import { uiStore, setUIStore } from '../stores/uiStore'` → `import { globalStore } from '../stores/globalStore'; import { appActions } from '../actions/appActions'`
- `uiStore.theme` → `globalStore.workspace.theme`
- `setUIStore('theme', v)` → `appActions.setTheme(v)`
- `uiStore.customCSS` → `globalStore.workspace.customCSS`
- `setUIStore('customCSS', v)` → `appActions.setCustomCSS(v)`
- `uiStore.autoTimestamps` → `globalStore.workspace.autoTimestamps`
- `setUIStore('autoTimestamps', v)` → `appActions.setAutoTimestamps(v)`
- `uiStore.showOtherFiles` → `globalStore.workspace.showOtherFiles`
- `setUIStore('showOtherFiles', v)` → `appActions.setShowOtherFiles(v)`
- `setUIStore('showSettings', false)` → `appActions.toggleSettings()`

- [ ] **Step 4: Run TypeScript check**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | head -40
```

Expected: only errors referencing the old store/service files that haven't been deleted yet. Zero errors from the new files.

- [ ] **Step 5: Commit**

```bash
git add src/components/RightPanel.tsx src/components/StatusBar.tsx src/components/Settings.tsx
git commit -m "feat: update RightPanel, StatusBar, Settings to use globalStore and runtimeStore"
```

---

## Task 16: Delete old files and verify

**Files:**

- Delete: `src/stores/fileSystemStore.ts`
- Delete: `src/stores/knowledgeStore.ts`
- Delete: `src/stores/uiStore.ts`
- Delete: `src/stores/editorStore.ts`
- Delete: `src/services/fileSystemService.ts`
- Delete: `src/services/knowledgeService.ts`
- Delete: `src/services/workspaceService.ts`
- Delete: `src/components/TabBar.tsx`
- Delete: `src/components/ContentPane.tsx`

- [ ] **Step 1: Delete old store files**

```bash
rm src/stores/fileSystemStore.ts src/stores/knowledgeStore.ts src/stores/uiStore.ts src/stores/editorStore.ts
```

- [ ] **Step 2: Delete old service files**

```bash
rm src/services/fileSystemService.ts src/services/knowledgeService.ts src/services/workspaceService.ts
```

- [ ] **Step 3: Delete replaced UI files**

```bash
rm src/components/TabBar.tsx src/components/ContentPane.tsx
```

- [ ] **Step 4: Full TypeScript check — expect zero errors**

```bash
npx tsc --noEmit --skipLibCheck 2>&1
```

Expected: no output (zero errors). If errors appear, fix imports in the listed files before proceeding.

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass. The `knowledgeService.test.ts` now imports from `lib/knowledgeUtils` (updated in Task 3) — still green.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "refactor: delete old stores and services, complete globalStore migration"
```

---

## Self-Review Checklist

**Spec coverage:**

- ✅ `globalStore` with `fs`, `knowledge`, `workspace` namespaces — Task 1+2
- ✅ `runtimeStore` with `rootHandle` + `leafInstances` — Task 2
- ✅ `WorkspaceSplit` / `WorkspaceTabs` / `WorkspaceLeaf` types — Task 1
- ✅ `SidebarSplit` with `width` + `collapsed` — Task 1
- ✅ `workspaceActions` managing layout tree only (no `openFile`) — Task 6
- ✅ `pinned` as a property of `WorkspaceLeaf` — Task 1
- ✅ DOM caching: all leaves mounted, only active displayed — Task 9
- ✅ Sidebar `collapsed`/`width` drives CSS — Task 9 (`SidebarRenderer`)
- ✅ `fsActions`, `knowledgeActions`, `appActions` — Tasks 4,5,7
- ✅ Components read `globalStore`/`runtimeStore`, call actions — Tasks 10–15

**Type consistency:**

- `ViewComponentProps` (`{ leafId, isActive, viewState }`) defined in Task 1, used in Tasks 8, 11, 12
- `ROOT_TABS_ID` defined in Task 2 (`globalStore.ts`), imported in Tasks 6, 13
- `workspaceActions.clearAllLeaves()` defined in Task 6, called in Task 5 (`fsActions.openDirectory`)
- `workspaceActions.renameLeafPath()` defined in Task 6, called in Task 5 (`fsActions.renameFile`)
- `knowledgeActions._applyFileMeta()` defined in Task 4, called internally by `reindexFile`
