# Tasks Extraction + FileMeta Date Fields Design

**Date:** 2026-05-26  
**Status:** Approved

## Overview

Extract task list items (`- [ ]`) from each markdown file via CM6 syntax tree and mount them to `FileMeta`. Simultaneously promote `created`, `updated`, and `dated` as first-class date fields in `FileMeta`, following the same pattern as `tags` and `aliases`.

## Data Model

### New `FileMeta` fields

```typescript
// types.ts — added to FileMeta
created: string        // YYYY-MM-DD from frontmatter.created → mtime (never null)
updated: string | null // YYYY-MM-DD from frontmatter.updated → null if absent
dated: string          // YYYY-MM-DD from filename → created (never null)
tasks: Task[]          // all task items extracted from file body
```

### `Task` and `TaskEntry`

```typescript
// tasksField.ts — StateField output and IDB cache shape
export interface TaskEntry {
  text: string                    // raw text after checkbox (includes [key::value])
  cleanText: string               // text with [key::value] removed
  checked: boolean                // status === 'x'
  status: string                  // single char: ' ' / 'x' / '/' / '>' / '-' etc.
  line: number                    // 0-based line number in file
  dueDate: string | null          // [due::YYYY-MM-DD] → dated (if checked or always)
  completedDate: string | null    // checked=true: [completion::YYYY-MM-DD] → dated; checked=false: null
  fields: Record<string, string>  // all other [key::value] inline fields
}

// types.ts — FileMeta uses Task (TaskEntry + path injected by indexService)
export interface Task extends TaskEntry {
  path: string
}
```

`path` is not stored in IDB cache — it is injected by `indexService` when building the `FileMeta` entry, since the cache is content-hash keyed and path-agnostic.

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
| `src/stores/types.ts` | Add `created`, `updated`, `dated`, `tasks` to `FileMeta`; add `Task`, `TaskEntry` interfaces |
| `src/lib/tasksField.ts` | **New**: CM6 `StateField<TaskEntry[]>` |
| `src/lib/knowledgeUtils.ts` | Add `extractDateString()`, `extractDateFromName()` |
| `src/services/fileCacheService.ts` | `CachedFields` adds `created`, `updated`, `tasks` |
| `src/services/indexService.ts` | Register `tasksField` in headless state; extract and inject all new fields; compute `dated` |

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
export const tasksField = StateField.define<TaskEntry[]>({
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

const rawTasks = state.field(tasksField)
const tasks: Task[] = rawTasks.map(t => ({
  ...t,
  path,
  dueDate: t.dueDate ?? dated,
  completedDate: t.checked ? (t.completedDate ?? dated) : null,
}))

const parsed = { frontmatter, outLinks, tags, aliases, created, updated, tasks }
await setCachedMeta(hash, { frontmatter, outLinks, tags, aliases, created, updated, tasks: rawTasks })
setCacheStore('files', path, (f: FileMeta) => ({ ...f, hash, dated, ...parsed }))
```

Note: `dated` and `path` are excluded from `CachedFields` — `dated` is computed from name + `created`, and `path` is injected at runtime. When restoring from IDB cache, `dated` and `path`-injected tasks are recomputed.

### `CachedFields` (fileCacheService.ts)

`FileMeta.tasks` is `Task[]` (includes `path`), but the cached shape stores `TaskEntry[]` (no `path`, since the cache is content-hash keyed). `CachedFields` is therefore defined as an explicit interface rather than `Pick<FileMeta, ...>`:

```typescript
export interface CachedFields {
  frontmatter: Record<string, unknown>
  outLinks: string[]
  tags: string[]
  aliases: string[]
  created: string
  updated: string | null
  tasks: TaskEntry[]
}
```

### `EMPTY_CONTENT` update

`created` and `dated` are computed from `mtime` (known at scan time) and set directly on each file entry — they are not part of `EMPTY_CONTENT`. `EMPTY_CONTENT` gains only `updated` and `tasks`:

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
