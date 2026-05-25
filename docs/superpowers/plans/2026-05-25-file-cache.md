# fileCache + fileMap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入 `fileMap`（扁平文件表）替换递归 `fs.tree`，通过 `file-stat-cache`（size+mtime）在第二次加载时跳过未变化文件的内容读取，并将扫描/索引职责全部移入 `indexService`。

**Architecture:** `fileCacheService` 新增 IDB `file-stat-cache` store（path→{size,mtime,hash}），启动时一次性加载为局部 Map 与当前 stat 比对，未变化文件跳过 `readFile`；`globalStore.fs` 改为扁平 `fileMap: Record<string, FileMapEntry>`，FilePanel 从 `parent` 字段重建层级；`appActions` 接管 vault 打开/恢复，`fsActions` 只保留文件增删改并直接操作 fileMap 条目。

**Tech Stack:** SolidJS store (`solid-js/store`)、IndexedDB via `idb-keyval`、File System Access API、vitest

---

## 文件变更地图

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/stores/types.ts` | 修改 | 新增 `FileMapEntry`，`FsState.tree→fileMap` |
| `src/stores/globalStore.ts` | 修改 | 初始状态 `fs.fileMap:{}` |
| `src/services/fileCacheService.ts` | 修改 | 新增 IDB file-stat-cache 函数；`writeFile` 末尾调 `deleteFileStatEntry` |
| `src/services/indexService.ts` | 重写 | `buildFileMap`、`scanAndIndex`、`rescanTree`，删除旧 `buildTree`/`startIndexing` |
| `src/actions/appActions.ts` | 修改 | 新增 `openVault`/`restoreVault` |
| `src/actions/fsActions.ts` | 修改 | 删除 `readFile`/`writeFile`/`loadFileContent`/`openDirectory`/`restoreDirectory`；文件操作改为直接增删 fileMap 条目 |
| `src/App.tsx` | 修改 | `fsActions.restoreDirectory` → `appActions.restoreVault` |
| `src/components/panels/FilesPanel.tsx` | 修改 | `FileTreeNode` 改用 `FileMapEntry`，顶层渲染改用 `fileMap`，按钮改 `appActions.openVault` |
| `src/lib/embedExtension.ts` | 修改 | `searchTree(fs.tree)` → fileMap 查找 |
| `src/components/EditorPane.tsx` | 修改 | `fsActions.writeFile` → fileCacheService `writeFile`；`fsActions.loadFileContent` → 内联逻辑；删除 `startIndexing` 调用 |
| `src/services/__tests__/fileCacheService.test.ts` | 新建 | file-stat-cache 函数单元测试 |

---

## Task 1: 新增 FileMapEntry 类型（`types.ts`）

**Files:**
- Modify: `src/stores/types.ts`

- [ ] **Step 1: 在 types.ts 的文件系统区块中新增 FileMapEntry，同时更新 FsState**

打开 `src/stores/types.ts`，将文件系统区块改为：

```ts
// ── File system ─────────────────────────────────────────────────────────────

export interface FileMapEntry {
  name: string
  path: string
  kind: 'file' | 'directory'
  parent: string | null   // 根目录条目为 null
  size?: number           // 文件节点有值
  mtime?: number          // File.lastModified
}

export interface FsState {
  fileMap: Record<string, FileMapEntry>
}
```

删除原有的 `FileNode` interface 和 `FsState { tree: FileNode[] }`。

- [ ] **Step 2: 确认类型文件无语法错误**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1 | head -40
```

此时会有编译错误（其他文件还引用 FileNode/fs.tree），属于预期——后续任务逐步修复。记录错误数量即可，不需要全部通过。

- [ ] **Step 3: Commit**

```bash
git add src/stores/types.ts
git commit -m "refactor(types): replace FileNode tree with flat FileMapEntry + update FsState"
```

---

## Task 2: fileCacheService — 新增 file-stat-cache IDB 函数

**Files:**
- Modify: `src/services/fileCacheService.ts`
- Create: `src/services/__tests__/fileCacheService.test.ts`

- [ ] **Step 1: 写测试文件（先写失败测试）**

新建 `src/services/__tests__/fileCacheService.test.ts`：

```ts
import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockStatStore = {}
const mockKeys = vi.fn()
const mockGetMany = vi.fn()
const mockSet = vi.fn()
const mockDel = vi.fn()

vi.mock('idb-keyval', () => ({
  createStore: vi.fn(() => mockStatStore),
  get: vi.fn(),
  set: mockSet,
  del: mockDel,
  keys: mockKeys,
  getMany: mockGetMany,
}))

vi.mock('../../stores/runtimeStore', () => ({
  runtimeStore: { rootHandle: null },
}))

// 动态导入，确保 mock 先于模块初始化
const { loadAllFileStats, setFileStatEntry, deleteFileStatEntry, pruneFileStatCache } =
  await import('../fileCacheService')

describe('file-stat-cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loadAllFileStats 返回空 Map 当 IDB 为空', async () => {
    mockKeys.mockResolvedValue([])
    mockGetMany.mockResolvedValue([])
    const result = await loadAllFileStats()
    expect(result.size).toBe(0)
  })

  it('loadAllFileStats 将 IDB 条目加载到 Map', async () => {
    mockKeys.mockResolvedValue(['a.md', 'b.md'])
    mockGetMany.mockResolvedValue([
      { size: 100, mtime: 1000, hash: 'abc' },
      { size: 200, mtime: 2000, hash: 'def' },
    ])
    const result = await loadAllFileStats()
    expect(result.get('a.md')).toEqual({ size: 100, mtime: 1000, hash: 'abc' })
    expect(result.get('b.md')).toEqual({ size: 200, mtime: 2000, hash: 'def' })
  })

  it('loadAllFileStats 出错时返回空 Map', async () => {
    mockKeys.mockRejectedValue(new Error('IDB error'))
    const result = await loadAllFileStats()
    expect(result.size).toBe(0)
  })

  it('setFileStatEntry 写入 IDB', async () => {
    mockSet.mockResolvedValue(undefined)
    await setFileStatEntry('note.md', { size: 512, mtime: 9999, hash: 'xyz' })
    expect(mockSet).toHaveBeenCalledWith(
      'note.md',
      { size: 512, mtime: 9999, hash: 'xyz' },
      mockStatStore,
    )
  })

  it('deleteFileStatEntry 从 IDB 删除', async () => {
    mockDel.mockResolvedValue(undefined)
    await deleteFileStatEntry('note.md')
    expect(mockDel).toHaveBeenCalledWith('note.md', mockStatStore)
  })

  it('pruneFileStatCache 删除不在 activePaths 的条目', async () => {
    mockKeys.mockResolvedValue(['a.md', 'b.md', 'c.md'])
    mockDel.mockResolvedValue(undefined)
    await pruneFileStatCache(new Set(['a.md']))
    expect(mockDel).toHaveBeenCalledWith('b.md', mockStatStore)
    expect(mockDel).toHaveBeenCalledWith('c.md', mockStatStore)
    expect(mockDel).not.toHaveBeenCalledWith('a.md', mockStatStore)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run src/services/__tests__/fileCacheService.test.ts 2>&1
```

预期：FAIL，函数未导出。

- [ ] **Step 3: 在 fileCacheService.ts 新增 file-stat-cache store 和四个函数**

打开 `src/services/fileCacheService.ts`，在 import 行追加 `getMany`：

```ts
import { get, set, del, keys, getMany, createStore } from 'idb-keyval'
```

在已有的 `idbStore` 定义后添加第二个 store 及新函数：

```ts
const fileStatStore = createStore('symbol-notes', 'file-stat-cache')

export interface FileStatEntry {
  size: number
  mtime: number
  hash: string
}

export async function loadAllFileStats(): Promise<Map<string, FileStatEntry>> {
  try {
    const allKeys = await keys<string>(fileStatStore)
    const values = await getMany<FileStatEntry>(allKeys, fileStatStore)
    const map = new Map<string, FileStatEntry>()
    for (let i = 0; i < allKeys.length; i++) {
      if (values[i] !== undefined) map.set(allKeys[i], values[i])
    }
    return map
  } catch {
    return new Map()
  }
}

export async function setFileStatEntry(path: string, entry: FileStatEntry): Promise<void> {
  try {
    await set(path, entry, fileStatStore)
  } catch { /* non-fatal */ }
}

export async function deleteFileStatEntry(path: string): Promise<void> {
  try {
    await del(path, fileStatStore)
  } catch { /* non-fatal */ }
}

export async function pruneFileStatCache(activePaths: Set<string>): Promise<void> {
  try {
    const allKeys = await keys<string>(fileStatStore)
    await Promise.all(
      allKeys.filter(k => !activePaths.has(k)).map(k => del(k, fileStatStore)),
    )
  } catch { /* non-fatal */ }
}
```

- [ ] **Step 4: 在 writeFile 末尾调用 deleteFileStatEntry**

找到现有 `writeFile` 函数，在 `contentCache.set(path, content)` 之后加一行：

```ts
export async function writeFile(path: string, content: string, create = false): Promise<void> {
  const handle = await resolveFileHandle(path, create)
  const writable = await handle.createWritable()
  await writable.write(content)
  await writable.close()
  contentCache.set(path, content)
  deleteFileStatEntry(path).catch(() => {})
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run src/services/__tests__/fileCacheService.test.ts 2>&1
```

预期：所有测试 PASS。

- [ ] **Step 6: Commit**

```bash
git add src/services/fileCacheService.ts src/services/__tests__/fileCacheService.test.ts
git commit -m "feat(cache): add file-stat-cache IDB store — loadAllFileStats/setFileStatEntry/deleteFileStatEntry/pruneFileStatCache"
```

---

## Task 3: appActions — 新增 openVault / restoreVault

**Files:**
- Modify: `src/actions/appActions.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: 在 appActions.ts 新增 openVault 和 restoreVault**

打开 `src/actions/appActions.ts`，在顶部添加 import：

```ts
import { get, set } from 'idb-keyval'
import { setRuntimeStore } from '../stores/runtimeStore'
import { clearContentCache } from '../services/fileCacheService'
import { clearEmbedUrlCache } from '../lib/embedExtension'
```

在 `appActions` 对象中添加两个方法（放在现有方法之前）：

```ts
async openVault(): Promise<void> {
  clearEmbedUrlCache()
  clearContentCache()
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
  await set('rootHandle', handle)
  setRuntimeStore('rootHandle', handle)
  const { workspaceActions } = await import('./workspaceActions')
  workspaceActions.clearAllLeaves()
  // scanAndIndex 由 indexService 在此后调用
  const { scanAndIndex } = await import('../services/indexService')
  await scanAndIndex()
},

async restoreVault(): Promise<void> {
  const handle = await get<FileSystemDirectoryHandle>('rootHandle')
  if (!handle) return
  try {
    const perm = await handle.requestPermission({ mode: 'readwrite' })
    if (perm !== 'granted') return
    clearContentCache()
    setRuntimeStore('rootHandle', handle)
    const { scanAndIndex } = await import('../services/indexService')
    await scanAndIndex()
  } catch { /* handle invalidated */ }
},
```

- [ ] **Step 2: 更新 App.tsx — 用 appActions.restoreVault 替换 fsActions.restoreDirectory**

打开 `src/App.tsx`，找到：

```ts
await fsActions.restoreDirectory()
```

替换为：

```ts
await appActions.restoreVault()
```

同时在 import 中加入 `appActions`，移除对 `fsActions` 的 import（如果 App.tsx 只用了这一处）：

```ts
import { appActions } from './actions/appActions'
```

- [ ] **Step 3: 检查 App.tsx 是否还有其他 fsActions 引用**

```bash
grep -n "fsActions" /home/huxzhi/4-code/symbol-notes/src/App.tsx
```

预期：无输出（已全部替换）。

- [ ] **Step 4: Commit**

```bash
git add src/actions/appActions.ts src/App.tsx
git commit -m "feat(app): move openVault/restoreVault to appActions, decouple startup from fsActions"
```

---

## Task 4: 重写 indexService — buildFileMap + scanAndIndex + rescanTree

**Files:**
- Modify: `src/services/indexService.ts`
- Modify: `src/stores/globalStore.ts`

- [ ] **Step 1: 更新 globalStore.ts 初始状态**

打开 `src/stores/globalStore.ts`，将：

```ts
const [globalStore, setGlobalStore] = createStore<GlobalState>({
  fs: { tree: [] },
```

改为：

```ts
const [globalStore, setGlobalStore] = createStore<GlobalState>({
  fs: { fileMap: {} },
```

- [ ] **Step 2: 完整重写 indexService.ts**

用以下内容替换 `src/services/indexService.ts` 的全部内容：

```ts
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { batch } from 'solid-js'
import { globalStore, setGlobalStore } from '../stores/globalStore'
import { runtimeStore } from '../stores/runtimeStore'
import { parseFrontmatter } from '../lib/parseFrontmatter'
import { wikiLinkParser } from '../lib/wikiLinkParser'
import { outLinksField } from '../lib/outLinksField'
import { inlineTagsField } from '../lib/inlineTagsField'
import {
  hashContent, getCachedMeta, setCachedMeta, pruneCache,
  readFile, loadAllFileStats, setFileStatEntry, pruneFileStatCache,
} from './fileCacheService'
import {
  extractTags, extractAliases, mergeTagsWithBody, buildBacklinkMap, buildTagMap,
} from '../lib/knowledgeUtils'
import type { FileMapEntry } from '../stores/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function createHeadlessState(content: string): EditorState {
  return EditorState.create({
    doc: content,
    extensions: [
      markdown({ extensions: [GFM, wikiLinkParser] }),
      outLinksField,
      inlineTagsField,
    ],
  })
}

function idle(): Promise<void> {
  return new Promise(resolve => {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => resolve(), { timeout: 500 })
    } else {
      setTimeout(resolve, 0)
    }
  })
}

// ── buildFileMap ──────────────────────────────────────────────────────────────

interface ScanResult {
  fileMap: Record<string, FileMapEntry>
  unchanged: Map<string, string>   // path → cached hash（stat 命中）
  changed: string[]                // 需要读内容的文件路径
  activePaths: Set<string>
}

async function buildFileMap(
  dirHandle: FileSystemDirectoryHandle,
  idbStats: Map<string, { size: number; mtime: number; hash: string }>,
  parentPath: string | null = null,
  result: ScanResult = {
    fileMap: {},
    unchanged: new Map(),
    changed: [],
    activePaths: new Set(),
  },
): Promise<ScanResult> {
  for await (const [name, handle] of dirHandle.entries()) {
    if (name.startsWith('.')) continue
    const path = parentPath ? `${parentPath}/${name}` : name

    if (handle.kind === 'directory') {
      result.fileMap[path] = { name, path, kind: 'directory', parent: parentPath }
      await buildFileMap(handle as FileSystemDirectoryHandle, idbStats, path, result)
    } else {
      const file = await (handle as FileSystemFileHandle).getFile()
      const size = file.size
      const mtime = file.lastModified
      result.fileMap[path] = { name, path, kind: 'file', parent: parentPath, size, mtime }
      result.activePaths.add(path)

      const cached = idbStats.get(path)
      if (cached && cached.size === size && cached.mtime === mtime) {
        result.unchanged.set(path, cached.hash)
      } else {
        result.changed.push(path)
      }
    }
  }
  return result
}

// ── Session ───────────────────────────────────────────────────────────────────

interface Session { cancelled: boolean }
let currentSession: Session | null = null

async function runPhase1(
  session: Session,
  unchanged: Map<string, string>,
  changed: string[],
  activeHashes: Set<string>,
): Promise<void> {
  // unchanged 文件：直接用缓存 hash 查 metadataCache，不读文件内容
  for (const [path, hash] of unchanged) {
    if (session.cancelled) return
    activeHashes.add(hash)
    const cached = await getCachedMeta(hash)
    if (cached && globalStore.knowledge.index[path]) continue
    if (cached) {
      setGlobalStore('knowledge', 'index', path, { path, ...cached })
    } else {
      // metadataCache miss（罕见）：降级为读内容
      changed.push(path)
    }
  }

  // changed 文件：读内容、解析、更新两级缓存
  for (const path of changed) {
    if (session.cancelled) return
    await idle()
    if (session.cancelled) return

    try {
      const content = await readFile(path)
      const hash = hashContent(content)
      activeHashes.add(hash)

      const entry = globalStore.fs.fileMap[path]
      if (entry?.size !== undefined && entry.mtime !== undefined) {
        await setFileStatEntry(path, { size: entry.size, mtime: entry.mtime, hash })
      }

      const cachedMeta = await getCachedMeta(hash)
      if (cachedMeta) {
        setGlobalStore('knowledge', 'index', path, { path, ...cachedMeta })
        continue
      }

      const state = createHeadlessState(content)
      const { frontmatter } = parseFrontmatter(content)
      const inlineTags = state.field(inlineTagsField).map(m => m.tag)
      const outLinks = state.field(outLinksField)
        .filter(l => l.type === 'wiki')
        .map(l => l.target.endsWith('.md') ? l.target : `${l.target}.md`)

      const parsed = {
        frontmatter,
        outLinks,
        tags: mergeTagsWithBody(extractTags(frontmatter.tags), inlineTags),
        aliases: extractAliases(frontmatter.aliases),
      }
      await setCachedMeta(hash, parsed)
      setGlobalStore('knowledge', 'index', path, { path, ...parsed })
    } catch { /* individual file errors are non-fatal */ }
  }
}

function runPhase2(): void {
  const backlinkMap = buildBacklinkMap(globalStore.knowledge.index)
  const tagMap = buildTagMap(globalStore.knowledge.index)
  setGlobalStore('knowledge', 'backlinkMap', backlinkMap)
  setGlobalStore('knowledge', 'tagMap', tagMap)
}

// ── Public API ────────────────────────────────────────────────────────────────

// 完整扫描 + 索引（vault 打开/恢复时调用）
export async function scanAndIndex(): Promise<void> {
  if (currentSession) currentSession.cancelled = true
  const session: Session = { cancelled: false }
  currentSession = session

  const { rootHandle } = runtimeStore
  if (!rootHandle) return

  setGlobalStore('knowledge', 'isIndexing', true)

  const idbStats = await loadAllFileStats()
  const { fileMap, unchanged, changed, activePaths } = await buildFileMap(rootHandle, idbStats)

  if (session.cancelled) return
  setGlobalStore('fs', 'fileMap', fileMap)

  const mdUnchanged = new Map<string, string>()
  const mdChanged: string[] = []
  for (const [path, hash] of unchanged) {
    if (path.endsWith('.md')) mdUnchanged.set(path, hash)
  }
  for (const path of changed) {
    if (path.endsWith('.md')) mdChanged.push(path)
  }

  const activeHashes = new Set<string>()
  await runPhase1(session, mdUnchanged, mdChanged, activeHashes)

  if (!session.cancelled) {
    runPhase2()
    pruneFileStatCache(activePaths).catch(() => {})
    pruneCache(activeHashes).catch(() => {})
  }

  if (currentSession === session) {
    setGlobalStore('knowledge', 'isIndexing', false)
  }
}

// 轻量重扫：只刷新 fileMap（新建/删除文件已直接操作 fileMap，此函数保留作全量刷新备用）
export async function rescanTree(): Promise<void> {
  const { rootHandle } = runtimeStore
  if (!rootHandle) return
  const idbStats = await loadAllFileStats()
  const { fileMap } = await buildFileMap(rootHandle, idbStats)
  setGlobalStore('fs', 'fileMap', fileMap)
}
```

- [ ] **Step 3: 检查编译错误**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1 | grep "indexService\|globalStore\|types" | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/services/indexService.ts src/stores/globalStore.ts
git commit -m "refactor(index): rewrite indexService with buildFileMap+scanAndIndex, replace fs.tree with fileMap"
```

---

## Task 5: 更新 FilesPanel — 使用 fileMap

**Files:**
- Modify: `src/components/panels/FilesPanel.tsx`

- [ ] **Step 1: 将 FilesPanel.tsx 的 FileTreeNode 改为基于 FileMapEntry**

找到 `FileTreeNode` 函数（当前接受 `FileNode`），完整替换为：

```tsx
function childrenOf(parentPath: string | null): FileMapEntry[] {
  return Object.values(globalStore.fs.fileMap)
    .filter(e => e.parent === parentPath)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

function FileTreeNode(props: { entry: FileMapEntry; depth: number }) {
  const isActive = () => activeFilePath() === props.entry.path
  const isOther = () => props.entry.kind === 'file' && isOtherFile(props.entry.name)
  const show = () =>
    props.entry.kind === 'directory' ||
    !isOtherFile(props.entry.name) ||
    globalStore.workspace.showOtherFiles

  return (
    <Show when={show()}>
      <div>
        <div
          class={`flex items-center gap-1 py-0.5 text-[11px] cursor-pointer hover:bg-(--bg-hover) select-none
            ${
              isActive()
                ? 'bg-(--bg-hover) border-l-2 border-(--accent) text-(--text)'
                : isOther()
                  ? 'text-(--text-4) border-l-2 border-transparent'
                  : 'text-(--text-2) border-l-2 border-transparent'
            }`}
          style={{ 'padding-left': `${6 + props.depth * 14}px` }}
          onClick={() => {
            if (props.entry.kind !== 'file') return
            if (!canOpen(props.entry.name)) return
            openFileInWorkspace(props.entry.path)
          }}
          onDblClick={() => {
            if (props.entry.kind !== 'file') return
            if (!canOpen(props.entry.name)) return
            openFileInWorkspace(props.entry.path, { newTab: true, pin: true })
          }}
        >
          <span class="text-[9px] text-(--text-3)">
            {props.entry.kind === 'directory' ? '▸' : fileIcon(props.entry.name)}
          </span>
          <span class={isActive() ? 'text-(--accent)' : ''}>
            {displayName(props.entry.name)}
          </span>
        </div>
        <Show when={props.entry.kind === 'directory'}>
          <For each={childrenOf(props.entry.path)}>
            {(child) => <FileTreeNode entry={child} depth={props.depth + 1} />}
          </For>
        </Show>
      </div>
    </Show>
  )
}
```

- [ ] **Step 2: 更新顶层 For 循环和 openDirectory 按钮**

找到：
```tsx
<For each={globalStore.fs.tree}>
  {(node) => (
    <FileTreeNode
      node={node}
      depth={0}
    />
  )}
</For>
```

替换为：
```tsx
<For each={childrenOf(null)}>
  {(entry) => <FileTreeNode entry={entry} depth={0} />}
</For>
```

找到：
```tsx
onClick={fsActions.openDirectory}
```

替换为：
```tsx
onClick={() => void appActions.openVault()}
```

- [ ] **Step 3: 更新 import**

在 FilesPanel.tsx 顶部，删除对 `FileNode` 的 import，添加 `FileMapEntry`；添加 `appActions` import；删除不再需要的 `fsActions` import（如果只用了 openDirectory）：

```ts
import { appActions } from '../../actions/appActions'
import type { FileMapEntry, ViewState, WorkspaceLeaf, WorkspaceNode } from '../../stores/types'
```

- [ ] **Step 4: 检查编译**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1 | grep "FilesPanel" | head -10
```

- [ ] **Step 5: Commit**

```bash
git add src/components/panels/FilesPanel.tsx
git commit -m "refactor(FilesPanel): use flat fileMap for rendering, childrenOf() replaces recursive FileNode"
```

---

## Task 6: 更新 embedExtension — 使用 fileMap

**Files:**
- Modify: `src/lib/embedExtension.ts`

- [ ] **Step 1: 替换 searchTree 函数和 resolveEmbedTarget**

打开 `src/lib/embedExtension.ts`，删除：

```ts
function searchTree(nodes: FileNode[], name: string): string | null {
  for (const node of nodes) {
    if (node.kind === 'file' && node.name === name) return node.path
    if (node.kind === 'directory' && node.children) {
      const found = searchTree(node.children, name)
      if (found) return found
    }
  }
  return null
}

function resolveEmbedTarget(target: string): string | null {
  const stem = target.split('/').pop()!
  const hasExt = stem.includes('.')
  const searchName = hasExt ? stem : `${stem}.md`
  return searchTree(globalStore.fs.tree, searchName)
}
```

替换为：

```ts
function resolveEmbedTarget(target: string): string | null {
  const stem = target.split('/').pop()!
  const hasExt = stem.includes('.')
  const searchName = hasExt ? stem : `${stem}.md`
  const entry = Object.values(globalStore.fs.fileMap).find(
    e => e.kind === 'file' && e.name === searchName,
  )
  return entry?.path ?? null
}
```

- [ ] **Step 2: 删除顶部 FileNode import（如果不再使用）**

检查 embedExtension.ts 的 import：

```ts
import type { FileNode } from '../stores/types'
```

删除这行（`FileNode` 已不再使用）。

- [ ] **Step 3: 编译检查**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1 | grep "embedExtension" | head -10
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/embedExtension.ts
git commit -m "refactor(embed): replace recursive searchTree with fileMap O(n) lookup"
```

---

## Task 7: 精简 fsActions — 删除废弃方法，文件操作直接更新 fileMap

**Files:**
- Modify: `src/actions/fsActions.ts`

- [ ] **Step 1: 用以下内容完整替换 fsActions.ts**

```ts
import { produce } from 'solid-js/store'
import { setGlobalStore } from '../stores/globalStore'
import { runtimeStore } from '../stores/runtimeStore'
import { knowledgeActions } from './knowledgeActions'
import {
  readFile, writeFile, invalidateFile, deleteFileStatEntry,
} from '../services/fileCacheService'
import type { FileMapEntry } from '../stores/types'

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceWikiLinks(content: string, oldPath: string, newPath: string): string {
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

async function updateBacklinks(backlinks: string[], oldPath: string, newPath: string): Promise<void> {
  for (const bPath of backlinks) {
    try {
      const content = await readFile(bPath)
      const updated = replaceWikiLinks(content, oldPath, newPath)
      if (updated !== content) {
        await writeFile(bPath, updated)
        knowledgeActions.remapFileLink(bPath, oldPath, newPath)
      }
    } catch { /* skip unreadable files */ }
  }
}

export const fsActions = {
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
    const path = parts.length > 0 ? `${parts.join('/')}/${finalName}` : finalName
    const parent = parts.length > 0 ? parts.join('/') : null
    const entry: FileMapEntry = { name: finalName, path, kind: 'file', parent }
    setGlobalStore('fs', 'fileMap', path, entry)
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
    const dirName = parts[parts.length - 1]
    const parent = parts.length > 1 ? parts.slice(0, -1).join('/') : null
    const entry: FileMapEntry = { name: dirName, path: name, kind: 'directory', parent }
    setGlobalStore('fs', 'fileMap', name, entry)
  },

  async renameFile(oldPath: string, newName: string): Promise<void> {
    const { rootHandle } = runtimeStore
    if (!rootHandle) return
    const dir = oldPath.includes('/')
      ? oldPath.slice(0, oldPath.lastIndexOf('/'))
      : ''
    const finalName = newName.endsWith('.md') ? newName : `${newName}.md`
    const newPath = dir ? `${dir}/${finalName}` : finalName

    const oldContent = await readFile(oldPath)
    await writeFile(newPath, oldContent, true)
    let dirHandle: FileSystemDirectoryHandle = rootHandle
    if (dir) {
      for (const part of dir.split('/')) {
        dirHandle = await dirHandle.getDirectoryHandle(part)
      }
    }
    await dirHandle.removeEntry(oldPath.split('/').pop()!)
    invalidateFile(oldPath)
    await deleteFileStatEntry(oldPath)

    const backlinks = (await import('../stores/globalStore')).globalStore.knowledge.backlinkMap[oldPath] ?? []
    knowledgeActions.removeFileMeta(oldPath)
    setGlobalStore('fs', 'fileMap', produce((m: Record<string, FileMapEntry>) => { delete m[oldPath] }))

    const parent = dir || null
    const entry: FileMapEntry = { name: finalName, path: newPath, kind: 'file', parent }
    setGlobalStore('fs', 'fileMap', newPath, entry)

    const { workspaceActions } = await import('./workspaceActions')
    workspaceActions.renameLeafPath(oldPath, newPath)
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
    invalidateFile(path)
    await deleteFileStatEntry(path)
    knowledgeActions.removeFileMeta(path)
    setGlobalStore('fs', 'fileMap', produce((m: Record<string, FileMapEntry>) => { delete m[path] }))
  },
}
```

- [ ] **Step 2: 检查编译错误**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1 | grep "fsActions" | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src/actions/fsActions.ts
git commit -m "refactor(fsActions): remove readFile/writeFile/openDirectory forwarding; file ops directly update fileMap"
```

---

## Task 8: 更新 EditorPane — 直接使用 fileCacheService

**Files:**
- Modify: `src/components/EditorPane.tsx`

- [ ] **Step 1: 在 EditorPane.tsx 顶部添加 fileCacheService imports**

找到现有 import 块，添加：

```ts
import {
  readFile, writeFile,
} from '../services/fileCacheService'
import { parseFrontmatter, formatTimestamp, setFrontmatterField } from '../lib/parseFrontmatter'
import { globalStore } from '../stores/globalStore'
```

（如果 EditorPane 已经 import 了这些，跳过重复的。）

- [ ] **Step 2: 添加 loadFileContent 内联辅助函数（在组件外部）**

在组件函数定义之前添加：

```ts
async function loadFileContent(path: string): Promise<string> {
  let content = await readFile(path)
  if (globalStore.workspace.autoTimestamps) {
    const { frontmatter } = parseFrontmatter(content)
    const ts = formatTimestamp(Date.now())
    let updated = content
    if (!frontmatter.created) updated = setFrontmatterField(updated, 'created', ts)
    if (!frontmatter.updated) updated = setFrontmatterField(updated, 'updated', ts)
    if (updated !== content) {
      await writeFile(path, updated)
      content = updated
    }
  }
  return content
}
```

- [ ] **Step 3: 替换 fsActions.writeFile 调用**

找到：
```ts
await fsActions.writeFile(p, content)
```

替换为：
```ts
await writeFile(p, content)
```

- [ ] **Step 4: 替换两处 fsActions.loadFileContent 调用**

找到并替换（共 2 处）：
```ts
const doc = await fsActions.loadFileContent(p)
```
→
```ts
const doc = await loadFileContent(p)
```

```ts
const newContent = await fsActions.loadFileContent(p)
```
→
```ts
const newContent = await loadFileContent(p)
```

- [ ] **Step 5: 删除 startIndexing 调用和 import**

找到 `onMount` 中：
```ts
startIndexing(p)
```

删除这行（startup scan 已覆盖所有文件的索引）。

删除 `import { startIndexing } from '../services/indexService'`（如果存在）。

- [ ] **Step 6: 删除 fsActions import（如果 EditorPane 不再使用 fsActions）**

检查 EditorPane.tsx 是否还有其他 fsActions 引用：

```bash
grep -n "fsActions" /home/huxzhi/4-code/symbol-notes/src/components/EditorPane.tsx
```

如果无输出，删除 `import { fsActions } from '../actions/fsActions'` 这行。

- [ ] **Step 7: 全量编译检查**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1
```

预期：0 错误。如有残余 `FileNode`/`fs.tree` 引用，逐一修复。

- [ ] **Step 8: 运行所有测试**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run 2>&1
```

预期：全部 PASS。

- [ ] **Step 9: Commit**

```bash
git add src/components/EditorPane.tsx
git commit -m "refactor(EditorPane): use fileCacheService directly, remove fsActions dependency and startIndexing call"
```

---

## 自我审查（spec 覆盖检查）

| spec 要求 | 覆盖任务 |
|-----------|---------|
| fileMap 替换 fs.tree | Task 1, 4 |
| FileMapEntry 带 size/mtime | Task 1, 4（buildFileMap 填入） |
| IDB file-stat-cache | Task 2 |
| loadAllFileStats 启动一次性加载 | Task 2, 4 |
| stat 比对 unchanged/changed 分组 | Task 4（buildFileMap） |
| unchanged 文件不读内容 | Task 4（runPhase1） |
| changed 文件写入 IDB stat | Task 4（runPhase1） |
| writeFile 末尾 deleteFileStatEntry | Task 2 |
| appActions.openVault/restoreVault | Task 3 |
| App.tsx 用 appActions.restoreVault | Task 3 |
| FilesPanel 使用 fileMap | Task 5 |
| embedExtension 使用 fileMap | Task 6 |
| fsActions 删除转发函数 | Task 7 |
| fsActions 文件操作直接更新 fileMap | Task 7 |
| EditorPane 直接用 fileCacheService | Task 8 |
| EditorPane 删除 startIndexing 调用 | Task 8 |
| pruneFileStatCache | Task 4（scanAndIndex 末尾） |
