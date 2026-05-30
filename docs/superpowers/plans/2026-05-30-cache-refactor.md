# Cache & Parser Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate duplicated CM6 parsing logic, fix O(n) taskMap updates, and remove redundant IDB snapshot data from sn-cache.

**Architecture:** Extract a single `parseMarkdown()` utility used by both `indexService` and `cacheStore`. Change `taskMap` from a flat `Task[]` array to `Record<string, TaskItem[]>` keyed by path for O(1) per-file updates. Slim `sn-cache` to store only `files`, rebuilding derived maps (backlinkMap, tagMap, taskMap) in memory on startup.

**Tech Stack:** SolidJS store (solid-js/store), CodeMirror 6 (@codemirror/state, @lezer/markdown), idb-keyval, Vitest

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/lib/parseMarkdown.ts` | Single shared headless CM6 parser, returns `ParseResult` |
| Create | `src/lib/__tests__/parseMarkdown.test.ts` | Tests for parseMarkdown |
| Modify | `src/stores/types.ts` | `CacheState.taskMap: Record<string, TaskItem[]>` |
| Modify | `src/lib/knowledgeUtils.ts` | `buildTaskMap` returns `Record<string, TaskItem[]>` |
| Modify | `src/lib/__tests__/knowledgeUtils.test.ts` | Update buildTaskMap tests |
| Modify | `src/stores/cacheStore.ts` | Use parseMarkdown; fix taskMap ops; slim sn-cache save/load |
| Modify | `src/services/indexService.ts` | Use parseMarkdown; remove createHeadlessState |
| Modify | `src/plugins/calendar/calendarUtils.ts` | buildTaskDayData accepts new taskMap type |

---

## Task 1: Extract shared `parseMarkdown` utility

**Files:**
- Create: `src/lib/parseMarkdown.ts`
- Create: `src/lib/__tests__/parseMarkdown.test.ts`

### What this fixes
`indexService.ts` (`createHeadlessState`) and `cacheStore.ts` (`parseWithCm6`) both create identical headless `EditorState` instances with the same extensions. Any change to the parsing logic must be made in two places.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/__tests__/parseMarkdown.test.ts
import { describe, it, expect } from 'vitest'
import { parseMarkdown } from '../parseMarkdown'

describe('parseMarkdown', () => {
  it('extracts wiki outLinks normalised to .md', () => {
    const result = parseMarkdown('see [[Note A]] and [[sub/Note B]]')
    expect(result.outLinks).toContain('Note A.md')
    expect(result.outLinks).toContain('sub/Note B.md')
  })

  it('does not duplicate .md suffix on links that already have it', () => {
    const result = parseMarkdown('[[Note.md]]')
    expect(result.outLinks).toEqual(['Note.md'])
  })

  it('extracts inline tags', () => {
    const result = parseMarkdown('hello #project/alpha world')
    expect(result.inlineTags).toContain('project/alpha')
  })

  it('extracts unchecked tasks', () => {
    const result = parseMarkdown('- [ ] buy milk')
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0].checked).toBe(false)
    expect(result.tasks[0].cleanText).toBe('buy milk')
  })

  it('extracts checked tasks', () => {
    const result = parseMarkdown('- [x] done')
    expect(result.tasks[0].checked).toBe(true)
  })

  it('returns empty arrays for plain text', () => {
    const result = parseMarkdown('just some text')
    expect(result.outLinks).toEqual([])
    expect(result.inlineTags).toEqual([])
    expect(result.tasks).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/__tests__/parseMarkdown.test.ts
```
Expected: FAIL — `Cannot find module '../parseMarkdown'`

- [ ] **Step 3: Create `src/lib/parseMarkdown.ts`**

```typescript
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { wikiLinkParser } from './wikiLinkParser'
import { outLinksField } from './outLinksField'
import { inlineTagsField } from './inlineTagsField'
import { tasksField } from './tasksField'
import type { TaskItem } from '../stores/types'

export interface ParseResult {
  outLinks: string[]
  inlineTags: string[]
  tasks: TaskItem[]
}

export function parseMarkdown(content: string): ParseResult {
  const state = EditorState.create({
    doc: content,
    extensions: [
      markdown({ extensions: [GFM, wikiLinkParser] }),
      outLinksField,
      inlineTagsField,
      tasksField,
    ],
  })
  return {
    outLinks: state.field(outLinksField)
      .filter(l => l.type === 'wiki')
      .map(l => l.target.endsWith('.md') ? l.target : `${l.target}.md`),
    inlineTags: state.field(inlineTagsField).map(m => m.tag),
    tasks: state.field(tasksField),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/__tests__/parseMarkdown.test.ts
```
Expected: all 6 tests PASS

- [ ] **Step 5: Replace `createHeadlessState` in `indexService.ts`**

Remove lines 1–13 (CM6 imports no longer needed by indexService directly) and the `createHeadlessState` function. Add import and swap usages.

In `src/services/indexService.ts`, replace:
```typescript
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
```
and the `wikiLinkParser`, `outLinksField`, `inlineTagsField`, `tasksField` imports with:
```typescript
import { parseMarkdown } from '../lib/parseMarkdown'
```

Remove the entire `createHeadlessState` function (lines 23–33 in the current file).

In `runPhase1`, replace the block that does:
```typescript
const state = createHeadlessState(content)
const { frontmatter } = parseFrontmatter(content)
const inlineTags = state.field(inlineTagsField).map(m => m.tag)
const outLinks = state.field(outLinksField)
  .filter(l => l.type === 'wiki')
  .map(l => l.target.endsWith('.md') ? l.target : `${l.target}.md`)
```
with:
```typescript
const { frontmatter } = parseFrontmatter(content)
const { outLinks, inlineTags, tasks: rawTaskItems } = parseMarkdown(content)
```

Then replace the tasks extraction:
```typescript
// OLD:
const tasks: TaskItem[] = state.field(tasksField).map(t => ({
  ...t,
  dueDate: t.dueDate ?? dated,
  completedDate: t.checked ? (t.completedDate ?? dated) : null,
}))

// NEW:
const tasks: TaskItem[] = rawTaskItems.map(t => ({
  ...t,
  dueDate: t.dueDate ?? dated,
  completedDate: t.checked ? (t.completedDate ?? dated) : null,
}))
```

- [ ] **Step 6: Replace `parseWithCm6` in `cacheStore.ts` and fix the double-parse bug**

Remove the CM6 imports (`EditorState`, `markdown`, `GFM`, `wikiLinkParser`, `outLinksField`, `inlineTagsField`, `tasksField`) from `cacheStore.ts` and remove the `parseWithCm6` function (lines 45–62).

Add import:
```typescript
import { parseMarkdown } from '../lib/parseMarkdown'
```

In `reindexFile`, replace:
```typescript
// OLD (lines 110–111 — may parse twice if cmParsed is partial):
const { outLinks, inlineTags } = cmParsed ?? parseWithCm6(content)
const rawTasks: TaskItem[] = cmParsed?.tasks ?? parseWithCm6(content).tasks!

// NEW (single parse, no double invocation):
const { outLinks, inlineTags, tasks: rawTasks } = cmParsed ?? parseMarkdown(content)
```

- [ ] **Step 7: Run full test suite**

```bash
npx vitest run
```
Expected: all existing tests pass, no new failures

- [ ] **Step 8: Commit**

```bash
git add src/lib/parseMarkdown.ts src/lib/__tests__/parseMarkdown.test.ts \
        src/services/indexService.ts src/stores/cacheStore.ts
git commit -m "refactor: extract shared parseMarkdown utility, fix double-parse in reindexFile"
```

---

## Task 2: Fix `taskMap` — `Task[]` → `Record<string, TaskItem[]>`

**Files:**
- Modify: `src/stores/types.ts`
- Modify: `src/lib/knowledgeUtils.ts`
- Modify: `src/lib/__tests__/knowledgeUtils.test.ts`
- Modify: `src/stores/cacheStore.ts`
- Modify: `src/plugins/calendar/calendarUtils.ts`

### What this fixes
`applyContent` currently updates `taskMap` with `list.filter(...).concat(...)` — O(n) over all tasks in the vault every time any file is saved. With `Record<string, TaskItem[]>` keyed by file path, the update is a single key assignment: O(1).

- [ ] **Step 1: Update `CacheState` type in `src/stores/types.ts`**

Replace:
```typescript
export interface CacheState {
  files: Record<string, FileMeta>
  backlinkMap: Record<string, string[]>
  tagMap: Record<string, string[]>
  taskMap: Task[]
}
```
with:
```typescript
export interface CacheState {
  files: Record<string, FileMeta>
  backlinkMap: Record<string, string[]>
  tagMap: Record<string, string[]>
  taskMap: Record<string, TaskItem[]>
}
```

- [ ] **Step 2: Update `buildTaskMap` in `src/lib/knowledgeUtils.ts`**

Replace:
```typescript
export function buildTaskMap(
  files: Record<string, { tasks: TaskItem[] }>,
): Task[] {
  const result: Task[] = []
  for (const [path, meta] of Object.entries(files)) {
    for (const t of meta.tasks) {
      result.push({ ...t, path })
    }
  }
  return result
}
```
with:
```typescript
export function buildTaskMap(
  files: Record<string, { tasks: TaskItem[] }>,
): Record<string, TaskItem[]> {
  const result: Record<string, TaskItem[]> = {}
  for (const [path, meta] of Object.entries(files)) {
    if (meta.tasks.length > 0) result[path] = meta.tasks
  }
  return result
}
```

- [ ] **Step 3: Write the failing test for `buildTaskMap`**

In `src/lib/__tests__/knowledgeUtils.test.ts`, add (or replace existing buildTaskMap tests if any):

```typescript
import { buildTaskMap } from '../knowledgeUtils'
import type { TaskItem } from '../../stores/types'

const task1: TaskItem = {
  text: '- [ ] buy milk', cleanText: 'buy milk', checked: false,
  status: ' ', line: 0, dueDate: null, completedDate: null, fields: {},
}
const task2: TaskItem = {
  text: '- [x] done', cleanText: 'done', checked: true,
  status: 'x', line: 1, dueDate: null, completedDate: null, fields: {},
}

describe('buildTaskMap', () => {
  it('keys result by file path', () => {
    const map = buildTaskMap({ 'a.md': { tasks: [task1] }, 'b.md': { tasks: [task2] } })
    expect(map['a.md']).toEqual([task1])
    expect(map['b.md']).toEqual([task2])
  })

  it('omits files with no tasks', () => {
    const map = buildTaskMap({ 'a.md': { tasks: [] }, 'b.md': { tasks: [task1] } })
    expect(Object.keys(map)).toEqual(['b.md'])
  })

  it('returns empty object for empty input', () => {
    expect(buildTaskMap({})).toEqual({})
  })
})
```

- [ ] **Step 4: Run tests to verify buildTaskMap change**

```bash
npx vitest run src/lib/__tests__/knowledgeUtils.test.ts
```
Expected: new buildTaskMap tests pass; other knowledgeUtils tests still pass

- [ ] **Step 5: Update `cacheStore.ts` for new taskMap type**

Change the initial store value:
```typescript
// OLD:
const [cacheStore, setCacheStore] = createStore<CacheState>({
  files: {},
  backlinkMap: {},
  tagMap: {},
  taskMap: [],
})

// NEW:
const [cacheStore, setCacheStore] = createStore<CacheState>({
  files: {},
  backlinkMap: {},
  tagMap: {},
  taskMap: {},
})
```

In `applyContent`, replace the taskMap update:
```typescript
// OLD:
setCacheStore('taskMap', (list: Task[]) => [
  ...list.filter(t => t.path !== path),
  ...(content.tasks ?? []).map(t => ({ ...t, path })),
])

// NEW (O(1) — direct key assignment):
setCacheStore('taskMap', path, content.tasks ?? [])
```

In `removeCacheEntry`, replace:
```typescript
// OLD:
setCacheStore('taskMap', (list: Task[]) => list.filter(t => t.path !== path))

// NEW:
setCacheStore('taskMap', path, undefined as unknown as TaskItem[])
```

Remove the `Task` import from `cacheStore.ts` (it no longer uses the `Task` type directly — only `TaskItem` via `CacheState`).

- [ ] **Step 6: Update `buildTaskDayData` in `src/plugins/calendar/calendarUtils.ts`**

Replace:
```typescript
import type { Task } from '../../stores/types'

export function buildTaskDayData(tasks: Task[]): Record<string, Task[]> {
  const map: Record<string, Task[]> = {}
  for (const task of tasks) {
    if (!task.dueDate) continue
    ;(map[task.dueDate] ??= []).push(task)
  }
  return map
}
```
with:
```typescript
import type { TaskItem } from '../../stores/types'

export type Task = TaskItem & { path: string }

export function buildTaskDayData(taskMap: Record<string, TaskItem[]>): Record<string, Task[]> {
  const map: Record<string, Task[]> = {}
  for (const [path, tasks] of Object.entries(taskMap)) {
    for (const task of tasks) {
      if (!task.dueDate) continue
      ;(map[task.dueDate] ??= []).push({ ...task, path })
    }
  }
  return map
}
```

Note: `CalendarViewer.tsx` already calls `buildTaskDayData(cacheStore.taskMap)` — the call site is unchanged, only the function signature changes.

- [ ] **Step 7: Remove `Task` from `src/stores/types.ts` if no longer needed**

Check if `Task` is still imported anywhere:
```bash
grep -rn "import.*\bTask\b" src --include="*.ts" --include="*.tsx" | grep -v "TaskItem"
```

If only `calendarUtils.ts` used it (and we've moved the type there), remove from `types.ts`:
```typescript
// Remove these lines from types.ts:
export interface Task extends TaskItem {
  path: string
}
```

- [ ] **Step 8: Run full test suite**

```bash
npx vitest run
```
Expected: all tests pass

- [ ] **Step 9: Commit**

```bash
git add src/stores/types.ts src/lib/knowledgeUtils.ts \
        src/lib/__tests__/knowledgeUtils.test.ts \
        src/stores/cacheStore.ts src/plugins/calendar/calendarUtils.ts
git commit -m "refactor: taskMap Record<path,TaskItem[]> for O(1) per-file updates"
```

---

## Task 3: Slim `sn-cache` — store only `files`, rebuild derived maps on init

**Files:**
- Modify: `src/stores/cacheStore.ts`

### What this fixes
Currently `sn-cache` saves the full reactive snapshot: `{ files, backlinkMap, tagMap, taskMap }`. The derived maps (`backlinkMap`, `tagMap`, `taskMap`) are fully computable from `files` in milliseconds. Persisting them wastes IDB write bandwidth on every file edit (500ms debounce). On startup, we load `files` and rebuild the derived maps synchronously in JS before any async IDB reads.

- [ ] **Step 1: Update `initCacheStore` to load only `files` and rebuild derived maps**

Replace the entire `initCacheStore` function:
```typescript
// OLD:
export async function initCacheStore(): Promise<void> {
  const saved = await get<CacheState>('sn-cache')
  if (saved) setCacheStore(reconcile(saved))
}

// NEW:
export async function initCacheStore(): Promise<void> {
  const saved = await get<{ files: Record<string, FileMeta> }>('sn-cache')
  if (!saved?.files) return
  const mdFiles = Object.fromEntries(
    Object.entries(saved.files).filter(([p]) => p.endsWith('.md')),
  )
  setCacheStore(reconcile({
    files: saved.files,
    backlinkMap: buildBacklinkMap(mdFiles),
    tagMap: buildTagMap(mdFiles),
    taskMap: buildTaskMap(mdFiles),
  }))
}
```

Add imports at the top of `cacheStore.ts` (they were previously only in `indexService.ts`):
```typescript
import { buildBacklinkMap, buildTagMap, buildTaskMap } from '../lib/knowledgeUtils'
```

- [ ] **Step 2: Update the save effect to only persist `files`**

Replace:
```typescript
// OLD:
createRoot(() => {
  createEffect(() => {
    const snapshot = JSON.parse(JSON.stringify(cacheStore)) as CacheState
    if (_saveTimer) clearTimeout(_saveTimer)
    _saveTimer = setTimeout(() => set('sn-cache', snapshot), 500)
  })
})

// NEW (only track files, not derived maps):
createRoot(() => {
  createEffect(() => {
    const files = JSON.parse(JSON.stringify(cacheStore.files)) as Record<string, FileMeta>
    if (_saveTimer) clearTimeout(_saveTimer)
    _saveTimer = setTimeout(() => set('sn-cache', { files }), 500)
  })
})
```

This means the reactive effect only re-fires when `cacheStore.files` changes, not when `backlinkMap`/`tagMap`/`taskMap` change. This is correct since the derived maps are rebuilt from `files` on load anyway.

- [ ] **Step 3: Verify startup still works end-to-end**

There is no automated test for startup (requires browser FS API). Instead, manually verify the TypeScript compiles cleanly:

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 4: Run full test suite**

```bash
npx vitest run
```
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/stores/cacheStore.ts
git commit -m "refactor: slim sn-cache to files only, rebuild derived maps on init"
```

---

## Self-Review

### Spec coverage

| Requirement | Task |
|-------------|------|
| Extract shared CM6 parser, remove duplication | Task 1 |
| Fix double-parse bug in `reindexFile` | Task 1 Step 6 |
| `taskMap` O(1) per-file updates | Task 2 |
| Remove derived maps from `sn-cache` | Task 3 |
| Rebuild derived maps on init from files | Task 3 Step 1 |

### Type consistency check

- `parseMarkdown()` returns `ParseResult` → used in Task 1 Step 5 (indexService) and Step 6 (cacheStore) ✓
- `buildTaskMap()` returns `Record<string, TaskItem[]>` → `CacheState.taskMap` is `Record<string, TaskItem[]>` ✓
- `buildTaskDayData(taskMap: Record<string, TaskItem[]>)` → called with `cacheStore.taskMap` which is `Record<string, TaskItem[]>` ✓
- `setCacheStore('taskMap', path, content.tasks ?? [])` — path is `string`, value is `TaskItem[]` ✓
- `removeCacheEntry` sets `taskMap[path]` to `undefined` — this is the SolidJS store pattern for deletion ✓
- `initCacheStore` calls `buildBacklinkMap`, `buildTagMap`, `buildTaskMap` which are now imported in `cacheStore.ts` ✓

### Placeholder scan

No TBD, TODO, or placeholder steps found. All code blocks are complete.
