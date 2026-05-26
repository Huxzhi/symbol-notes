# Tasks Extraction + FileMeta Date Fields Design

**Date:** 2026-05-26  
**Status:** Approved

## Overview

Extract task list items (`- [ ]`) from each markdown file via CM6 syntax tree and mount them to `FileMeta`. Simultaneously promote `created`, `updated`, and `dated` as first-class date fields in `FileMeta`, following the same pattern as `tags` and `aliases`.

## Data Model

### New `FileMeta` fields

```typescript
// types.ts — added to FileMeta
created: string          // YYYY-MM-DD from frontmatter.created → mtime (never null)
updated: string | null   // YYYY-MM-DD from frontmatter.updated → null if absent
dated: string            // YYYY-MM-DD from filename → created (never null)
tasks: TaskItem[]        // all task items extracted from file body (no path)
```

### `TaskItem` and `Task`

```typescript
// types.ts

// Stored in FileMeta and IDB cache — path is implicit from the FileMeta record key
export interface TaskItem {
  text: string                    // raw text after checkbox (includes [key::value])
  cleanText: string               // text with [key::value] removed
  checked: boolean                // status === 'x'
  status: string                  // single char: ' ' / 'x' / '/' / '>' / '-' etc.
  line: number                    // 0-based line number in file
  dueDate: string | null          // [due::YYYY-MM-DD] → dated
  completedDate: string | null    // [completion::YYYY-MM-DD] → dated; null if not checked
  fields: Record<string, string>  // all other [key::value] inline fields
}

// Used in CacheState.taskMap — path injected during Phase 2 aggregation
export interface Task extends TaskItem {
  path: string
}
```

`FileMeta.tasks: TaskItem[]` — no path, cached in IDB by content hash.  
`CacheState.taskMap: Task[]` — flat global list with path, built in Phase 2 like `backlinkMap`.

### Date field fallback chains

| Field | Priority 1 | Priority 2 | Priority 3 |
|---|---|---|---|
| `created` | `frontmatter.created` as YYYY-MM-DD | — | `mtime` as YYYY-MM-DD |
| `updated` | `frontmatter.updated` as YYYY-MM-DD | — | `null` |
| `dated` | filename YYYY-MM-DD pattern | `created` | — |
| `dueDate` | `[due::...]` in task text | `dated` | — |
| `completedDate` | `[completion::...]` in task text | `dated` (only if `checked=true`) | — |

### Inline field syntax

Tasks support Dataview-style inline fields: `[key::value]`. Examples:

```
- [ ] Write report [due::2024-05-30] [project::work]
- [x] Send email [completion::2024-05-26]
```

`fields` stores all parsed pairs. `dueDate` and `completedDate` are additionally promoted from `fields` into their own typed fields.

## Architecture

### Approach

CM6 StateField using the lezer syntax tree — consistent with `outLinksField`, `inlineTagsField`, and `headingsField`. The syntax tree naturally excludes code blocks (no false positives from fenced code containing `- [ ]`).

### Component map

| File | Change |
|---|---|
| `src/stores/types.ts` | Add `created`, `updated`, `dated`, `tasks` to `FileMeta`; add `TaskItem`, `Task` interfaces; add `taskMap` to `CacheState` |
| `src/lib/tasksField.ts` | **New**: CM6 `StateField<TaskItem[]>` |
| `src/lib/knowledgeUtils.ts` | Add `extractDateString()`, `extractDateFromName()`, `buildTaskMap()` |
| `src/services/fileCacheService.ts` | `CachedFields` adds `created`, `updated`, `tasks` |
| `src/services/indexService.ts` | Register `tasksField` in headless state; extract and inject all new fields; compute `dated`; call `buildTaskMap()` in Phase 2 |

## Implementation Details

### `tasksField.ts`

Walk the syntax tree for `ListItem` nodes. A task list item has a `TaskMarker` as its first meaningful child node (GFM extension).

```
syntaxTree(state).iterate →
  ListItem →
    check first child for TaskMarker →
      status = doc.sliceString(marker.from + 1, marker.to - 1)  // single char
      checked = status === 'x'
      rawText = doc.sliceString(marker.to, lineEnd).trim()
      parse [key::value] from rawText → fields, cleanText
      dueDate = fields['due'] ?? null
      completedDate = fields['completion'] ?? null
      line = doc.lineAt(node.from).number - 1  // 0-based
```

The `StateField` follows the standard pattern:

```typescript
export const tasksField = StateField.define<TaskItem[]>({
  create: extractTasks,
  update(tasks, tr) {
    if (tr.docChanged) return extractTasks(tr.state)
    return tasks
  },
})
```

### `knowledgeUtils.ts` additions

```typescript
// Parse frontmatter date value to YYYY-MM-DD string
export function extractDateString(val: unknown): string | null {
  if (typeof val !== 'string') return null
  return /^\d{4}-\d{2}-\d{2}/.test(val) ? val.slice(0, 10) : null
}

// Extract YYYY-MM-DD from a filename like "2024-05-26.md" or "2024-05-26 title.md"
export function extractDateFromName(name: string): string | null {
  const m = name.match(/(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}
```

### `indexService.ts` changes

**`buildScan`**: set `created` and `dated` from scan-time data (Phase 1 will refine `created` if frontmatter is present):

```typescript
// For file entries — mtime is known at scan time
const mtimeStr = new Date(mtime).toISOString().slice(0, 10)
const dated = extractDateFromName(name) ?? mtimeStr
files[path] = { ..., created: mtimeStr, updated: null, dated, tasks: [], ...EMPTY_CONTENT }
```

**`createHeadlessState`**: add `tasksField` to extensions.

**Phase 1 `runPhase1`**: after parsing content:

```typescript
const created = extractDateString(frontmatter.created)
             ?? new Date(entry.mtime).toISOString().slice(0, 10)
const updated = extractDateString(frontmatter.updated) ?? null
const dated = extractDateFromName(path.split('/').at(-1) ?? '') ?? created

const tasks: TaskItem[] = state.field(tasksField).map(t => ({
  ...t,
  dueDate: t.dueDate ?? dated,
  completedDate: t.checked ? (t.completedDate ?? dated) : null,
}))

const parsed = { frontmatter, outLinks, tags, aliases, created, updated, tasks }
await setCachedMeta(hash, parsed)
setCacheStore('files', path, (f: FileMeta) => ({ ...f, hash, dated, ...parsed }))
```

When restoring from cache, recompute `dated` (not cached):

```typescript
if (cachedMeta) {
  const dated = extractDateFromName(filename) ?? cachedMeta.created
  setCacheStore('files', path, (f: FileMeta) => ({ ...f, hash, dated, ...cachedMeta }))
  continue
}
```

`dated` is excluded from `CachedFields` — always recomputed from filename and `created`.

### `CachedFields` (fileCacheService.ts)

`CachedFields` maps directly to `Pick<FileMeta, ...>`. `tasks: TaskItem[]` is cached in full — no path in cache, path is injected only in `taskMap`:

```typescript
export type CachedFields = Pick<FileMeta,
  'frontmatter' | 'outLinks' | 'tags' | 'aliases' | 'created' | 'updated' | 'tasks'
>
```

### `CacheState.taskMap` and Phase 2

`CacheState` gains a `taskMap: Task[]` field — a flat list of all tasks across all `.md` files with `path` injected, built in Phase 2 alongside `backlinkMap` and `tagMap`.

```typescript
// types.ts — CacheState
export interface CacheState {
  files: Record<string, FileMeta>
  backlinkMap: Record<string, string[]>
  tagMap: Record<string, string[]>
  taskMap: Task[]                        // new
}
```

`buildTaskMap()` in `knowledgeUtils.ts`:

```typescript
export function buildTaskMap(mdFiles: Record<string, FileMeta>): Task[] {
  const tasks: Task[] = []
  for (const [path, meta] of Object.entries(mdFiles)) {
    for (const t of meta.tasks) {
      tasks.push({ ...t, path })
    }
  }
  return tasks
}
```

`runPhase2()` in `indexService.ts` calls `buildTaskMap()`:

```typescript
function runPhase2(): void {
  const mdFiles = Object.fromEntries(
    Object.entries(cacheStore.files).filter(([p]) => p.endsWith('.md')),
  )
  setCacheStore('backlinkMap', buildBacklinkMap(mdFiles))
  setCacheStore('tagMap', buildTagMap(mdFiles))
  setCacheStore('taskMap', buildTaskMap(mdFiles))   // new
}
```

### `EMPTY_CONTENT` update

`created` and `dated` are computed from `mtime` at scan time and set directly on each file entry — not via `EMPTY_CONTENT`. `EMPTY_CONTENT` gains `updated` and `tasks`:

```typescript
const EMPTY_CONTENT = {
  frontmatter: {},
  outLinks: [],
  tags: [],
  aliases: [],
  updated: null,
  tasks: [],
}
```

## Out of Scope

- Tasks panel UI (cross-file task aggregation view)
- Task checkbox toggle in the editor
- Recurring tasks or task metadata beyond what's described here
