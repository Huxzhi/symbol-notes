# Vault Domain Split Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 vault 拆分为 4 个语义化文件（scan / backlinks / tags / tasks），state.ts 合并进 index.ts，index.ts 同时承担响应式状态定义和高层编排 API。

**Architecture:** `index.ts` 拥有 vaultStore / vaultFs / getStemIndex / isIndexing 等响应式状态，同时导出 `scanAndIndex` / `reindexFile` / `removeVaultEntry` / `remapFileLink` 四个编排函数。四个领域文件（scan / backlinks / tags / tasks）通过循环导入读写 index.ts 的 store（ESM live bindings，函数体内使用，Vite 正确处理）。外部消费者只从 `vault/index.ts` 导入。

**Tech Stack:** SolidJS (createSignal, createStore), TypeScript, ESM live binding 循环导入

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `vault/index.ts` | store 定义 + 编排 + 所有公共 re-exports（合并原 state.ts） |
| `vault/scan.ts` | FS walk → FileMeta（buildScan）+ 内容解析（runPhase1）+ rescanTree |
| `vault/backlinks.ts` | backlinkMap / unresolvedMap 全量构建 + 增量维护 |
| `vault/tags.ts` | tagMap 全量构建 + 增量维护 |
| `vault/tasks.ts` | taskMap 全量构建 + 增量维护 |
| `vault/actions.ts` | 文件 CRUD（修改导入来源） |
| `vault/connection.ts` | openVault / restoreVault（修改导入来源） |
| ~~`vault/state.ts`~~ | 删除 |

**循环导入说明：** index.ts 导入 scan/backlinks/tags/tasks；这四个文件反向导入 index.ts 的 `vaultStore/setVaultStore/getStemIndex`。只在函数体内使用这些导入（不在模块初始化时调用），Vite ESM live bindings 保证正确性。

---

## Task 1: 创建 `vault/backlinks.ts`

backlinkMap + unresolvedMap 三个操作：全量重建（Phase2）、单文件增量更新、文件删除清理。

**Files:**
- Create: `src/vault/backlinks.ts`

- [ ] **Step 1: 写入 backlinks.ts**

```ts
// src/vault/backlinks.ts
import { resolveLink, buildLinkMaps } from '../lib/knowledgeUtils'
import type { FileMeta } from '../stores/types'
// 循环导入：只在函数体内使用，Vite ESM live bindings 正确处理
import { vaultStore, setVaultStore, getStemIndex } from './index'

/** 全量重建 backlinkMap + unresolvedMap（Phase2 全量扫描后调用） */
export function buildBacklinks(mdFiles: Record<string, FileMeta>): void {
  const { backlinkMap, unresolvedMap } = buildLinkMaps(mdFiles)
  setVaultStore('backlinkMap', backlinkMap)
  setVaultStore('unresolvedMap', unresolvedMap)
}

/** 单文件 outLinks 变化时增量更新 */
export function applyFileBacklinks(
  path: string,
  prevOutLinks: string[],
  nextOutLinks: string[],
): void {
  const stemIndex = getStemIndex()
  const prev = new Set(prevOutLinks)
  const next = new Set(nextOutLinks)
  for (const t of prev) {
    if (!next.has(t)) {
      const r = resolveLink(t, stemIndex, vaultStore.files)
      if (r) setVaultStore('backlinkMap', r, (l: string[]) => l?.filter(p => p !== path) ?? [])
      else setVaultStore('unresolvedMap', t, (l: string[]) => l?.filter(p => p !== path) ?? [])
    }
  }
  for (const t of next) {
    if (!prev.has(t)) {
      const r = resolveLink(t, stemIndex, vaultStore.files)
      if (r) setVaultStore('backlinkMap', r, (l: string[]) => l ? [...l, path] : [path])
      else setVaultStore('unresolvedMap', t, (l: string[]) => l ? [...l, path] : [path])
    }
  }
}

/** 文件删除：将其入链移入 unresolvedMap，清理出链 */
export function removeFileBacklinks(path: string, file: FileMeta): void {
  const backlinks = vaultStore.backlinkMap[path] ?? []
  if (backlinks.length > 0) {
    setVaultStore('unresolvedMap', path, (l: string[]) => [...(l ?? []), ...backlinks])
    setVaultStore('backlinkMap', path, [])
  }
  const stemIndex = getStemIndex()
  for (const t of file.outLinks) {
    const r = resolveLink(t, stemIndex, vaultStore.files)
    if (r) setVaultStore('backlinkMap', r, (l: string[]) => l?.filter(p => p !== path) ?? [])
    else setVaultStore('unresolvedMap', t, (l: string[]) => l?.filter(p => p !== path) ?? [])
  }
}

/** 新文件创建：将原来 unresolvedMap 中指向它的链接移入 backlinkMap */
export function resolveNewFile(newPath: string): void {
  const stem = newPath.split('/').pop()!
  const keysToCheck = newPath !== stem ? [newPath, stem] : [newPath]
  for (const key of keysToCheck) {
    const sources = vaultStore.unresolvedMap[key] ?? []
    if (sources.length === 0) continue
    setVaultStore('backlinkMap', newPath, (list: string[]) => [...(list ?? []), ...sources])
    setVaultStore('unresolvedMap', key, [])
  }
}
```

- [ ] **Step 2: 类型检查**

```bash
cd /home/huxzhi/4-code/symbol-notes
npx tsc --noEmit 2>&1 | grep "vault/backlinks" | head -5
```

Expected: 无错误（新文件暂未被引用）

- [ ] **Step 3: Commit**

```bash
git add src/vault/backlinks.ts
git commit -m "feat: vault/backlinks.ts — backlinkMap domain"
```

---

## Task 2: 创建 `vault/tags.ts`

**Files:**
- Create: `src/vault/tags.ts`

- [ ] **Step 1: 写入 tags.ts**

```ts
// src/vault/tags.ts
import { buildTagMap } from '../lib/knowledgeUtils'
import type { FileMeta } from '../stores/types'
import { vaultStore, setVaultStore } from './index'

/** 全量重建 tagMap */
export function buildTags(mdFiles: Record<string, FileMeta>): void {
  setVaultStore('tagMap', buildTagMap(mdFiles))
}

/** 单文件 tags 变化时增量更新 */
export function applyFileTags(path: string, prevTags: string[], nextTags: string[]): void {
  const prev = new Set(prevTags)
  const next = new Set(nextTags)
  for (const t of prev) {
    if (!next.has(t))
      setVaultStore('tagMap', t, (l: string[]) => l?.filter(p => p !== path) ?? [])
  }
  for (const t of next) {
    if (!prev.has(t))
      setVaultStore('tagMap', t, (l: string[]) => l ? [...l, path] : [path])
  }
}

/** 文件删除：从所有 tag 列表中移除 */
export function removeFileTags(path: string, tags: string[]): void {
  for (const t of tags)
    setVaultStore('tagMap', t, (l: string[]) => l?.filter(p => p !== path) ?? [])
}
```

- [ ] **Step 2: 类型检查 + Commit**

```bash
npx tsc --noEmit 2>&1 | grep "vault/tags" | head -5
git add src/vault/tags.ts
git commit -m "feat: vault/tags.ts — tagMap domain"
```

---

## Task 3: 创建 `vault/tasks.ts`

**Files:**
- Create: `src/vault/tasks.ts`

- [ ] **Step 1: 写入 tasks.ts**

```ts
// src/vault/tasks.ts
import { buildTaskMap } from '../lib/knowledgeUtils'
import type { FileMeta, TaskItem } from '../stores/types'
import { setVaultStore } from './index'

/** 全量重建 taskMap */
export function buildTasks(mdFiles: Record<string, FileMeta>): void {
  setVaultStore('taskMap', buildTaskMap(mdFiles))
}

/** 单文件 tasks 变化时增量更新 */
export function applyFileTasks(path: string, tasks: TaskItem[]): void {
  setVaultStore('taskMap', path, tasks)
}

/** 文件删除：清理 taskMap 条目 */
export function removeFileTasks(path: string): void {
  setVaultStore('taskMap', path, undefined as unknown as TaskItem[])
}
```

- [ ] **Step 2: 类型检查 + Commit**

```bash
npx tsc --noEmit 2>&1 | grep "vault/tasks" | head -5
git add src/vault/tasks.ts
git commit -m "feat: vault/tasks.ts — taskMap domain"
```

---

## Task 4: 精简 `vault/scan.ts`

移除 `isIndexing` / `scanAndIndex` / `runPhase2`（迁移到 index.ts），导出 `buildScan` 和 `runPhase1`，更新 import 路径。

**Files:**
- Modify: `src/vault/scan.ts`

- [ ] **Step 1: 重写 scan.ts**

```ts
// src/vault/scan.ts
// 职责：FS walk → FileMeta（buildScan），内容解析（runPhase1），快速重扫（rescanTree）
// isIndexing / scanAndIndex / runPhase2 已移入 index.ts
import { vaultStore, setVaultStore } from './index'
import { parseFrontmatter } from '../lib/parseFrontmatter'
import { createMarkdownParser } from '../lib/parseMarkdown'
import { readFile, listAll } from './io'
import {
  hashContent, getCachedMeta, setCachedMeta, getManyMeta, setFileStatEntry,
} from '../services/indexStorage'
import {
  extractTags, extractAliases, mergeTagsWithBody, extractDateString, extractDateFromName,
} from '../lib/knowledgeUtils'
import type { FileMeta, TaskItem } from '../stores/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function idle(): Promise<void> {
  return new Promise(resolve => {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => resolve(), { timeout: 500 })
    } else {
      setTimeout(resolve, 0)
    }
  })
}

// ── FS Walk ───────────────────────────────────────────────────────────────────

export interface ScanResult {
  files: Record<string, FileMeta>
  activePaths: Set<string>
}

const EMPTY_CONTENT: Pick<FileMeta, 'frontmatter' | 'outLinks' | 'tags' | 'aliases' | 'updated' | 'tasks'> = {
  frontmatter: {},
  outLinks: [],
  tags: [],
  aliases: [],
  updated: null,
  tasks: [],
}

export async function buildScan(): Promise<ScanResult> {
  const result: ScanResult = { files: {}, activePaths: new Set() }
  const epoch = new Date(0).toISOString().slice(0, 10)
  for await (const entry of listAll()) {
    const { name, path, kind, parent, size, mtime } = entry
    if (kind === 'directory') {
      result.files[path] = {
        name, path, kind: 'directory', parent, size: 0, mtime: 0, hash: '',
        ...EMPTY_CONTENT,
        created: epoch,
        dated: extractDateFromName(name) ?? epoch,
      }
    } else {
      const mtimeStr = new Date(mtime).toISOString().slice(0, 10)
      result.files[path] = {
        name, path, kind: 'file', parent, size, mtime, hash: '',
        ...EMPTY_CONTENT,
        created: mtimeStr,
        dated: extractDateFromName(name) ?? mtimeStr,
      }
      result.activePaths.add(path)
    }
  }
  return result
}

// ── Phase 1: 内容解析，填充 FileMeta hash/frontmatter/outLinks/tags/tasks ────

export async function runPhase1(
  session: { cancelled: boolean },
  unchanged: string[],
  changed: string[],
  activeHashes: Set<string>,
): Promise<void> {
  const parser = createMarkdownParser()
  const hashes = unchanged.map(p => vaultStore.files[p]?.hash ?? '')
  hashes.forEach(h => { if (h) activeHashes.add(h) })

  const metas = await getManyMeta(hashes)
  for (let i = 0; i < unchanged.length; i++) {
    if (session.cancelled) return
    const path = unchanged[i]
    const hash = hashes[i]
    if (!hash) continue
    const meta = metas[i]
    if (meta) {
      setVaultStore('files', path, (f: FileMeta) => ({ ...f, hash, ...meta }))
    } else {
      changed.push(path)
    }
  }

  for (const path of changed) {
    if (session.cancelled) return
    await idle()
    if (session.cancelled) return
    try {
      const content = await readFile(path)
      const hash = hashContent(content)
      activeHashes.add(hash)
      const entry = vaultStore.files[path]
      if (entry) {
        await setFileStatEntry(path, { size: entry.size, mtime: entry.mtime, hash })
      }
      const cachedMeta = await getCachedMeta(hash)
      if (cachedMeta) {
        setVaultStore('files', path, (f: FileMeta) => ({ ...f, hash, ...cachedMeta }))
        continue
      }
      const { frontmatter } = parseFrontmatter(content)
      const { outLinks, inlineTags, tasks: rawTaskItems } = parser.parse(content)
      const created = extractDateString(frontmatter.created)
                   ?? new Date(entry.mtime).toISOString().slice(0, 10)
      const updated = extractDateString(frontmatter.updated) ?? null
      const dated = extractDateString(frontmatter.dated) ?? created
      const tasks: TaskItem[] = rawTaskItems.map(t => ({
        ...t,
        dueDate: t.dueDate ?? dated,
        completedDate: t.checked ? (t.completedDate ?? dated) : null,
      }))
      const parsed = {
        frontmatter,
        outLinks,
        tags: mergeTagsWithBody(extractTags(frontmatter.tags), inlineTags),
        aliases: extractAliases(frontmatter.aliases),
        created, updated, dated, tasks,
      }
      await setCachedMeta(hash, parsed)
      setVaultStore('files', path, (f: FileMeta) => ({ ...f, hash, ...parsed }))
    } catch { /* individual file errors are non-fatal */ }
  }
}

// ── Quick rescan (no parsing) ─────────────────────────────────────────────────

export async function rescanTree(): Promise<void> {
  const { files } = await buildScan()
  setVaultStore('files', files)
}
```

- [ ] **Step 2: 类型检查**

```bash
npx tsc --noEmit 2>&1 | grep "vault/scan" | head -10
```

Expected: 可能有 `isReady` 缺失错误（已从 scan.ts 中移除，index.ts 会提供）。若有其他错误则先修复。

- [ ] **Step 3: Commit**

```bash
git add src/vault/scan.ts
git commit -m "refactor: vault/scan.ts — FS walk + Phase1 only; Phase2/isIndexing/scanAndIndex move to index"
```

---

## Task 5: 重写 `vault/index.ts` — 合并 state.ts + 编排

这是核心任务。index.ts 承担：响应式 store 定义、isIndexing、scanAndIndex / reindexFile / removeVaultEntry / remapFileLink 编排、以及所有 re-exports。

**Files:**
- Modify: `src/vault/index.ts`

- [ ] **Step 1: 完整重写 index.ts**

```ts
// src/vault/index.ts
import { createSignal } from 'solid-js'
import { createStore } from 'solid-js/store'
import type { FileSystemAdapter } from '../services/fs/types'
import { parseFrontmatter } from '../lib/parseFrontmatter'
import { parseMarkdown } from '../lib/parseMarkdown'
import type { ParseResult } from '../lib/parseMarkdown'
import { hashContent, getCachedMeta, setCachedMeta, setFileStatEntry, loadAllFileStats, pruneCache, pruneFileStatCache } from '../services/indexStorage'
import { extractTags, extractAliases, mergeTagsWithBody, extractDateString, buildStemIndex } from '../lib/knowledgeUtils'
import type { VaultState, FileMeta, TaskItem } from '../stores/types'
import { buildScan, runPhase1 } from './scan'
import { buildBacklinks, applyFileBacklinks, removeFileBacklinks, resolveNewFile } from './backlinks'
import { buildTags, applyFileTags, removeFileTags } from './tags'
import { buildTasks, applyFileTasks, removeFileTasks } from './tasks'
import { isReady } from './io'

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

let _stemIndex: Map<string, string[]> | null = null

export function invalidateStemIndex(): void {
  _stemIndex = null
}

export function getStemIndex(): Map<string, string[]> {
  if (!_stemIndex) _stemIndex = buildStemIndex(vaultStore.files)
  return _stemIndex
}

// ── Scan status ───────────────────────────────────────────────────────────────

export const [isIndexing, setIsIndexing] = createSignal(false)

// ── Session management ────────────────────────────────────────────────────────

interface Session { cancelled: boolean }
let currentSession: Session | null = null

// ── High-level orchestration ──────────────────────────────────────────────────

/** 打开 vault 后全量扫描：Phase1 填充 FileMeta → Phase2 重建所有索引 */
export async function scanAndIndex(): Promise<void> {
  if (currentSession) currentSession.cancelled = true
  const session: Session = { cancelled: false }
  currentSession = session

  if (!isReady()) return
  setIsIndexing(true)

  const [{ files, activePaths }, idbStats] = await Promise.all([
    buildScan(),
    loadAllFileStats(),
  ])

  if (session.cancelled) return

  const MAX_PARSE_BYTES = 20 * 1024 * 1024
  const mdUnchanged: string[] = []
  const mdChanged: string[] = []

  for (const [path, file] of Object.entries(files)) {
    if (file.kind !== 'file' || !path.endsWith('.md')) continue
    if (file.size > MAX_PARSE_BYTES) continue
    const stat = idbStats.get(path)
    if (stat && stat.size === file.size && stat.mtime === file.mtime) {
      files[path] = { ...file, hash: stat.hash }
      mdUnchanged.push(path)
    } else {
      mdChanged.push(path)
    }
  }

  setVaultStore('files', files)

  const activeHashes = new Set<string>()
  await runPhase1(session, mdUnchanged, mdChanged, activeHashes)

  if (!session.cancelled) {
    // Phase 2: 从所有已填充的 FileMeta 重建三个索引
    const mdFiles = Object.fromEntries(
      Object.entries(vaultStore.files).filter(([p]) => p.endsWith('.md')),
    )
    buildBacklinks(mdFiles)
    buildTags(mdFiles)
    buildTasks(mdFiles)
    pruneFileStatCache(activePaths).catch(() => {})
    pruneCache(activeHashes).catch(() => {})
  }

  if (currentSession === session) setIsIndexing(false)
}

type ContentFields = Pick<FileMeta, 'frontmatter' | 'outLinks' | 'tags' | 'aliases' | 'created' | 'updated' | 'dated' | 'tasks'>

/** 单文件保存后：解析内容 → 更新 FileMeta → 增量更新三个索引 */
export async function reindexFile(
  path: string,
  content: string,
  cmParsed?: ParseResult,
  persistStat = false,
): Promise<void> {
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
      created, updated, dated, tasks,
    }
    await setCachedMeta(hash, fields)
  }

  const prev = vaultStore.files[path]
  setVaultStore('files', path, (f: FileMeta) => ({ ...f, hash, ...fields }))

  applyFileBacklinks(path, prev?.outLinks ?? [], fields.outLinks)
  applyFileTags(path, prev?.tags ?? [], fields.tags)
  applyFileTasks(path, fields.tasks)

  if (persistStat) {
    const entry = vaultStore.files[path]
    if (entry?.kind === 'file') {
      await setFileStatEntry(path, { size: entry.size, mtime: entry.mtime, hash })
    }
  }
}

/** 文件删除：从 FileMeta 和所有索引中移除 */
export function removeVaultEntry(path: string): void {
  const file = vaultStore.files[path]
  if (!file) return
  removeFileBacklinks(path, file)
  removeFileTags(path, file.tags)
  removeFileTasks(path)
  setVaultStore('files', path, undefined as unknown as FileMeta)
  invalidateStemIndex()
}

/** 文件重命名后更新某文件内对旧路径的 wiki 链接引用 */
export function remapFileLink(filePath: string, oldTarget: string, newTarget: string): void {
  const file = vaultStore.files[filePath]
  if (!file) return
  const prevOutLinks = file.outLinks
  const nextOutLinks = prevOutLinks.map(l => l === oldTarget ? newTarget : l)
  setVaultStore('files', filePath, 'outLinks', nextOutLinks)
  applyFileBacklinks(filePath, prevOutLinks, nextOutLinks)
}

/** 新文件创建：将 unresolvedMap 中指向它的链接解析到 backlinkMap */
export { resolveNewFile }

// ── Re-exports ────────────────────────────────────────────────────────────────

export { fileActions } from './actions'
export { openVault, restoreVault } from './connection'
export { readFile, writeFile, getFileMtime, invalidateFile, getFile } from './io'
```

- [ ] **Step 2: 类型检查**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | head -20
```

Expected: 可能有 `actions.ts` / `connection.ts` 中 `./state` 找不到的错误（Tasks 6-7 会修复）。

- [ ] **Step 3: Commit**

```bash
git add src/vault/index.ts
git commit -m "refactor: vault/index.ts — absorb state.ts + orchestration (scanAndIndex/reindexFile/removeVaultEntry/remapFileLink)"
```

---

## Task 6: 更新 `vault/actions.ts`

将 `./state` 引用改为 `./index`；`vaultActions.reindexFile` → `reindexFile`；`vaultActions.removeVaultEntry` → `removeVaultEntry`；`vaultActions.remapFileLink` → `remapFileLink`；`resolveUnresolved` → `resolveNewFile`。

**Files:**
- Modify: `src/vault/actions.ts`

- [ ] **Step 1: 修改 actions.ts 顶部导入和相关调用**

```ts
// src/vault/actions.ts — 修改第 1-11 行
import { produce } from 'solid-js/store'
import { reindexFile, removeVaultEntry, remapFileLink, resolveNewFile, vaultStore, setVaultStore, invalidateStemIndex } from './index'
import {
  initFileIO, isReady, readFile, writeFile, getFileMtime,
  deleteEntry, invalidatePrefix, createDirectory, invalidateFile,
} from './io'
import { deleteFileStatEntry } from '../services/indexStorage'
import type { FileMeta } from '../stores/types'
import type { ParseResult } from '../lib/parseMarkdown'

export { initFileIO, isReady, readFile, writeFile, getFileMtime, invalidateFile }
```

- [ ] **Step 2: 替换 vaultActions 调用**

在 `fileActions` 对象中：

```ts
// saveFile: 将 vaultActions.reindexFile → reindexFile
async saveFile(path: string, content: string, cmParsed?: ParseResult): Promise<void> {
  await writeFile(path, content)
  const mtime = await getFileMtime(path)
  setVaultStore('files', path, 'mtime', mtime)
  await reindexFile(path, content, cmParsed, true)
},

// createFile: resolveUnresolved → resolveNewFile
async createFile(name: string): Promise<string | null> {
  // ... (逻辑不变，最后替换)
  resolveNewFile(path)  // 原为 resolveUnresolved(path)
  return path
},

// deleteFile: vaultActions.removeVaultEntry → removeVaultEntry
async deleteFile(path: string): Promise<void> {
  if (!isReady()) return
  await deleteEntry(path)
  await deleteFileStatEntry(path)
  removeVaultEntry(path)  // 原为 vaultActions.removeVaultEntry(path)
  setVaultStore('files', produce((m: Record<string, FileMeta>) => { delete m[path] }))
  invalidateStemIndex()
},

// deleteFolder: vaultActions.removeVaultEntry → removeVaultEntry
async deleteFolder(path: string): Promise<void> {
  // ... for 循环中：
  removeVaultEntry(entry.path)  // 原为 vaultActions.removeVaultEntry(entry.path)
},

// renameFile 和 moveFile 中的 updateBacklinks helper 需要更新:
// vaultActions.remapFileLink(bPath, oldPath, newPath) → remapFileLink(bPath, oldPath, newPath)
```

`updateBacklinks` 内部函数修改：
```ts
async function updateBacklinks(oldPath: string, newPath: string): Promise<void> {
  const backlinks = vaultStore.backlinkMap[oldPath] ?? []
  for (const bPath of backlinks) {
    try {
      const content = await readFile(bPath)
      const updated = replaceWikiLinks(content, oldPath, newPath)
      if (updated !== content) {
        await writeFile(bPath, updated)
        remapFileLink(bPath, oldPath, newPath)  // 原为 vaultActions.remapFileLink
      }
    } catch { /* skip unreadable files */ }
  }
}
```

`resolveUnresolved` 函数整体删除（已由 `resolveNewFile` 取代）。

- [ ] **Step 3: 删除 actions.ts 内的 resolveUnresolved 函数（已由 backlinks.ts 的 resolveNewFile 接管）**

删除从 `function resolveUnresolved` 到其结束 `}` 的整个函数体。

- [ ] **Step 4: 类型检查**

```bash
npx tsc --noEmit 2>&1 | grep "vault/actions" | head -10
```

Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add src/vault/actions.ts
git commit -m "refactor: vault/actions.ts — import from index instead of state; drop vaultActions"
```

---

## Task 7: 更新 `vault/connection.ts`

**Files:**
- Modify: `src/vault/connection.ts`

- [ ] **Step 1: 修改 connection.ts**

```ts
// src/vault/connection.ts
import { clearEmbedUrlCache } from '../lib/cm6/embedExtension'
import { LocalAdapter } from '../services/fs/LocalAdapter'
import { initFileIO } from './io'
import { setVaultFs } from './index'  // 原为 './state'

export async function openVault(): Promise<void> {
  clearEmbedUrlCache()
  const adapter = await LocalAdapter.open()
  initFileIO(adapter)
  setVaultFs(adapter)
  const { workspaceActions } = await import('../stores/workspaceStore')
  workspaceActions.clearAllLeaves()
  const { scanAndIndex } = await import('./index')  // 原为 './scan'
  await scanAndIndex()
}

export async function restoreVault(): Promise<void> {
  const adapter = await LocalAdapter.restore()
  if (!adapter) return
  initFileIO(adapter)
  setVaultFs(adapter)
  const { scanAndIndex } = await import('./index')  // 原为 './scan'
  await scanAndIndex()
}
```

- [ ] **Step 2: 类型检查 + Commit**

```bash
npx tsc --noEmit 2>&1 | grep "vault/connection" | head -5
git add src/vault/connection.ts
git commit -m "refactor: vault/connection.ts — import setVaultFs/scanAndIndex from index"
```

---

## Task 8: 更新 EditorViewer + 删除 state.ts

**Files:**
- Modify: `src/plugins/editor/EditorViewer.tsx`
- Delete: `src/vault/state.ts`

- [ ] **Step 1: EditorViewer 替换 vaultActions.reindexFile**

```ts
// src/plugins/editor/EditorViewer.tsx
// 修改导入：去掉 vaultActions，加入 reindexFile
import { fileActions, reindexFile, vaultStore, getStemIndex, vaultFs, readFile, writeFile, getFileMtime, invalidateFile } from '../../vault'

// 代码中 vaultActions.reindexFile(...) → reindexFile(...)
// 原来（约第 130 行附近）：
//   void vaultActions.reindexFile(p, view.state.doc.toString(), { ... })
// 改为：
//   void reindexFile(p, view.state.doc.toString(), { ... })
```

- [ ] **Step 2: 类型检查全项目**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | head -20
```

Expected: 零错误

- [ ] **Step 3: 删除 state.ts**

```bash
rm src/vault/state.ts
```

- [ ] **Step 4: 再次类型检查 + 全量测试**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | head -10
npx vitest run 2>&1 | tail -5
```

Expected: 零 TypeScript 错误，124 tests passed

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: vault domain split complete — scan/backlinks/tags/tasks; state.ts merged into index.ts"
```

---

## 最终 vault/ 结构

```
src/vault/
  index.ts       — store 定义 + isIndexing + scanAndIndex/reindexFile/removeVaultEntry/remapFileLink + re-exports
  scan.ts        — FS walk (buildScan) + 内容解析 (runPhase1) + rescanTree
  backlinks.ts   — buildBacklinks / applyFileBacklinks / removeFileBacklinks / resolveNewFile
  tags.ts        — buildTags / applyFileTags / removeFileTags
  tasks.ts       — buildTasks / applyFileTasks / removeFileTasks
  actions.ts     — 文件 CRUD
  connection.ts  — openVault / restoreVault
  io.ts          — FS 适配器封装
```

外部消费者只从 `import { ... } from '../../vault'` 读写，不直接接触内部 4 个域文件。
