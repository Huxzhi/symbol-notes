# Vault / Workspace / FileIO Domain Refactor Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 vault 相关代码合并到 `src/vault/` 目录，让 fileIO 成为 vault 内部实现，明确 workspace 的 openLeaf 申请 leaf API。

**Architecture:** 新建 `src/vault/` 目录包含 io / state / scan / actions / connection / index 六个文件，将原来散落在 `stores/vaultStore`、`services/vaultIndexer`、`stores/runtimeStore`、`services/fileIO` 四处的 vault 相关代码合并为一个内聚域。workspace 新增 `openLeaf(viewState, opts)` 明确"申请 leaf"语义。fileIO 成为 vault 域内部实现，外部通过 `vault/index.ts` 公共 API 访问只读操作。

**Tech Stack:** SolidJS (createSignal, createStore), TypeScript, File System Access API

---

## 文件变更总览

### 新建文件
| 文件 | 职责 |
|------|------|
| `src/vault/io.ts` | FileSystemAdapter 薄封装、内容缓存（原 fileIO.ts） |
| `src/vault/state.ts` | 响应式状态 (vaultStore, vaultFs)、双链/tags/tasks 索引维护 |
| `src/vault/scan.ts` | 全量扫描重建、单文件增量 reindex、isIndexing signal |
| `src/vault/actions.ts` | 文件 CRUD（createFile/deleteFile/renameFile/moveFile/saveFile）|
| `src/vault/connection.ts` | vault 连接（openVault/restoreVault） |
| `src/vault/index.ts` | 公共 API 再导出 |

### 删除文件（任务最后统一删除）
- `src/services/fileIO.ts` → 替换为 `src/vault/io.ts`
- `src/stores/vaultStore.ts` → 替换为 `src/vault/state.ts`
- `src/services/vaultIndexer.ts` → 替换为 `src/vault/scan.ts`
- `src/stores/runtimeStore.ts` → 替换为 `src/vault/actions.ts` + `src/vault/connection.ts`

### 修改文件（导入路径更新）
`src/App.tsx` · `src/components/StatusBar.tsx` · `src/lib/cm6/embedExtension.ts` · `src/lib/pluginRegistry.ts` · `src/plugins/calendar/CalendarPanel.tsx` · `src/plugins/calendar/CalendarViewer.tsx` · `src/plugins/dashboard/DashboardViewer.tsx` · `src/plugins/editor/EditorViewer.tsx` · `src/plugins/editor/ImageViewer.tsx` · `src/plugins/excalidraw/ExcalidrawViewer.tsx` · `src/plugins/files/FilesPanel.tsx` · `src/plugins/search/index.tsx` · `src/plugins/tags/index.tsx` · `src/stores/workspaceStore.ts`

---

## Task 1: 创建 `src/vault/io.ts`

fileIO 的职责：薄封装 FileSystemAdapter，管理内容缓存，提供 read/write/delete/list 原语。外部不再直接引用 `services/fileIO`。

**Files:**
- Create: `src/vault/io.ts`

- [ ] **Step 1: 创建 vault 目录并写入 io.ts**

```ts
// src/vault/io.ts
import { deleteFileStatEntry } from '../services/indexStorage'
import type { FileSystemAdapter } from '../services/fs/types'
export type { DirEntry } from '../services/fs/types'

let _adapter: FileSystemAdapter | null = null
const contentCache = new Map<string, string>()

export function initFileIO(adapter: FileSystemAdapter | null): void {
  _adapter = adapter
  contentCache.clear()
}

export function isReady(): boolean {
  return _adapter !== null
}

function adapter(): FileSystemAdapter {
  if (!_adapter) throw new Error('No file system adapter')
  return _adapter
}

export async function readFile(path: string): Promise<string> {
  const cached = contentCache.get(path)
  if (cached !== undefined) return cached
  const content = await adapter().readText(path)
  contentCache.set(path, content)
  return content
}

export async function writeFile(path: string, content: string): Promise<void> {
  await adapter().writeText(path, content)
  contentCache.set(path, content)
  deleteFileStatEntry(path).catch(() => {})
}

export async function getFileMtime(path: string): Promise<number> {
  return adapter().getMtime(path)
}

export async function getFile(path: string): Promise<File> {
  return adapter().getFile(path)
}

export async function deleteEntry(path: string, opts?: { recursive?: boolean }): Promise<void> {
  await adapter().deleteEntry(path, opts)
  contentCache.delete(path)
  deleteFileStatEntry(path).catch(() => {})
}

export function invalidatePrefix(prefix: string): void {
  for (const key of contentCache.keys()) {
    if (key === prefix || key.startsWith(prefix + '/')) contentCache.delete(key)
  }
}

export async function createDirectory(path: string): Promise<void> {
  return adapter().createDirectory(path)
}

export async function* listAll(): AsyncGenerator<import('../services/fs/types').DirEntry> {
  if (!_adapter) return
  yield* _adapter.listAll()
}

export function invalidateFile(path: string): void {
  contentCache.delete(path)
}
```

- [ ] **Step 2: 类型检查**

```bash
cd /home/huxzhi/4-code/symbol-notes
npx tsc --noEmit 2>&1 | grep "vault/io" | head -10
```

Expected: 无错误（新文件尚未被引用）

- [ ] **Step 3: Commit**

```bash
git add src/vault/io.ts
git commit -m "feat: vault/io.ts — internal fs adapter wrapper (replaces services/fileIO)"
```

---

## Task 2: 创建 `src/vault/state.ts`

vault state 的职责：维护响应式文件元数据（files, backlinkMap, tagMap, taskMap）、vaultFs 连接 signal、双链/tags/tasks 增量更新（applyContent）、reindexFile/remapFileLink/removeVaultEntry。

**Files:**
- Create: `src/vault/state.ts`

- [ ] **Step 1: 写入 state.ts**

```ts
// src/vault/state.ts
import { createSignal } from 'solid-js'
import { createStore } from 'solid-js/store'
import type { FileSystemAdapter } from '../services/fs/types'
import { parseFrontmatter } from '../lib/parseFrontmatter'
import { parseMarkdown } from '../lib/parseMarkdown'
import type { ParseResult } from '../lib/parseMarkdown'
import {
  hashContent, getCachedMeta, setCachedMeta, setFileStatEntry,
} from '../services/indexStorage'
import {
  extractTags, extractAliases, mergeTagsWithBody, extractDateString,
  buildStemIndex, resolveLink,
} from '../lib/knowledgeUtils'
import type { VaultState, FileMeta, TaskItem } from '../stores/types'

// ── Vault connection signal ───────────────────────────────────────────────────

const [_vaultFs, setVaultFs] = createSignal<FileSystemAdapter | null>(null)
export const vaultFs = _vaultFs
export { setVaultFs }

// ── Reactive state ────────────────────────────────────────────────────────────

const [vaultStore, setVaultStore] = createStore<VaultState>({
  files: {},
  backlinkMap: {},
  unresolvedMap: {},
  tagMap: {},
  taskMap: {},
})

export { vaultStore, setVaultStore }

// ── Stem index (lazy cache) ───────────────────────────────────────────────────

type ContentFields = Pick<FileMeta, 'frontmatter' | 'outLinks' | 'tags' | 'aliases' | 'created' | 'updated' | 'dated' | 'tasks'>

let _stemIndex: Map<string, string[]> | null = null

export function invalidateStemIndex(): void {
  _stemIndex = null
}

export function getStemIndex(): Map<string, string[]> {
  if (!_stemIndex) _stemIndex = buildStemIndex(vaultStore.files)
  return _stemIndex
}

// ── Content application ───────────────────────────────────────────────────────

function applyContent(path: string, hash: string, content: ContentFields): void {
  const prev = vaultStore.files[path]
  setVaultStore('files', path, (f: FileMeta) => ({ ...f, hash, ...content }))

  const stemIndex = getStemIndex()

  const prevLinks = new Set(prev?.outLinks ?? [])
  const nextLinks = new Set(content.outLinks)
  for (const t of prevLinks) {
    if (!nextLinks.has(t)) {
      const resolved = resolveLink(t, stemIndex, vaultStore.files)
      if (resolved)
        setVaultStore('backlinkMap', resolved, (list: string[]) => list?.filter(p => p !== path) ?? [])
      else
        setVaultStore('unresolvedMap', t, (list: string[]) => list?.filter(p => p !== path) ?? [])
    }
  }
  for (const t of nextLinks) {
    if (!prevLinks.has(t)) {
      const resolved = resolveLink(t, stemIndex, vaultStore.files)
      if (resolved)
        setVaultStore('backlinkMap', resolved, (list: string[]) => list ? [...list, path] : [path])
      else
        setVaultStore('unresolvedMap', t, (list: string[]) => list ? [...list, path] : [path])
    }
  }

  const prevTags = new Set(prev?.tags ?? [])
  const nextTags = new Set(content.tags)
  for (const t of prevTags) {
    if (!nextTags.has(t))
      setVaultStore('tagMap', t, (list: string[]) => list?.filter(p => p !== path) ?? [])
  }
  for (const t of nextTags) {
    if (!prevTags.has(t))
      setVaultStore('tagMap', t, (list: string[]) => list ? [...list, path] : [path])
  }

  setVaultStore('taskMap', path, content.tasks ?? [])
}

// ── Vault actions ─────────────────────────────────────────────────────────────

export const vaultActions = {
  async reindexFile(path: string, content: string, cmParsed?: ParseResult, persistStat = false): Promise<void> {
    const hash = hashContent(content)
    const cached = await getCachedMeta(hash)
    let fields: ContentFields
    if (cached) {
      fields = cached
    } else {
      const { frontmatter } = parseFrontmatter(content)
      const { outLinks, inlineTags, tasks: rawTasks } = cmParsed ?? parseMarkdown(content)
      const existingMtime = vaultStore.files[path]?.mtime ?? Date.now()
      const created = extractDateString(frontmatter.created)
                   ?? new Date(existingMtime).toISOString().slice(0, 10)
      const updated = extractDateString(frontmatter.updated) ?? null
      const dated = extractDateString(frontmatter.dated) ?? created
      const tasks: TaskItem[] = rawTasks.map(t => ({
        ...t,
        dueDate: t.dueDate ?? dated,
        completedDate: t.checked ? (t.completedDate ?? dated) : null,
      }))
      fields = {
        frontmatter,
        outLinks,
        tags: mergeTagsWithBody(extractTags(frontmatter.tags), inlineTags),
        aliases: extractAliases(frontmatter.aliases),
        created,
        updated,
        dated,
        tasks,
      }
      await setCachedMeta(hash, fields)
    }
    applyContent(path, hash, fields)
    if (persistStat) {
      const entry = vaultStore.files[path]
      if (entry?.kind === 'file') {
        await setFileStatEntry(path, { size: entry.size, mtime: entry.mtime, hash })
      }
    }
  },

  remapFileLink(path: string, oldTarget: string, newTarget: string): void {
    const file = vaultStore.files[path]
    if (!file) return
    const outLinks = file.outLinks.map(l => l === oldTarget ? newTarget : l)
    applyContent(path, file.hash, { ...file, outLinks })
  },

  removeVaultEntry(path: string): void {
    const file = vaultStore.files[path]
    if (!file) return
    const backlinks = vaultStore.backlinkMap[path] ?? []
    if (backlinks.length > 0) {
      setVaultStore('unresolvedMap', path, (list: string[]) => [...(list ?? []), ...backlinks])
      setVaultStore('backlinkMap', path, [])
    }
    const stemIndex = getStemIndex()
    for (const t of file.outLinks) {
      const resolved = resolveLink(t, stemIndex, vaultStore.files)
      if (resolved)
        setVaultStore('backlinkMap', resolved, (list: string[]) => list?.filter(p => p !== path) ?? [])
      else
        setVaultStore('unresolvedMap', t, (list: string[]) => list?.filter(p => p !== path) ?? [])
    }
    for (const t of file.tags)
      setVaultStore('tagMap', t, (list: string[]) => list?.filter(p => p !== path) ?? [])
    setVaultStore('taskMap', path, undefined as unknown as TaskItem[])
    setVaultStore('files', path, undefined as unknown as FileMeta)
    invalidateStemIndex()
  },
}
```

- [ ] **Step 2: 类型检查**

```bash
npx tsc --noEmit 2>&1 | grep "vault/state" | head -10
```

Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/vault/state.ts
git commit -m "feat: vault/state.ts — reactive vault state + content indexing"
```

---

## Task 3: 创建 `src/vault/scan.ts`

scan 的职责：全量扫描（scanAndIndex）、增量重建（reindexFile 委托给 state）、isIndexing signal。

**Files:**
- Create: `src/vault/scan.ts`

- [ ] **Step 1: 写入 scan.ts**

完整内容是将 `src/services/vaultIndexer.ts` 搬过来，修改以下导入路径：

```ts
// src/vault/scan.ts 头部导入区替换为：
import { createSignal } from 'solid-js'
import { vaultStore, setVaultStore } from './state'
import { parseFrontmatter } from '../lib/parseFrontmatter'
import { createMarkdownParser } from '../lib/parseMarkdown'
import { readFile, listAll, isReady } from './io'
import {
  hashContent, getCachedMeta, setCachedMeta, getManyMeta, pruneCache,
  loadAllFileStats, setFileStatEntry, pruneFileStatCache,
} from '../services/indexStorage'
import {
  extractTags, extractAliases, mergeTagsWithBody, buildLinkMaps, buildTagMap,
  extractDateString, extractDateFromName, buildTaskMap,
} from '../lib/knowledgeUtils'
import type { FileMeta, TaskItem } from '../stores/types'

export const [isIndexing, setIsIndexing] = createSignal(false)
```

其余函数体（idle, buildScan, runPhase1, runPhase2, scanAndIndex, rescanTree）与 vaultIndexer.ts 完全相同，无需修改。

- [ ] **Step 2: 类型检查**

```bash
npx tsc --noEmit 2>&1 | grep "vault/scan" | head -10
```

Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/vault/scan.ts
git commit -m "feat: vault/scan.ts — full scan + incremental reindex (from vaultIndexer)"
```

---

## Task 4: 创建 `src/vault/actions.ts`

actions 的职责：所有文件 CRUD（create/delete/rename/move/save），内部调用 io.ts（读写磁盘）和 state.ts（更新索引）。

**Files:**
- Create: `src/vault/actions.ts`

- [ ] **Step 1: 写入 actions.ts**

从 `src/stores/runtimeStore.ts` 搬过来 fileActions 及其内部 helpers，修改导入路径：

```ts
// src/vault/actions.ts
import { produce } from 'solid-js/store'
import { vaultActions, vaultStore, setVaultStore, invalidateStemIndex } from './state'
import {
  initFileIO, isReady, readFile, writeFile, getFileMtime,
  deleteEntry, invalidatePrefix, createDirectory, invalidateFile,
} from './io'
import { deleteFileStatEntry } from '../services/indexStorage'
import type { FileMeta } from '../stores/types'
import type { ParseResult } from '../lib/parseMarkdown'

export { initFileIO, isReady, readFile, getFileMtime, invalidateFile }

// ── Internal helpers ──────────────────────────────────────────────────────────

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

function resolveUnresolved(newPath: string): void {
  const stem = newPath.split('/').pop()!
  const keysToCheck = newPath !== stem ? [newPath, stem] : [newPath]
  for (const key of keysToCheck) {
    const sources = vaultStore.unresolvedMap[key] ?? []
    if (sources.length === 0) continue
    setVaultStore('backlinkMap', newPath, (list: string[]) => [...(list ?? []), ...sources])
    setVaultStore('unresolvedMap', key, [])
  }
}

async function updateBacklinks(oldPath: string, newPath: string): Promise<void> {
  const backlinks = vaultStore.backlinkMap[oldPath] ?? []
  for (const bPath of backlinks) {
    try {
      const content = await readFile(bPath)
      const updated = replaceWikiLinks(content, oldPath, newPath)
      if (updated !== content) {
        await writeFile(bPath, updated)
        vaultActions.remapFileLink(bPath, oldPath, newPath)
      }
    } catch { /* skip unreadable files */ }
  }
}

// ── File actions ──────────────────────────────────────────────────────────────

export const fileActions = {
  readFile(path: string): Promise<string> {
    return readFile(path)
  },

  async saveFile(path: string, content: string, cmParsed?: ParseResult): Promise<void> {
    await writeFile(path, content)
    const mtime = await getFileMtime(path)
    setVaultStore('files', path, 'mtime', mtime)
    await vaultActions.reindexFile(path, content, cmParsed, true)
  },

  async createFile(name: string): Promise<string | null> {
    if (!isReady()) return null
    const parts = name.includes('/') ? name.split('/') : [name]
    const fileName = parts.pop()!
    const finalName = fileName.endsWith('.md') ? fileName : `${fileName}.md`
    if (parts.length > 0) await createDirectory(parts.join('/'))
    const path = parts.length > 0 ? `${parts.join('/')}/${finalName}` : finalName
    await writeFile(path, '')
    const parent = parts.length > 0 ? parts.join('/') : null
    const entry: FileMeta = {
      name: finalName, path, kind: 'file', parent,
      size: 0, mtime: 0, hash: '', frontmatter: {}, outLinks: [], tags: [], aliases: [],
      created: new Date(0).toISOString().slice(0, 10),
      updated: null, dated: new Date(0).toISOString().slice(0, 10), tasks: [],
    }
    setVaultStore('files', path, entry)
    invalidateStemIndex()
    resolveUnresolved(path)
    return path
  },

  async createFolder(name: string): Promise<void> {
    if (!isReady()) return
    await createDirectory(name)
    const parts = name.split('/')
    const dirName = parts[parts.length - 1]
    const parent = parts.length > 1 ? parts.slice(0, -1).join('/') : null
    const entry: FileMeta = {
      name: dirName, path: name, kind: 'directory', parent,
      size: 0, mtime: 0, hash: '', frontmatter: {}, outLinks: [], tags: [], aliases: [],
      created: new Date(0).toISOString().slice(0, 10),
      updated: null, dated: new Date(0).toISOString().slice(0, 10), tasks: [],
    }
    setVaultStore('files', name, entry)
    invalidateStemIndex()
  },

  async renameFile(oldPath: string, newName: string): Promise<void> {
    if (!isReady()) return
    const dir = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : ''
    const finalName = newName.endsWith('.md') ? newName : `${newName}.md`
    const newPath = dir ? `${dir}/${finalName}` : finalName
    if (newPath !== oldPath && vaultStore.files[newPath]) {
      throw new Error(`已存在同名文件：${finalName}`)
    }
    const oldContent = await readFile(oldPath)
    await writeFile(newPath, oldContent)
    await deleteEntry(oldPath)
    await deleteFileStatEntry(oldPath)
    vaultActions.removeVaultEntry(oldPath)
    setVaultStore('files', produce((m: Record<string, FileMeta>) => { delete m[oldPath] }))
    const parent = dir || null
    const entry: FileMeta = {
      name: finalName, path: newPath, kind: 'file', parent,
      size: 0, mtime: 0, hash: '', frontmatter: {}, outLinks: [], tags: [], aliases: [],
      created: new Date(0).toISOString().slice(0, 10),
      updated: null, dated: new Date(0).toISOString().slice(0, 10), tasks: [],
    }
    setVaultStore('files', newPath, entry)
    invalidateStemIndex()
    const { workspaceActions } = await import('../stores/workspaceStore')
    workspaceActions.renameLeafPath(oldPath, newPath)
    await vaultActions.reindexFile(newPath, oldContent)
    await updateBacklinks(oldPath, newPath)
  },

  async deleteFile(path: string): Promise<void> {
    if (!isReady()) return
    await deleteEntry(path)
    await deleteFileStatEntry(path)
    vaultActions.removeVaultEntry(path)
    setVaultStore('files', produce((m: Record<string, FileMeta>) => { delete m[path] }))
    invalidateStemIndex()
  },

  async deleteFolder(path: string): Promise<void> {
    if (!isReady()) return
    const toRemove = Object.values(vaultStore.files).filter(
      e => e.path === path || e.path.startsWith(path + '/'),
    )
    await deleteEntry(path, { recursive: true })
    invalidatePrefix(path)
    for (const entry of toRemove) {
      if (entry.kind === 'file') {
        await deleteFileStatEntry(entry.path)
        vaultActions.removeVaultEntry(entry.path)
      }
    }
    setVaultStore('files', produce((m: Record<string, FileMeta>) => {
      for (const entry of toRemove) delete m[entry.path]
    }))
    invalidateStemIndex()
  },

  async moveFile(srcPath: string, destDirPath: string | null): Promise<void> {
    if (!isReady()) return
    const name = srcPath.split('/').pop()!
    const newPath = destDirPath ? `${destDirPath}/${name}` : name
    if (newPath === srcPath) return
    if (vaultStore.files[newPath]) throw new Error(`目标位置已存在同名文件：${name}`)
    const oldContent = await readFile(srcPath)
    await writeFile(newPath, oldContent)
    await deleteEntry(srcPath)
    await deleteFileStatEntry(srcPath)
    vaultActions.removeVaultEntry(srcPath)
    setVaultStore('files', produce((m: Record<string, FileMeta>) => { delete m[srcPath] }))
    const entry: FileMeta = {
      name, path: newPath, kind: 'file', parent: destDirPath ?? null,
      size: 0, mtime: 0, hash: '', frontmatter: {}, outLinks: [], tags: [], aliases: [],
      created: new Date(0).toISOString().slice(0, 10),
      updated: null, dated: new Date(0).toISOString().slice(0, 10), tasks: [],
    }
    setVaultStore('files', newPath, entry)
    invalidateStemIndex()
    const { workspaceActions } = await import('../stores/workspaceStore')
    workspaceActions.renameLeafPath(srcPath, newPath)
    await vaultActions.reindexFile(newPath, oldContent)
    await updateBacklinks(srcPath, newPath)
  },

  async moveFolder(srcPath: string, destDirPath: string | null): Promise<void> {
    if (!isReady()) return
    const folderName = srcPath.split('/').pop()!
    const newFolderPath = destDirPath ? `${destDirPath}/${folderName}` : folderName
    if (newFolderPath === srcPath || newFolderPath.startsWith(srcPath + '/')) return
    if (vaultStore.files[newFolderPath]) throw new Error(`目标位置已存在同名文件夹：${folderName}`)
    const descendants = Object.values(vaultStore.files).filter(
      e => e.path === srcPath || e.path.startsWith(srcPath + '/'),
    )
    const fileEntries = descendants.filter(e => e.kind === 'file')
    const dirEntries = descendants.filter(e => e.kind === 'directory')
    const allNewDirs = [newFolderPath, ...dirEntries.map(
      e => newFolderPath + e.path.slice(srcPath.length),
    )].sort((a, b) => a.split('/').length - b.split('/').length)
    for (const dirPath of allNewDirs) await createDirectory(dirPath)
    const fileContents = new Map<string, string>()
    for (const entry of fileEntries) {
      const content = await readFile(entry.path)
      fileContents.set(entry.path, content)
      const newFilePath = newFolderPath + entry.path.slice(srcPath.length)
      await writeFile(newFilePath, content)
    }
    await deleteEntry(srcPath, { recursive: true })
    invalidatePrefix(srcPath)
    for (const entry of fileEntries) await deleteFileStatEntry(entry.path)
    setVaultStore('files', produce((m: Record<string, FileMeta>) => {
      for (const entry of descendants) delete m[entry.path]
    }))
    for (const entry of descendants) {
      const newEntryPath = newFolderPath + entry.path.slice(srcPath.length)
      const newParent = newEntryPath.includes('/')
        ? newEntryPath.slice(0, newEntryPath.lastIndexOf('/'))
        : null
      setVaultStore('files', newEntryPath, { ...entry, path: newEntryPath, parent: newParent, hash: '' })
    }
    invalidateStemIndex()
    const { workspaceActions } = await import('../stores/workspaceStore')
    for (const entry of fileEntries) {
      const newFilePath = newFolderPath + entry.path.slice(srcPath.length)
      const content = fileContents.get(entry.path) ?? ''
      workspaceActions.renameLeafPath(entry.path, newFilePath)
      await vaultActions.reindexFile(newFilePath, content)
      await updateBacklinks(entry.path, newFilePath)
    }
  },

  async moveEntry(srcPath: string, destDirPath: string | null): Promise<void> {
    const entry = vaultStore.files[srcPath]
    if (!entry) return
    if (entry.kind === 'directory') {
      await fileActions.moveFolder(srcPath, destDirPath)
    } else {
      await fileActions.moveFile(srcPath, destDirPath)
    }
  },
}
```

- [ ] **Step 2: 类型检查**

```bash
npx tsc --noEmit 2>&1 | grep "vault/actions" | head -10
```

Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/vault/actions.ts
git commit -m "feat: vault/actions.ts — file CRUD (from runtimeStore fileActions)"
```

---

## Task 5: 创建 `src/vault/connection.ts`

connection 的职责：vault 连接生命周期（打开新 vault、恢复上次 vault）。

**Files:**
- Create: `src/vault/connection.ts`

- [ ] **Step 1: 写入 connection.ts**

```ts
// src/vault/connection.ts
import { clearEmbedUrlCache } from '../lib/cm6/embedExtension'
import { LocalAdapter } from '../services/fs/LocalAdapter'
import { initFileIO } from './io'
import { setVaultFs } from './state'

export async function openVault(): Promise<void> {
  clearEmbedUrlCache()
  const adapter = await LocalAdapter.open()
  initFileIO(adapter)
  setVaultFs(adapter)
  const { workspaceActions } = await import('../stores/workspaceStore')
  workspaceActions.clearAllLeaves()
  const { scanAndIndex } = await import('./scan')
  await scanAndIndex()
}

export async function restoreVault(): Promise<void> {
  const adapter = await LocalAdapter.restore()
  if (!adapter) return
  initFileIO(adapter)
  setVaultFs(adapter)
  const { scanAndIndex } = await import('./scan')
  await scanAndIndex()
}
```

- [ ] **Step 2: 类型检查**

```bash
npx tsc --noEmit 2>&1 | grep "vault/connection" | head -10
```

Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/vault/connection.ts
git commit -m "feat: vault/connection.ts — openVault/restoreVault lifecycle"
```

---

## Task 6: 创建 `src/vault/index.ts`

index.ts 的职责：公共 API，所有外部模块只从这里引用 vault 域内容。

**Files:**
- Create: `src/vault/index.ts`

- [ ] **Step 1: 写入 index.ts**

```ts
// src/vault/index.ts
// State & connection signal
export { vaultFs, setVaultFs, vaultStore, setVaultStore, vaultActions, getStemIndex, invalidateStemIndex } from './state'

// Scan
export { isIndexing } from './scan'

// File CRUD
export { fileActions } from './actions'

// Connection lifecycle
export { openVault, restoreVault } from './connection'

// Low-level IO exposed for components that need direct access
// (e.g. EditorViewer conflict detection, ImageViewer, embedExtension)
export { readFile, getFileMtime, invalidateFile, getFile } from './io'
```

- [ ] **Step 2: 类型检查全项目**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: 所有 vault/ 文件零错误（外部旧引用尚未更新，会有错误，是正常的）

- [ ] **Step 3: Commit**

```bash
git add src/vault/index.ts
git commit -m "feat: vault/index.ts — public API for vault domain"
```

---

## Task 7: 更新 lib 和 stores 的导入

**Files:**
- Modify: `src/lib/pluginRegistry.ts`
- Modify: `src/lib/cm6/embedExtension.ts`
- Modify: `src/components/StatusBar.tsx`

- [ ] **Step 1: 更新 pluginRegistry.ts**

```ts
// src/lib/pluginRegistry.ts — 修改导入区
// 删除：
//   import { fileActions } from '../stores/runtimeStore'
//   import { vaultFs } from '../stores/vaultStore'
//   import { vaultStore } from '../stores/vaultStore'
//   import { getStemIndex } from '../stores/vaultStore'
// 添加：
import { fileActions, vaultFs, vaultStore, getStemIndex } from '../vault'
```

- [ ] **Step 2: 更新 embedExtension.ts**

```ts
// src/lib/cm6/embedExtension.ts — 修改导入区
// 删除：
//   import { vaultStore } from '../../stores/vaultStore'
//   import { vaultFs } from '../../stores/vaultStore'
//   import { getFile as fsGetFile } from '../../services/fileIO'
// 添加：
import { vaultStore, vaultFs, getFile as fsGetFile } from '../../vault'
```

- [ ] **Step 3: 更新 StatusBar.tsx**

```ts
// src/components/StatusBar.tsx — 修改导入区
// 删除：import { isIndexing } from '../services/vaultIndexer'
// 添加：import { isIndexing } from '../vault'
```

- [ ] **Step 4: 类型检查**

```bash
npx tsc --noEmit 2>&1 | grep -E "error TS" | grep -v "plugins\|App\." | head -20
```

Expected: lib 和 components 文件夹内无错误

- [ ] **Step 5: 运行测试**

```bash
npx vitest run 2>&1 | tail -5
```

Expected: 124 tests passed

- [ ] **Step 6: Commit**

```bash
git add src/lib/pluginRegistry.ts src/lib/cm6/embedExtension.ts src/components/StatusBar.tsx
git commit -m "refactor: update lib/components imports to use vault domain"
```

---

## Task 8: 更新所有 plugin 文件的导入

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/plugins/calendar/CalendarPanel.tsx`
- Modify: `src/plugins/calendar/CalendarViewer.tsx`
- Modify: `src/plugins/dashboard/DashboardViewer.tsx`
- Modify: `src/plugins/editor/EditorViewer.tsx`
- Modify: `src/plugins/editor/ImageViewer.tsx`
- Modify: `src/plugins/excalidraw/ExcalidrawViewer.tsx`
- Modify: `src/plugins/files/FilesPanel.tsx`
- Modify: `src/plugins/search/index.tsx`
- Modify: `src/plugins/tags/index.tsx`

- [ ] **Step 1: App.tsx**

```ts
// src/App.tsx
// 删除：import { appActions } from './stores/runtimeStore'
// 添加：import { openVault, restoreVault } from './vault'
// 组件内修改：
//   onMount(() => { void appActions.restoreVault() })
// →  onMount(() => { void restoreVault() })
// AppPlugin ribbon onClick 中 appActions.openVault 不存在（App.tsx 不调用 openVault）
// FilesPanel 负责调用 openVault，App.tsx 只调用 restoreVault
```

- [ ] **Step 2: calendar 插件**

```ts
// src/plugins/calendar/CalendarPanel.tsx
// 删除：import { vaultStore } from '../../stores/vaultStore'
// 添加：import { vaultStore } from '../../vault'

// src/plugins/calendar/CalendarViewer.tsx
// 删除：import { vaultStore } from '../../stores/vaultStore'
// 添加：import { vaultStore } from '../../vault'
```

- [ ] **Step 3: DashboardViewer.tsx**

```ts
// src/plugins/dashboard/DashboardViewer.tsx
// 删除：
//   import { readFile } from '../../services/fileIO'
//   import { fileActions } from '../../stores/runtimeStore'
//   import { vaultStore } from '../../stores/vaultStore'
// 添加：
import { readFile, fileActions, vaultStore } from '../../vault'
```

- [ ] **Step 4: EditorViewer.tsx**

```ts
// src/plugins/editor/EditorViewer.tsx
// 删除：
//   import { fileActions } from '../../stores/runtimeStore'
//   import { vaultActions, vaultStore } from '../../stores/vaultStore'
//   import { getStemIndex } from '../../stores/vaultStore'
//   import { readFile, writeFile, getFileMtime, invalidateFile } from '../../services/fileIO'
//   import { vaultFs } from '../../stores/vaultStore'
// 添加：
import { fileActions, vaultActions, vaultStore, getStemIndex, vaultFs, readFile, getFileMtime, invalidateFile } from '../../vault'
// 注意：writeFile 不在 vault/index.ts 中（内部 IO），EditorViewer 不直接写文件，
//       所有保存通过 fileActions.saveFile。如果有剩余的 writeFile 调用，改用 fileActions.saveFile。
```

- [ ] **Step 5: ImageViewer.tsx**

```ts
// src/plugins/editor/ImageViewer.tsx
// 删除：
//   import { vaultFs } from '../../stores/vaultStore'
//   import { getFile } from '../../services/fileIO'
// 添加：
import { vaultFs, getFile } from '../../vault'
```

- [ ] **Step 6: ExcalidrawViewer.tsx**

```ts
// src/plugins/excalidraw/ExcalidrawViewer.tsx
// 删除：
//   import { fileActions } from '../../stores/runtimeStore'
//   import { vaultFs } from '../../stores/vaultStore'
// 添加：
import { fileActions, vaultFs } from '../../vault'
```

- [ ] **Step 7: FilesPanel.tsx**

```ts
// src/plugins/files/FilesPanel.tsx
// 删除：
//   import { appActions, fileActions } from '../../stores/runtimeStore'
//   import { vaultFs } from '../../stores/vaultStore'
//   import { vaultStore } from '../../stores/vaultStore'
// 添加：
import { openVault, fileActions, vaultFs, vaultStore } from '../../vault'
// 代码中 appActions.openVault() → openVault()
```

- [ ] **Step 8: search 和 tags 插件**

```ts
// src/plugins/search/index.tsx
// 删除：import { vaultStore } from '../../stores/vaultStore'
// 添加：import { vaultStore } from '../../vault'

// src/plugins/tags/index.tsx
// 删除：import { vaultStore } from '../../stores/vaultStore'
// 添加：import { vaultStore } from '../../vault'
```

- [ ] **Step 9: 类型检查全项目**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | head -20
```

Expected: 零错误

- [ ] **Step 10: 运行测试**

```bash
npx vitest run 2>&1 | tail -5
```

Expected: 124 tests passed

- [ ] **Step 11: Commit**

```bash
git add src/App.tsx src/plugins/calendar/CalendarPanel.tsx src/plugins/calendar/CalendarViewer.tsx \
  src/plugins/dashboard/DashboardViewer.tsx src/plugins/editor/EditorViewer.tsx \
  src/plugins/editor/ImageViewer.tsx src/plugins/excalidraw/ExcalidrawViewer.tsx \
  src/plugins/files/FilesPanel.tsx src/plugins/search/index.tsx src/plugins/tags/index.tsx
git commit -m "refactor: update all plugin imports to use vault domain"
```

---

## Task 9: 删除旧文件

**Files:**
- Delete: `src/services/fileIO.ts`
- Delete: `src/stores/vaultStore.ts`
- Delete: `src/services/vaultIndexer.ts`
- Delete: `src/stores/runtimeStore.ts`
- Modify: `src/stores/types.ts` — 删除 `RuntimeState` import（如果还在用的话）

- [ ] **Step 1: 删除旧文件**

```bash
rm src/services/fileIO.ts
rm src/stores/vaultStore.ts
rm src/services/vaultIndexer.ts
rm src/stores/runtimeStore.ts
```

- [ ] **Step 2: 检查 types.ts 残留**

```bash
grep -n "runtimeStore\|fileIO\|vaultStore\|vaultIndexer" src/stores/types.ts
```

Expected: 无输出（types.ts 中不应再引用这些文件）

- [ ] **Step 3: 类型检查**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | head -20
```

Expected: 零错误

- [ ] **Step 4: 运行全量测试**

```bash
npx vitest run 2>&1 | tail -6
```

Expected: 13 test files, 124 tests passed

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: delete old scattered vault files (fileIO/vaultStore/vaultIndexer/runtimeStore)"
```

---

## Task 10: Workspace — 添加 `openLeaf` 申请 leaf API

workspace 的职责定义：管理 UI 布局树（leaf/tabs/split）、追踪 active leaf、接受 leaf 申请（openLeaf）并根据 type+state 路由到注册 view。

当前 `openFile` 内部同时做了"解析 view type"和"申请 leaf"两件事。拆分后：
- `openLeaf(viewState, opts)` — 不含文件路径解析，直接按 type+state 申请/切换 leaf（workspace 层）
- `openFile` 内部调用 `openLeaf`（保持向后兼容，不破坏现有调用方）

**Files:**
- Modify: `src/stores/workspaceStore.ts`

- [ ] **Step 1: 在 workspaceActions 中添加 openLeaf，重构 openFile 调用它**

```ts
// src/stores/workspaceStore.ts — 在 openFile 之前插入 openLeaf

  openLeaf(
    viewState: ViewState,
    options?: { area?: 'left' | 'main' | 'right'; newTab?: boolean; pin?: boolean },
  ): void {
    const area = options?.area ?? 'main'
    if (area === 'main') {
      if (!options?.newTab) {
        const layout = activeLayout()
        const activeLeafId = layout.activeLeafId
        const activeLeaf = activeLeafId ? findLeafInTree(activeRoot().main, activeLeafId) : null
        if (activeLeaf && !activeLeaf.pinned && activeLeaf.viewState.type !== 'calendar') {
          workspaceActions.setLeafViewState(activeLeafId!, viewState)
          return
        }
      }
      const leafId = workspaceActions.createLeaf(ROOT_TABS_ID, viewState)
      if (options?.pin) workspaceActions.setLeafPinned(leafId, true)
      return
    }
    const sideChildren = activeRoot()[area].children
    const firstTabs = sideChildren.find(n => n.type === 'tabs') as WorkspaceTabs | undefined
    if (!firstTabs) return
    const leafId = crypto.randomUUID()
    const leaf: WorkspaceLeaf = { type: 'leaf', id: leafId, viewState, pinned: options?.pin ?? false }
    setRoot(
      area, 'children',
      sideChildren.map(node =>
        node === firstTabs
          ? { ...(node as WorkspaceTabs), children: [...(node as WorkspaceTabs).children, leaf], activeLeafId: leafId }
          : node,
      ),
    )
  },

  // 修改 openFile，内部使用 openLeaf
  openFile(
    path: string,
    options?: { area?: 'left' | 'main' | 'right'; newTab?: boolean; pin?: boolean },
  ): void {
    const def = getFileViewForPath(path)
    if (!def) return
    const viewState: ViewState = { type: def.type, state: { file: path } }
    const area = options?.area ?? 'main'

    if (area === 'main') {
      const existing = findLeafWithFile(activeRoot().main, path)
      if (existing && !options?.newTab) { workspaceActions.activateLeaf(existing.id); return }
    } else {
      const sideChildren = activeRoot()[area].children
      const firstTabs = sideChildren.find(n => n.type === 'tabs') as WorkspaceTabs | undefined
      if (!firstTabs) return
      const existing = firstTabs.children.find(l => l.viewState.state.file === path)
      if (existing && !options?.newTab) { workspaceActions.activateSidebarLeaf(area, existing.id); return }
    }

    workspaceActions.openLeaf(viewState, options)
  },
```

- [ ] **Step 2: 导出 openLeaf 类型（确认 pluginRegistry ctx.workspace 类型声明中包含 openLeaf）**

在 `src/lib/pluginRegistry.ts` 的 `PluginContext.workspace` interface 添加：

```ts
/** 直接按 type+state 申请或切换一个 leaf，不经过文件路径解析 */
openLeaf(viewState: { type: string; state: Record<string, unknown> }, opts?: { area?: 'left' | 'main' | 'right'; newTab?: boolean; pin?: boolean }): void
```

并在 `loadPlugin` 的 `ctx.workspace` 实现中添加：

```ts
openLeaf: (viewState, opts) => workspaceActions.openLeaf(viewState, opts),
```

- [ ] **Step 3: 类型检查**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | head -10
```

Expected: 零错误

- [ ] **Step 4: 运行全量测试**

```bash
npx vitest run 2>&1 | tail -5
```

Expected: 124 tests passed

- [ ] **Step 5: Commit**

```bash
git add src/stores/workspaceStore.ts src/lib/pluginRegistry.ts
git commit -m "feat: workspace.openLeaf — explicit leaf request API; openFile now delegates to it"
```

---

## 最终目录结构

```
src/
  vault/
    index.ts        — 公共 API（外部统一从此引入）
    state.ts        — 响应式状态（vaultStore, vaultFs）+ 双链/tags/tasks 维护
    scan.ts         — 全量扫描 + 增量 reindex + isIndexing
    actions.ts      — 文件 CRUD + 内部 helpers
    connection.ts   — openVault / restoreVault
    io.ts           — FileSystemAdapter 薄封装 + 内容缓存（vault 内部）

  stores/
    workspaceStore.ts  — UI 布局 + activeLeaf + openLeaf/openFile
    settingsStore.ts   — 主题、插件开关（不变）
    types.ts           — 共享类型（FileMeta, WorkspaceLayout 等）
    
  services/
    fs/               — LocalAdapter, FileSystemAdapter interface（不变）
    indexStorage.ts   — IDB 缓存（不变）
```

vault 域是完整的知识库服务：外部消费者（插件、组件）通过 `import { ... } from '../../vault'` 获取所有 vault 相关功能，不再分散到 4 个不同文件。
