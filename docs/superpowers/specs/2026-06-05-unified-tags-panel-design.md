# Unified Tags Panel Design

Date: 2026-06-05

## Overview

Merge the Tags panel and Search panel into a single self-contained Tags panel. The panel shows a nested tag tree; clicking a tag inline-expands the file entries for that tag (and its subtags). Simultaneously extend `FileMeta` with an `etags` field that stores the original (unexpanded) tags.

## Data Layer

### FileMeta (src/stores/types.ts)

Add one field:

```ts
etags: string[]   // original tags, not expanded (frontmatter tags + inline #tags, deduplicated)
tags:  string[]   // flattened tags, expanded (existing behavior, unchanged)
```

Example — frontmatter `tags: [dev/frontend]`, inline body `#writing`:
- `etags = ["dev/frontend", "writing"]`
- `tags  = ["dev", "dev/frontend", "writing"]`

### scan.ts

`EMPTY_CONTENT` gains `etags: []`.

In `runPhase1`, replace:
```ts
tags: mergeTagsWithBody(extractTags(frontmatter.tags), inlineTags)
```
with:
```ts
const fmTags = extractTags(frontmatter.tags)
const etags  = [...new Set([...fmTags, ...inlineTags])]
const tags   = mergeTagsWithBody(fmTags, inlineTags)
```
Store both `etags` and `tags` in `parsed` and in the cache write.

### indexStorage.ts

`CachedFields` `Pick` list gains `etags` so cache hits restore the field correctly.

### VaultState / tagMap

No changes. `tagMap` continues to index files by the flattened `tags` field.

## UI Layer

### TagsPanel (src/plugins/tags/index.tsx)

**State**

| Signal | Type | Default | Meaning |
|---|---|---|---|
| `collapsed` | `Set<string>` | empty | Tags whose child-tag subtree is hidden |
| `expandedFiles` | `Set<string>` | empty | Tags whose file list is shown |

**Click zones on a tag row**

```
[▶/▼]  [#]  [segment]  [count]
  ↑                       ↑
  clicks toggle           clicks toggle
  collapsed               expandedFiles
```

- The chevron (`▶/▼`) only appears when the tag has child tags. Clicking it (with `e.stopPropagation()`) toggles `collapsed`.
- Clicking anywhere else on the row toggles `expandedFiles`.

**Render order within a tag node**

1. Tag header row
2. File entries (shown when tag is in `expandedFiles`)
3. Child tag nodes (shown when tag is NOT in `collapsed`)

**File entries**

- Source: `tagMap` entries where `key === tag || key.startsWith(tag + '/')` — includes subtag files.
- Display: file base name (without `.md`), full path as `title`, click calls `workspaceActions.openFile(path)`.
- Style: same 11px text, `hover:bg-(--bg-hover)`, indented one extra level past the tag row.

**Search plugin**

Left unchanged. TagsPanel no longer calls `openSidebarPanel('right', 'search', ...)`.

## Files Changed

| File | Change |
|---|---|
| `src/stores/types.ts` | Add `etags: string[]` to `FileMeta` |
| `src/vault/indexStorage.ts` | Add `etags` to `CachedFields` Pick |
| `src/vault/scan.ts` | Compute `etags`; add to `EMPTY_CONTENT` and `parsed` |
| `src/plugins/tags/index.tsx` | Rewrite `TagsPanel` with inline file expansion |

## Out of Scope

- `etagMap` in `VaultState` — not needed for this feature
- Changes to the Search plugin
- Any other panels or views
