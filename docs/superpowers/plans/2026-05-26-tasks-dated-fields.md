# Tasks Extraction + FileMeta Date Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `- [ ]` task items from markdown files via CM6 syntax tree and mount them to `FileMeta`, while promoting `created`, `updated`, and `dated` as first-class date fields — all cached in IDB and aggregated into `CacheState.taskMap`.

**Architecture:** New `tasksField` CM6 StateField (same pattern as `outLinksField`) extracts `TaskItem[]` from the lezer GFM syntax tree. `indexService` wires it into the bulk scan pipeline; `cacheStore` wires it into the live-save pipeline. Phase 2 builds a flat `taskMap: Task[]` with `path` injected, alongside the existing `backlinkMap`/`tagMap`.

**Tech Stack:** `@codemirror/state` StateField, `@codemirror/language` syntaxTree, `@lezer/markdown` GFM (TaskMarker node), SolidJS store, idb-keyval, vitest.

---

## File Map

| File | Action |
|---|---|
| `src/stores/types.ts` | Add `TaskItem`, `Task`; extend `FileMeta`, `CacheState` |
| `src/services/fileCacheService.ts` | Extend `CachedFields` type |
| `src/lib/knowledgeUtils.ts` | Add `extractDateString`, `extractDateFromName`, `buildTaskMap` |
| `src/lib/tasksField.ts` | **New** — CM6 `StateField<TaskItem[]>` |
| `src/lib/__tests__/tasksField.test.ts` | **New** — headless CM6 tests |
| `src/__tests__/knowledgeService.test.ts` | Extend — tests for new helpers |
| `src/services/indexService.ts` | Wire new fields into bulk scan |
| `src/stores/cacheStore.ts` | Wire new fields into live-save pipeline |
| `src/components/viewer/EditorViewer.tsx` | Pass `tasks` in `CmParsed` |

---

### Task 1: Update types

**Files:**
- Modify: `src/stores/types.ts`
- Modify: `src/services/fileCacheService.ts`

- [ ] **Step 1: Add `TaskItem` and `Task` to types.ts**

Replace the File cache comment block in `src/stores/types.ts` (after line 58):

```typescript
// ── Task items ────────────────────────────────────────────────────────────────

export interface TaskItem {
  text: string                    // raw text after checkbox (includes [key::value])
  cleanText: string               // text with [key::value] removed
  checked: boolean                // status === 'x'
  status: string                  // single char: ' ' / 'x' / '/' / '>' / '-' etc.
  line: number                    // 0-based line number in file
  dueDate: string | null          // [due::YYYY-MM-DD] → dated fallback
  completedDate: string | null    // checked=true: [completion::...] → dated; checked=false: null
  fields: Record<string, string>  // all other [key::value] inline fields
}

export interface Task extends TaskItem {
  path: string                    // source file path, injected by indexService / buildTaskMap
}
```

- [ ] **Step 2: Extend `FileMeta` with date fields and tasks**

In `src/stores/types.ts`, update `FileMeta`:

```typescript
export interface FileMeta {
  name: string
  path: string
  kind: 'file' | 'directory'
  parent: string | null
  size: number
  mtime: number
  hash: string
  frontmatter: Record<string, unknown>
  outLinks: string[]
  tags: string[]
  aliases: string[]
  created: string        // YYYY-MM-DD: frontmatter.created → mtime (never null)
  updated: string | null // YYYY-MM-DD: frontmatter.updated → null if absent
  dated: string          // YYYY-MM-DD: filename date → created (never null)
  tasks: TaskItem[]      // extracted task items, no path (implicit from record key)
}
```

- [ ] **Step 3: Add `taskMap` to `CacheState`**

In `src/stores/types.ts`, update `CacheState`:

```typescript
export interface CacheState {
  files: Record<string, FileMeta>
  backlinkMap: Record<string, string[]>
  tagMap: Record<string, string[]>
  taskMap: Task[]
}
```

- [ ] **Step 4: Extend `CachedFields` in fileCacheService.ts**

In `src/services/fileCacheService.ts`, line 5, update the type alias:

```typescript
export type CachedFields = Pick<FileMeta,
  'frontmatter' | 'outLinks' | 'tags' | 'aliases' | 'created' | 'updated' | 'tasks'
>
```

- [ ] **Step 5: Commit**

```bash
git add src/stores/types.ts src/services/fileCacheService.ts
git commit -m "feat: add TaskItem/Task types and extend FileMeta/CacheState/CachedFields"
```

---

### Task 2: Add helpers to knowledgeUtils + tests

**Files:**
- Modify: `src/lib/knowledgeUtils.ts`
- Modify: `src/__tests__/knowledgeService.test.ts`

- [ ] **Step 1: Write failing tests for the three new functions**

Add to `src/__tests__/knowledgeService.test.ts`:

```typescript
import {
  extractLinks, extractTags, buildBacklinkMap,
  extractDateString, extractDateFromName, buildTaskMap,
} from '../lib/knowledgeUtils'
import type { FileMeta } from '../stores/types'

describe('extractDateString', () => {
  it('parses YYYY-MM-DD string', () => {
    expect(extractDateString('2024-05-26')).toBe('2024-05-26')
  })
  it('parses ISO datetime, keeps date part only', () => {
    expect(extractDateString('2024-05-26T12:00:00Z')).toBe('2024-05-26')
  })
  it('returns null for non-date string', () => {
    expect(extractDateString('not a date')).toBeNull()
  })
  it('returns null for number', () => {
    expect(extractDateString(20240526)).toBeNull()
  })
  it('returns null for undefined', () => {
    expect(extractDateString(undefined)).toBeNull()
  })
})

describe('extractDateFromName', () => {
  it('extracts date from daily note filename', () => {
    expect(extractDateFromName('2024-05-26.md')).toBe('2024-05-26')
  })
  it('extracts date from filename with title', () => {
    expect(extractDateFromName('2024-05-26 my note.md')).toBe('2024-05-26')
  })
  it('returns null when no date in filename', () => {
    expect(extractDateFromName('my-note.md')).toBeNull()
  })
  it('returns null for empty string', () => {
    expect(extractDateFromName('')).toBeNull()
  })
})

describe('buildTaskMap', () => {
  const makeFile = (tasks: FileMeta['tasks']): FileMeta => ({
    name: 'test.md', path: 'test.md', kind: 'file', parent: null,
    size: 0, mtime: 0, hash: '', frontmatter: {}, outLinks: [], tags: [],
    aliases: [], created: '2024-01-01', updated: null, dated: '2024-01-01', tasks,
  })

  it('flattens tasks from all files with path injected', () => {
    const files = {
      'a.md': makeFile([{ text: 'Task A', cleanText: 'Task A', checked: false, status: ' ', line: 0, dueDate: null, completedDate: null, fields: {} }]),
      'b.md': makeFile([{ text: 'Task B', cleanText: 'Task B', checked: true, status: 'x', line: 0, dueDate: null, completedDate: null, fields: {} }]),
    }
    const result = buildTaskMap(files)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ text: 'Task A', path: 'a.md' })
    expect(result[1]).toMatchObject({ text: 'Task B', path: 'b.md' })
  })

  it('returns empty array when no files have tasks', () => {
    const files = { 'a.md': makeFile([]) }
    expect(buildTaskMap(files)).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/__tests__/knowledgeService.test.ts
```

Expected: FAIL — `extractDateString is not a function` (or similar import error).

- [ ] **Step 3: Implement the three functions in knowledgeUtils.ts**

First, add the import at the top of `src/lib/knowledgeUtils.ts` (alongside existing imports):

```typescript
import type { TaskItem, Task } from '../stores/types'
```

Then append the three functions at the bottom of the file:

```typescript
export function extractDateString(val: unknown): string | null {
  if (typeof val !== 'string') return null
  return /^\d{4}-\d{2}-\d{2}/.test(val) ? val.slice(0, 10) : null
}

export function extractDateFromName(name: string): string | null {
  const m = name.match(/(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

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

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/__tests__/knowledgeService.test.ts
```

Expected: all `extractDateString`, `extractDateFromName`, `buildTaskMap` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/knowledgeUtils.ts src/__tests__/knowledgeService.test.ts
git commit -m "feat: add extractDateString, extractDateFromName, buildTaskMap to knowledgeUtils"
```

---

### Task 3: Create tasksField.ts + tests

**Files:**
- Create: `src/lib/tasksField.ts`
- Create: `src/lib/__tests__/tasksField.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/__tests__/tasksField.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { tasksField } from '../tasksField'

function parse(content: string) {
  const state = EditorState.create({
    doc: content,
    extensions: [markdown({ extensions: [GFM] }), tasksField],
  })
  return state.field(tasksField)
}

describe('tasksField', () => {
  it('extracts an open task', () => {
    const tasks = parse('- [ ] Buy milk')
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      text: 'Buy milk',
      cleanText: 'Buy milk',
      checked: false,
      status: ' ',
      line: 0,
      dueDate: null,
      completedDate: null,
      fields: {},
    })
  })

  it('extracts a completed task', () => {
    const tasks = parse('- [x] Done item')
    expect(tasks[0]).toMatchObject({ checked: true, status: 'x', text: 'Done item' })
  })

  it('extracts custom status character', () => {
    const tasks = parse('- [/] In progress')
    expect(tasks[0]).toMatchObject({ checked: false, status: '/', text: 'In progress' })
  })

  it('extracts due date inline field', () => {
    const tasks = parse('- [ ] Write report [due::2024-05-30]')
    expect(tasks[0].dueDate).toBe('2024-05-30')
    expect(tasks[0].fields).toMatchObject({ due: '2024-05-30' })
    expect(tasks[0].cleanText).toBe('Write report')
  })

  it('extracts completion date inline field', () => {
    const tasks = parse('- [x] Send email [completion::2024-05-26]')
    expect(tasks[0].completedDate).toBe('2024-05-26')
  })

  it('extracts multiple inline fields', () => {
    const tasks = parse('- [ ] Task [due::2024-05-30] [project::work]')
    expect(tasks[0].fields).toEqual({ due: '2024-05-30', project: 'work' })
    expect(tasks[0].cleanText).toBe('Task')
  })

  it('returns correct 0-based line number', () => {
    const tasks = parse('# Heading\n\n- [ ] Task on line 2')
    expect(tasks[0].line).toBe(2)
  })

  it('handles multiple tasks', () => {
    const tasks = parse('- [ ] First\n- [x] Second')
    expect(tasks).toHaveLength(2)
    expect(tasks[0].text).toBe('First')
    expect(tasks[1].text).toBe('Second')
  })

  it('ignores plain list items without checkbox', () => {
    const tasks = parse('- Not a task\n- [ ] This is a task')
    expect(tasks).toHaveLength(1)
    expect(tasks[0].text).toBe('This is a task')
  })

  it('skips tasks inside fenced code blocks', () => {
    const tasks = parse('```\n- [ ] Not a task\n```\n\n- [ ] Real task')
    expect(tasks).toHaveLength(1)
    expect(tasks[0].text).toBe('Real task')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/__tests__/tasksField.test.ts
```

Expected: FAIL — `Cannot find module '../tasksField'`.

- [ ] **Step 3: Create src/lib/tasksField.ts**

```typescript
import { syntaxTree } from '@codemirror/language'
import { StateField } from '@codemirror/state'
import type { EditorState } from '@codemirror/state'
import type { TaskItem } from '../stores/types'

const INLINE_FIELD_RE = /\[([^\]]+?)::([^\]]*)\]/g

function parseInlineFields(text: string): { fields: Record<string, string>; cleanText: string } {
  const fields: Record<string, string> = {}
  INLINE_FIELD_RE.lastIndex = 0
  const cleanText = text.replace(INLINE_FIELD_RE, (_, key: string, val: string) => {
    fields[key.trim()] = val.trim()
    return ''
  }).replace(/\s+/g, ' ').trim()
  return { fields, cleanText }
}

function extractTasks(state: EditorState): TaskItem[] {
  const tasks: TaskItem[] = []

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') return false

      if (node.name === 'ListItem') {
        const c = node.node.cursor()
        let markerFrom = -1
        let markerTo = -1

        if (c.firstChild()) {
          do {
            if (c.name === 'TaskMarker') {
              markerFrom = c.from
              markerTo = c.to
              break
            }
          } while (c.nextSibling())
        }

        if (markerFrom === -1) return false

        const status = state.doc.sliceString(markerFrom + 1, markerTo - 1)
        const line = state.doc.lineAt(node.from)
        const rawText = state.doc.sliceString(markerTo, line.to).trim()
        const { fields, cleanText } = parseInlineFields(rawText)

        tasks.push({
          text: rawText,
          cleanText,
          checked: status === 'x',
          status,
          line: line.number - 1,
          dueDate: fields['due'] ?? null,
          completedDate: fields['completion'] ?? null,
          fields,
        })
        return false
      }
    },
  })

  return tasks
}

export const tasksField = StateField.define<TaskItem[]>({
  create: extractTasks,
  update(tasks, tr) {
    if (tr.docChanged) return extractTasks(tr.state)
    return tasks
  },
})
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/__tests__/tasksField.test.ts
```

Expected: all 10 tests PASS. If `TaskMarker` node is not found, add a diagnostic test first to print node names (see `wikiLinkParser.test.ts` for the pattern) and adjust accordingly.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tasksField.ts src/lib/__tests__/tasksField.test.ts
git commit -m "feat: add tasksField CM6 StateField for GFM task item extraction"
```

---

### Task 4: Wire new fields into indexService

**Files:**
- Modify: `src/services/indexService.ts`

- [ ] **Step 1: Update imports**

In `src/services/indexService.ts`, add to the import block:

```typescript
import { tasksField } from '../lib/tasksField'
import { extractDateString, extractDateFromName, buildTaskMap } from '../lib/knowledgeUtils'
import type { TaskItem } from '../stores/types'
```

- [ ] **Step 2: Update `EMPTY_CONTENT`**

In `src/services/indexService.ts`, replace the `EMPTY_CONTENT` constant:

```typescript
const EMPTY_CONTENT: Pick<FileMeta, 'frontmatter' | 'outLinks' | 'tags' | 'aliases' | 'updated' | 'tasks'> = {
  frontmatter: {},
  outLinks: [],
  tags: [],
  aliases: [],
  updated: null,
  tasks: [],
}
```

- [ ] **Step 3: Update `buildScan` to set `created` and `dated` on file entries**

In `src/services/indexService.ts`, inside `buildScan`, update both the directory and file branches:

```typescript
// Directory branch — replace existing line
const dirMtime = new Date(0).toISOString().slice(0, 10)
result.files[path] = {
  name, path, kind: 'directory', parent: parentPath,
  size: 0, mtime: 0, hash: '',
  ...EMPTY_CONTENT,
  created: dirMtime,
  dated: extractDateFromName(name) ?? dirMtime,
}

// File branch — replace existing line
const file = await (handle as FileSystemFileHandle).getFile()
const size = file.size
const mtime = file.lastModified
const mtimeStr = new Date(mtime).toISOString().slice(0, 10)
result.files[path] = {
  name, path, kind: 'file', parent: parentPath,
  size, mtime, hash: '',
  ...EMPTY_CONTENT,
  created: mtimeStr,
  dated: extractDateFromName(name) ?? mtimeStr,
}
```

- [ ] **Step 4: Add `tasksField` to `createHeadlessState`**

In `src/services/indexService.ts`, update `createHeadlessState`:

```typescript
function createHeadlessState(content: string): EditorState {
  return EditorState.create({
    doc: content,
    extensions: [
      markdown({ extensions: [GFM, wikiLinkParser] }),
      outLinksField,
      inlineTagsField,
      tasksField,
    ],
  })
}
```

- [ ] **Step 5: Update `runPhase1` — fresh content path**

In `src/services/indexService.ts`, in `runPhase1`, replace the block starting from `const state = createHeadlessState(content)` to `await setCachedMeta(hash, parsed)`:

```typescript
const state = createHeadlessState(content)
const { frontmatter } = parseFrontmatter(content)
const inlineTags = state.field(inlineTagsField).map(m => m.tag)
const outLinks = state.field(outLinksField)
  .filter(l => l.type === 'wiki')
  .map(l => l.target.endsWith('.md') ? l.target : `${l.target}.md`)

const created = extractDateString(frontmatter.created)
             ?? new Date(entry.mtime).toISOString().slice(0, 10)
const updated = extractDateString(frontmatter.updated) ?? null
const filename = path.split('/').at(-1) ?? ''
const dated = extractDateFromName(filename) ?? created

const tasks: TaskItem[] = state.field(tasksField).map(t => ({
  ...t,
  dueDate: t.dueDate ?? dated,
  completedDate: t.checked ? (t.completedDate ?? dated) : null,
}))

const parsed = {
  frontmatter,
  outLinks,
  tags: mergeTagsWithBody(extractTags(frontmatter.tags), inlineTags),
  aliases: extractAliases(frontmatter.aliases),
  created,
  updated,
  tasks,
}
await setCachedMeta(hash, parsed)
setCacheStore('files', path, (f: FileMeta) => ({ ...f, hash, dated, ...parsed }))
```

- [ ] **Step 6: Update `runPhase1` — cache-hit path**

In `src/services/indexService.ts`, in `runPhase1`, update the cache-hit block for `unchanged` entries (where `setCachedMeta` is read):

```typescript
// In the loop for `unchanged` paths, replace:
if (cached) {
  setCacheStore('files', path, (f: FileMeta) => ({ ...f, hash, ...cached }))
}
// With:
if (cached) {
  const fname = path.split('/').at(-1) ?? ''
  const dated = extractDateFromName(fname) ?? cached.created
  setCacheStore('files', path, (f: FileMeta) => ({ ...f, hash, dated, ...cached }))
}
```

Also update the path that reads cached for `changed` entries:

```typescript
// In the loop for `changed` paths, replace:
if (cachedMeta) {
  setCacheStore('files', path, (f: FileMeta) => ({ ...f, hash, ...cachedMeta }))
  continue
}
// With:
if (cachedMeta) {
  const fname = path.split('/').at(-1) ?? ''
  const dated = extractDateFromName(fname) ?? cachedMeta.created
  setCacheStore('files', path, (f: FileMeta) => ({ ...f, hash, dated, ...cachedMeta }))
  continue
}
```

- [ ] **Step 7: Add `buildTaskMap` call to `runPhase2`**

In `src/services/indexService.ts`, update `runPhase2`:

```typescript
function runPhase2(): void {
  const mdFiles = Object.fromEntries(
    Object.entries(cacheStore.files).filter(([p]) => p.endsWith('.md')),
  )
  setCacheStore('backlinkMap', buildBacklinkMap(mdFiles))
  setCacheStore('tagMap', buildTagMap(mdFiles))
  setCacheStore('taskMap', buildTaskMap(mdFiles))
}
```

- [ ] **Step 8: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/services/indexService.ts
git commit -m "feat: wire created/updated/dated/tasks/taskMap into indexService scan pipeline"
```

---

### Task 5: Update cacheStore for live-save pipeline

**Files:**
- Modify: `src/stores/cacheStore.ts`

- [ ] **Step 1: Update imports in cacheStore.ts**

Add to the import block at the top of `src/stores/cacheStore.ts`:

```typescript
import { tasksField } from '../lib/tasksField'
import { extractDateString, extractDateFromName } from '../lib/knowledgeUtils'
import type { Task, TaskItem } from './types'
```

- [ ] **Step 2: Add `taskMap` to the initial store state**

In `src/stores/cacheStore.ts`, update the `createStore` call:

```typescript
const [cacheStore, setCacheStore] = createStore<CacheState>({
  files: {},
  backlinkMap: {},
  tagMap: {},
  taskMap: [],
})
```

- [ ] **Step 3: Update `CmParsed` interface**

In `src/stores/cacheStore.ts`, update the `CmParsed` interface (`tasks` is optional to preserve backward compat with callers that haven't been updated yet):

```typescript
export interface CmParsed { outLinks: string[]; inlineTags: string[]; tasks?: TaskItem[] }
```

- [ ] **Step 4: Update `ContentFields` type alias**

In `src/stores/cacheStore.ts`, replace `ContentFields`:

```typescript
type ContentFields = Pick<FileMeta, 'frontmatter' | 'outLinks' | 'tags' | 'aliases' | 'created' | 'updated' | 'tasks'>
```

- [ ] **Step 5: Update `parseWithCm6` to extract tasks**

In `src/stores/cacheStore.ts`, replace `parseWithCm6`:

```typescript
function parseWithCm6(content: string): CmParsed {
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

- [ ] **Step 6: Update `applyContent` to handle `dated` and `taskMap`**

In `src/stores/cacheStore.ts`, replace `applyContent`:

```typescript
function applyContent(path: string, hash: string, content: ContentFields): void {
  const prev = cacheStore.files[path]

  const filename = path.split('/').at(-1) ?? ''
  const dated = extractDateFromName(filename) ?? content.created
  setCacheStore('files', path, (f: FileMeta) => ({ ...f, hash, dated, ...content }))

  const prevLinks = new Set(prev?.outLinks ?? [])
  const nextLinks = new Set(content.outLinks)
  for (const t of prevLinks) {
    if (!nextLinks.has(t))
      setCacheStore('backlinkMap', t, (list: string[]) => list?.filter(p => p !== path) ?? [])
  }
  for (const t of nextLinks) {
    if (!prevLinks.has(t))
      setCacheStore('backlinkMap', t, (list: string[]) => list ? [...list, path] : [path])
  }

  const prevTags = new Set(prev?.tags ?? [])
  const nextTags = new Set(content.tags)
  for (const t of prevTags) {
    if (!nextTags.has(t))
      setCacheStore('tagMap', t, (list: string[]) => list?.filter(p => p !== path) ?? [])
  }
  for (const t of nextTags) {
    if (!prevTags.has(t))
      setCacheStore('tagMap', t, (list: string[]) => list ? [...list, path] : [path])
  }

  setCacheStore('taskMap', (list: Task[]) => [
    ...list.filter(t => t.path !== path),
    ...content.tasks.map(t => ({ ...t, path })),
  ])
}
```

- [ ] **Step 7: Update `reindexFile` to build `ContentFields` with new fields**

In `src/stores/cacheStore.ts`, replace `reindexFile`:

```typescript
async reindexFile(path: string, content: string, cmParsed?: CmParsed): Promise<void> {
  const hash = hashContent(content)
  const cached = await getCachedMeta(hash)
  let fields: ContentFields
  if (cached) {
    fields = cached
  } else {
    const { frontmatter } = parseFrontmatter(content)
    const { outLinks, inlineTags } = cmParsed ?? parseWithCm6(content)
    const rawTasks: TaskItem[] = cmParsed?.tasks ?? parseWithCm6(content).tasks
    const existingMtime = cacheStore.files[path]?.mtime ?? Date.now()
    const created = extractDateString(frontmatter.created)
                 ?? new Date(existingMtime).toISOString().slice(0, 10)
    const updated = extractDateString(frontmatter.updated) ?? null
    const filename = path.split('/').at(-1) ?? ''
    const dated = extractDateFromName(filename) ?? created
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
      tasks,
    }
    await setCachedMeta(hash, fields)
  }
  applyContent(path, hash, fields)
},
```

- [ ] **Step 8: Update `removeCacheEntry` to clean up `taskMap`**

In `src/stores/cacheStore.ts`, update `removeCacheEntry`:

```typescript
removeCacheEntry(path: string): void {
  const file = cacheStore.files[path]
  if (!file) return
  for (const t of file.outLinks)
    setCacheStore('backlinkMap', t, (list: string[]) => list?.filter(p => p !== path) ?? [])
  for (const t of file.tags)
    setCacheStore('tagMap', t, (list: string[]) => list?.filter(p => p !== path) ?? [])
  setCacheStore('taskMap', (list: Task[]) => list.filter(t => t.path !== path))
  setCacheStore('files', path, undefined as unknown as FileMeta)
},
```

- [ ] **Step 9: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/stores/cacheStore.ts
git commit -m "feat: wire created/updated/tasks/taskMap into cacheStore live-save pipeline"
```

---

### Task 6: Update EditorViewer to pass tasks in CmParsed

**Files:**
- Modify: `src/components/viewer/EditorViewer.tsx`

- [ ] **Step 1: Add `tasksField` to editor extensions**

In `src/components/viewer/EditorViewer.tsx`, find the place where editor extensions are assembled (the `EditorView` or `EditorState` creation). Add `tasksField` to the extensions list alongside `outLinksField` and `inlineTagsField`:

First, add the import at the top of the file:

```typescript
import { tasksField } from '../../lib/tasksField'
```

Then add `tasksField` to the extensions where `outLinksField` and `inlineTagsField` are listed.

- [ ] **Step 2: Pass `tasks` in both CmParsed calls in the update handler**

In `src/components/viewer/EditorViewer.tsx`, in the debounced update handler (around line 119–129), update the `reindexFile` call:

```typescript
void cacheActions.reindexFile(p, view.state.doc.toString(), {
  outLinks,
  inlineTags,
  tasks: view.state.field(tasksField),
})
```

- [ ] **Step 3: Pass `tasks` in the `saveFile` CmParsed call**

In `src/components/viewer/EditorViewer.tsx`, in `saveFile` (around line 181–186), update the `reindexFile` call:

```typescript
await cacheActions.reindexFile(p, content, {
  outLinks,
  inlineTags,
  tasks: view.state.field(tasksField),
})
```

- [ ] **Step 4: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/viewer/EditorViewer.tsx
git commit -m "feat: add tasksField to editor extensions, pass tasks via CmParsed on reindex"
```

---

### Task 7: Final type-check

**Files:** all

- [ ] **Step 1: Run TypeScript compiler**

```bash
npx tsc --noEmit
```

Expected: zero errors. Common issues to fix if they appear:
- `EMPTY_CONTENT` spread missing `created`/`dated` — set them explicitly on each entry after the spread
- `initCacheStore` restoring old data without `taskMap` — the SolidJS `reconcile` will merge, and `taskMap: []` in the initial store handles missing key gracefully

- [ ] **Step 2: Run final full test suite**

```bash
npx vitest run
```

Expected: all tests pass (≥ 68 tests across ≥ 12 test files).

- [ ] **Step 3: Final commit**

```bash
git add -p   # stage any tsc-fix edits
git commit -m "fix: resolve tsc type errors after tasks/date fields integration"
```
