# Bidirectional Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw-string backlink matching with resolved full-path backlinks + an `unresolvedMap` that tracks wiki links pointing to non-existent files.

**Architecture:** Add `buildStemIndex` + `resolveLink` + `buildLinkMaps` to `knowledgeUtils.ts`. Replace the existing single `backlinkMap` build with `buildLinkMaps` which emits both `backlinkMap` (resolved, keyed by full path) and `unresolvedMap` (unresolved raw targets). Incremental updates in `applyContent` resolve each outLink at diff time. File creation/deletion cascades update the maps without re-reading any files.

**Tech Stack:** TypeScript, SolidJS store (`solid-js/store`), Vitest for tests.

---

## File Map

| File | Change |
|------|--------|
| `src/lib/knowledgeUtils.ts` | Add `buildStemIndex`, `resolveLink`, `buildLinkMaps`; remove `buildBacklinkMap` |
| `src/lib/__tests__/knowledgeUtils.test.ts` | Add tests for the three new functions |
| `src/stores/types.ts` | Add `unresolvedMap` to `VaultState` |
| `src/stores/vaultStore.ts` | Init `unresolvedMap`, update `applyContent` + `removeVaultEntry` |
| `src/services/vaultIndexer.ts` | Update `runPhase2` to call `buildLinkMaps` |
| `src/stores/runtimeStore.ts` | Add cascade in `createFile`; simplify `updateBacklinks` |
| `src/plugins/links/index.tsx` | Query `backlinkMap[path]` directly (stem workaround removed) |

---

### Task 1: Core resolution functions + tests

**Files:**
- Modify: `src/lib/knowledgeUtils.ts`
- Modify: `src/lib/__tests__/knowledgeUtils.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `src/lib/__tests__/knowledgeUtils.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { extractDateFromName, buildTaskMap, buildStemIndex, resolveLink, buildLinkMaps } from '../knowledgeUtils'
// ... existing imports/fixtures unchanged ...

describe('buildStemIndex', () => {
  it('maps stem to full path', () => {
    const index = buildStemIndex({ 'notes/todo.md': {}, 'work/todo.md': {}, 'readme.md': {} })
    expect(index.get('todo.md')).toEqual(['notes/todo.md', 'work/todo.md'])
    expect(index.get('readme.md')).toEqual(['readme.md'])
  })

  it('ignores non-md paths', () => {
    const index = buildStemIndex({ 'notes/todo.md': {}, 'image.png': {} })
    expect(index.has('image.png')).toBe(false)
  })
})

describe('resolveLink', () => {
  const files = { 'notes/todo.md': {}, 'work/other.md': {}, 'readme.md': {} }
  const stemIndex = buildStemIndex(files)

  it('resolves direct full path match', () => {
    expect(resolveLink('notes/todo.md', stemIndex, files)).toBe('notes/todo.md')
  })

  it('resolves unique stem to full path', () => {
    expect(resolveLink('other.md', stemIndex, files)).toBe('work/other.md')
  })

  it('resolves root-level file', () => {
    expect(resolveLink('readme.md', stemIndex, files)).toBe('readme.md')
  })

  it('returns null for ambiguous stem', () => {
    const f = { 'notes/todo.md': {}, 'work/todo.md': {} }
    expect(resolveLink('todo.md', buildStemIndex(f), f)).toBeNull()
  })

  it('disambiguates with path hint when multiple stems exist', () => {
    const f = { 'notes/todo.md': {}, 'work/todo.md': {} }
    expect(resolveLink('notes/todo.md', buildStemIndex(f), f)).toBe('notes/todo.md')
  })

  it('returns null for non-existent target', () => {
    expect(resolveLink('ghost.md', stemIndex, files)).toBeNull()
  })
})

describe('buildLinkMaps', () => {
  it('puts resolved links in backlinkMap keyed by full path', () => {
    const files = {
      'notes/todo.md': { outLinks: [] },
      'daily/2024-01-01.md': { outLinks: ['todo.md'] },
    }
    const { backlinkMap, unresolvedMap } = buildLinkMaps(files)
    expect(backlinkMap['notes/todo.md']).toEqual(['daily/2024-01-01.md'])
    expect(Object.keys(unresolvedMap)).toHaveLength(0)
  })

  it('puts unresolvable links in unresolvedMap', () => {
    const files = {
      'a.md': { outLinks: ['ghost.md'] },
    }
    const { backlinkMap, unresolvedMap } = buildLinkMaps(files)
    expect(unresolvedMap['ghost.md']).toEqual(['a.md'])
    expect(Object.keys(backlinkMap)).toHaveLength(0)
  })

  it('handles ambiguous stem as unresolved', () => {
    const files = {
      'notes/foo.md': { outLinks: [] },
      'work/foo.md': { outLinks: [] },
      'src.md': { outLinks: ['foo.md'] },
    }
    const { unresolvedMap } = buildLinkMaps(files)
    expect(unresolvedMap['foo.md']).toEqual(['src.md'])
  })

  it('disambiguates with path hint', () => {
    const files = {
      'notes/foo.md': { outLinks: [] },
      'work/foo.md': { outLinks: [] },
      'src.md': { outLinks: ['notes/foo.md'] },
    }
    const { backlinkMap } = buildLinkMaps(files)
    expect(backlinkMap['notes/foo.md']).toEqual(['src.md'])
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/lib/__tests__/knowledgeUtils.test.ts
```

Expected: failures on `buildStemIndex`, `resolveLink`, `buildLinkMaps` (not exported yet).

- [ ] **Step 3: Implement the three functions in `knowledgeUtils.ts`**

Replace `buildBacklinkMap` (lines 48–63) with:

```ts
export function buildStemIndex(files: Record<string, unknown>): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const path of Object.keys(files)) {
    if (!path.endsWith('.md')) continue
    const stem = path.split('/').pop()!
    const list = index.get(stem)
    if (list) list.push(path)
    else index.set(stem, [path])
  }
  return index
}

export function resolveLink(
  target: string,
  stemIndex: Map<string, string[]>,
  files: Record<string, unknown>,
): string | null {
  if (target in files) return target

  const stem = target.split('/').pop()!
  const candidates = stemIndex.get(stem) ?? []
  if (candidates.length === 1) return candidates[0]

  const pathMatches = candidates.filter(c => c === target || c.endsWith('/' + target))
  return pathMatches.length === 1 ? pathMatches[0] : null
}

export function buildLinkMaps(
  files: Record<string, { outLinks: string[] }>,
): { backlinkMap: Record<string, string[]>; unresolvedMap: Record<string, string[]> } {
  const stemIndex = buildStemIndex(files)
  const backlinkMap: Record<string, string[]> = {}
  const unresolvedMap: Record<string, string[]> = {}

  for (const [src, meta] of Object.entries(files)) {
    for (const target of meta.outLinks) {
      const resolved = resolveLink(target, stemIndex, files)
      if (resolved) {
        ;(backlinkMap[resolved] ??= []).push(src)
      } else {
        ;(unresolvedMap[target] ??= []).push(src)
      }
    }
  }
  return { backlinkMap, unresolvedMap }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/lib/__tests__/knowledgeUtils.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors (nothing imports `buildBacklinkMap` yet — that's fixed in later tasks).

- [ ] **Step 6: Commit**

```bash
git add src/lib/knowledgeUtils.ts src/lib/__tests__/knowledgeUtils.test.ts
git commit -m "feat: add buildStemIndex, resolveLink, buildLinkMaps to knowledgeUtils"
```

---

### Task 2: Add `unresolvedMap` to types and initial state

**Files:**
- Modify: `src/stores/types.ts` lines 95–100
- Modify: `src/stores/vaultStore.ts` lines 9–14

- [ ] **Step 1: Update `VaultState` in `types.ts`**

Change:

```ts
export interface VaultState {
  files: Record<string, FileMeta>
  backlinkMap: Record<string, string[]>
  tagMap: Record<string, string[]>
  taskMap: Record<string, TaskItem[]>
}
```

To:

```ts
export interface VaultState {
  files: Record<string, FileMeta>
  backlinkMap: Record<string, string[]>
  unresolvedMap: Record<string, string[]>
  tagMap: Record<string, string[]>
  taskMap: Record<string, TaskItem[]>
}
```

- [ ] **Step 2: Add `unresolvedMap` to initial store state in `vaultStore.ts`**

Change:

```ts
const [vaultStore, setVaultStore] = createStore<VaultState>({
  files: {},
  backlinkMap: {},
  tagMap: {},
  taskMap: {},
})
```

To:

```ts
const [vaultStore, setVaultStore] = createStore<VaultState>({
  files: {},
  backlinkMap: {},
  unresolvedMap: {},
  tagMap: {},
  taskMap: {},
})
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors (or only errors about missing `buildBacklinkMap` import — handled next).

- [ ] **Step 4: Commit**

```bash
git add src/stores/types.ts src/stores/vaultStore.ts
git commit -m "feat: add unresolvedMap to VaultState"
```

---

### Task 3: Update `runPhase2` to use `buildLinkMaps`

**Files:**
- Modify: `src/services/vaultIndexer.ts` lines 10–13 and 162–168

- [ ] **Step 1: Replace `buildBacklinkMap` import with `buildLinkMaps`**

In `src/services/vaultIndexer.ts`, change the import at lines 10–13:

```ts
import {
  extractTags, extractAliases, mergeTagsWithBody, buildBacklinkMap, buildTagMap,
  extractDateString, extractDateFromName, buildTaskMap,
} from '../lib/knowledgeUtils'
```

To:

```ts
import {
  extractTags, extractAliases, mergeTagsWithBody, buildLinkMaps, buildTagMap,
  extractDateString, extractDateFromName, buildTaskMap,
} from '../lib/knowledgeUtils'
```

- [ ] **Step 2: Update `runPhase2`**

Change (lines 162–168):

```ts
function runPhase2(): void {
  const mdFiles = Object.fromEntries(
    Object.entries(vaultStore.files).filter(([p]) => p.endsWith('.md')),
  )
  setVaultStore('backlinkMap', buildBacklinkMap(mdFiles))
  setVaultStore('tagMap', buildTagMap(mdFiles))
  setVaultStore('taskMap', buildTaskMap(mdFiles))
}
```

To:

```ts
function runPhase2(): void {
  const mdFiles = Object.fromEntries(
    Object.entries(vaultStore.files).filter(([p]) => p.endsWith('.md')),
  )
  const { backlinkMap, unresolvedMap } = buildLinkMaps(mdFiles)
  setVaultStore('backlinkMap', backlinkMap)
  setVaultStore('unresolvedMap', unresolvedMap)
  setVaultStore('tagMap', buildTagMap(mdFiles))
  setVaultStore('taskMap', buildTaskMap(mdFiles))
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/services/vaultIndexer.ts
git commit -m "feat: use buildLinkMaps in runPhase2, populate unresolvedMap on startup"
```

---

### Task 4: Update `applyContent` and `removeVaultEntry` for incremental updates

**Files:**
- Modify: `src/stores/vaultStore.ts` lines 6, 20–48, 101–110

- [ ] **Step 1: Add `buildStemIndex` and `resolveLink` to the import in `vaultStore.ts`**

Change line 6:

```ts
import { extractTags, extractAliases, mergeTagsWithBody, extractDateString } from '../lib/knowledgeUtils'
```

To:

```ts
import { extractTags, extractAliases, mergeTagsWithBody, extractDateString, buildStemIndex, resolveLink } from '../lib/knowledgeUtils'
```

- [ ] **Step 2: Update `applyContent` to resolve links against both maps**

Replace the existing `applyContent` function (lines 20–48):

```ts
function applyContent(path: string, hash: string, content: ContentFields): void {
  const prev = vaultStore.files[path]
  setVaultStore('files', path, (f: FileMeta) => ({ ...f, hash, ...content }))

  const stemIndex = buildStemIndex(vaultStore.files)

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
```

- [ ] **Step 3: Update `removeVaultEntry` to cascade backlinks to `unresolvedMap`**

Replace `removeVaultEntry` (lines 101–110):

```ts
removeVaultEntry(path: string): void {
  const file = vaultStore.files[path]
  if (!file) return

  // Move all files that linked TO this path into unresolvedMap
  const backlinks = vaultStore.backlinkMap[path] ?? []
  if (backlinks.length > 0) {
    setVaultStore('unresolvedMap', path, (list: string[]) => [...(list ?? []), ...backlinks])
    setVaultStore('backlinkMap', path, [])
  }

  // Remove this file's own outLinks from backlinkMap/unresolvedMap
  const stemIndex = buildStemIndex(vaultStore.files)
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
},
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/stores/vaultStore.ts
git commit -m "feat: resolve links in applyContent/removeVaultEntry, cascade to unresolvedMap on delete"
```

---

### Task 5: File creation cascade + simplify `updateBacklinks`

**Files:**
- Modify: `src/stores/runtimeStore.ts`

Context: when a new file is created at `path`, any existing entries in `unresolvedMap` whose key matches the new file's stem or full path should be moved to `backlinkMap[path]`.

- [ ] **Step 1: Add `buildStemIndex` import to `runtimeStore.ts`**

Find the existing imports from `knowledgeUtils` in `src/stores/runtimeStore.ts` and add `buildStemIndex`:

```ts
import { buildStemIndex } from './vaultStore'
```

Actually `buildStemIndex` is in `knowledgeUtils`. Check the existing import line (search for `knowledgeUtils` in the file) and add it there. If not imported yet, add:

```ts
import { buildStemIndex } from '../lib/knowledgeUtils'
```

- [ ] **Step 2: Add `resolveUnresolved` helper in `runtimeStore.ts` (local, not exported)**

Add this function before `fileActions`:

```ts
function resolveUnresolved(newPath: string): void {
  // newPath e.g. "notes/ghost.md"
  const stem = newPath.split('/').pop()!  // "ghost.md"
  const keysToCheck = newPath !== stem ? [newPath, stem] : [newPath]
  for (const key of keysToCheck) {
    const sources = vaultStore.unresolvedMap[key] ?? []
    if (sources.length === 0) continue
    setVaultStore('backlinkMap', newPath, (list: string[]) => [...(list ?? []), ...sources])
    setVaultStore('unresolvedMap', key, [])
  }
}
```

- [ ] **Step 3: Call `resolveUnresolved` at the end of `createFile`**

In `fileActions.createFile`, after `setVaultStore('files', path, entry)`, add:

```ts
resolveUnresolved(path)
```

The full tail of `createFile` should look like:

```ts
    setVaultStore('files', path, entry)
    resolveUnresolved(path)
    return path
  },
```

- [ ] **Step 4: Simplify `updateBacklinks` — remove stem workaround**

The old `updateBacklinks` checked both `oldPath` and `stem` because backlinkMap keys were raw strings. With resolved backlinkMap, only `oldPath` is needed:

Replace `updateBacklinks` (lines 91–110 approximately):

```ts
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
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/stores/runtimeStore.ts
git commit -m "feat: cascade unresolvedMap on file create, simplify updateBacklinks"
```

---

### Task 6: Simplify `LinksPanel` backlinks query

**Files:**
- Modify: `src/plugins/links/index.tsx` lines 15–31

The alias lookup remains, but we no longer need a stem-key fallback (that was covering for unresolved stem links). With the resolved `backlinkMap`, `backlinkMap[path]` already covers all stem-resolved backlinks.

- [ ] **Step 1: Update the `backlinks` memo**

Replace the current `backlinks` memo (lines 15–31):

```ts
const backlinks = createMemo(() => {
  const path = activeFilePath()
  if (!path) return []
  const aliases = vaultStore.files[path]?.aliases ?? []
  const keys = [path, ...aliases, ...aliases.map((a) => `${a}.md`)]
  const seen = new Set<string>()
  const result: string[] = []
  for (const key of keys) {
    for (const bl of vaultStore.backlinkMap[key] ?? []) {
      if (!seen.has(bl)) {
        seen.add(bl)
        result.push(bl)
      }
    }
  }
  return result
})
```

With (alias lookup kept for alias-based links, stem workaround dropped):

```ts
const backlinks = createMemo(() => {
  const path = activeFilePath()
  if (!path) return []
  const aliases = vaultStore.files[path]?.aliases ?? []
  // backlinkMap[path] covers stem-resolved links; alias keys cover [[Alias Name]] links
  const keys = [path, ...aliases.map((a) => `${a}.md`)]
  const seen = new Set<string>()
  const result: string[] = []
  for (const key of keys) {
    for (const bl of vaultStore.backlinkMap[key] ?? []) {
      if (!seen.has(bl)) { seen.add(bl); result.push(bl) }
    }
  }
  return result
})
```

- [ ] **Step 2: Type-check + run all tests**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: no type errors, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/plugins/links/index.tsx
git commit -m "refactor: simplify LinksPanel backlinks query now that backlinkMap uses full paths"
```

---

## Self-Review

**Spec coverage:**
- ✅ Recording outLinks per file — unchanged, `FileMeta.outLinks` stays as raw strings
- ✅ backlinkMap keyed by resolved full path — Task 1 (`buildLinkMaps`) + Task 3 (`runPhase2`) + Task 4 (`applyContent`)
- ✅ unresolvedMap for links pointing to non-existent files — Tasks 1–4
- ✅ File creation cascade (unresolvedMap → backlinkMap) — Task 5
- ✅ File deletion cascade (backlinkMap → unresolvedMap) — Task 4 (`removeVaultEntry`)
- ✅ Expose `getBacklinks` via `backlinkMap[path]` — Task 6

**Type consistency:** `buildStemIndex`, `resolveLink`, `buildLinkMaps` defined in Task 1 and imported consistently in Tasks 3, 4, 5.

**Not in scope:** Alias-based resolution (i.e., `[[My Alias]]` → file with `aliases: ["My Alias"]`) — alias fallback in LinksPanel is preserved but not enhanced.
