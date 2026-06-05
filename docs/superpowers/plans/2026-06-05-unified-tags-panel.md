# Unified Tags Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the Tags and Search panels into a single Tags panel that inline-expands file entries on click, and add `etags` (original unexpanded tags) to `FileMeta`.

**Architecture:** Data layer first — add `etags` field to `FileMeta`, `CachedFields`, and `EMPTY_CONTENT`, then compute it in `runPhase1`. UI layer second — rewrite `TagsPanel` with two independent `Set<string>` signals: `collapsed` (subtag tree fold) and `expandedFiles` (inline file list). No changes to the Search plugin or `tagMap`.

**Tech Stack:** SolidJS (signals, `createMemo`, `createSignal`), TypeScript, Vitest

---

## Files Changed

| File | Change |
|---|---|
| `src/stores/types.ts` | Add `etags: string[]` to `FileMeta` |
| `src/vault/indexStorage.ts` | Add `etags` to `CachedFields` Pick |
| `src/vault/scan.ts` | Add `etags: []` to `EMPTY_CONTENT`; compute `etags` in `runPhase1` |
| `src/vault/__tests__/scan.test.ts` | New test file for `extractTags` / `mergeTagsWithBody` / etags logic |
| `src/plugins/tags/index.tsx` | Rewrite `TagsPanel` with inline file expansion |

---

### Task 1: Add `etags` to type definitions

**Files:**
- Modify: `src/stores/types.ts`
- Modify: `src/vault/indexStorage.ts`

- [ ] **Step 1: Add `etags` field to `FileMeta` in `src/stores/types.ts`**

  Open `src/stores/types.ts`. Find the `FileMeta` interface (around line 77). Add `etags` immediately before `tags`:

  ```ts
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
    etags: string[]    // original tags, not expanded
    tags: string[]
    aliases: string[]
    created: string
    updated: string | null
    dated: string
    tasks: TaskItem[]
  }
  ```

- [ ] **Step 2: Add `etags` to `CachedFields` in `src/vault/indexStorage.ts`**

  Open `src/vault/indexStorage.ts`. Find the `CachedFields` type (line 4). Add `etags` to the Pick:

  ```ts
  export type CachedFields = Pick<FileMeta,
    'frontmatter' | 'outLinks' | 'etags' | 'tags' | 'aliases' | 'created' | 'updated' | 'dated' | 'tasks'
  >
  ```

- [ ] **Step 3: Verify TypeScript compiles**

  Run: `npx tsc --noEmit`

  Expected: no errors (the scan.ts `EMPTY_CONTENT` will error until Task 2 — that's expected now, proceed to Task 2 immediately)

- [ ] **Step 4: Commit**

  ```bash
  git add src/stores/types.ts src/vault/indexStorage.ts
  git commit -m "feat: add etags field to FileMeta and CachedFields"
  ```

---

### Task 2: Compute `etags` in `scan.ts`

**Files:**
- Modify: `src/vault/scan.ts`
- Create: `src/vault/__tests__/scan.test.ts`

- [ ] **Step 1: Write failing tests**

  Create `src/vault/__tests__/scan.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest'
  import { extractTags, mergeTagsWithBody } from '../scan'

  describe('extractTags', () => {
    it('returns array as-is', () => {
      expect(extractTags(['dev/frontend', 'writing'])).toEqual(['dev/frontend', 'writing'])
    })
    it('splits comma-separated string', () => {
      expect(extractTags('a, b, c')).toEqual(['a', 'b', 'c'])
    })
    it('returns [] for falsy input', () => {
      expect(extractTags(undefined)).toEqual([])
      expect(extractTags(null)).toEqual([])
    })
  })

  describe('mergeTagsWithBody', () => {
    it('expands nested frontmatter tags', () => {
      expect(mergeTagsWithBody(['dev/frontend'], [])).toEqual(
        expect.arrayContaining(['dev', 'dev/frontend'])
      )
    })
    it('includes inline tags without expansion', () => {
      const result = mergeTagsWithBody([], ['writing'])
      expect(result).toContain('writing')
    })
    it('expands inline nested tags', () => {
      const result = mergeTagsWithBody([], ['a/b/c'])
      expect(result).toEqual(expect.arrayContaining(['a', 'a/b', 'a/b/c']))
    })
    it('deduplicates overlapping tags', () => {
      const result = mergeTagsWithBody(['dev'], ['dev'])
      expect(result.filter(t => t === 'dev')).toHaveLength(1)
    })
  })

  describe('etags computation', () => {
    it('etags = fmTags + inlineTags, not expanded', () => {
      const fmTags = extractTags(['dev/frontend'])
      const inlineTags = ['writing']
      const etags = [...new Set([...fmTags, ...inlineTags])]
      expect(etags).toEqual(['dev/frontend', 'writing'])
      // must NOT contain the expanded parent 'dev'
      expect(etags).not.toContain('dev')
    })
    it('deduplicates etags when fm and inline overlap', () => {
      const fmTags = extractTags(['note'])
      const inlineTags = ['note']
      const etags = [...new Set([...fmTags, ...inlineTags])]
      expect(etags.filter(t => t === 'note')).toHaveLength(1)
    })
    it('tags (expanded) is superset of etags for nested tags', () => {
      const fmTags = extractTags(['a/b'])
      const inlineTags: string[] = []
      const etags = [...new Set([...fmTags, ...inlineTags])]
      const tags  = mergeTagsWithBody(fmTags, inlineTags)
      expect(etags).toEqual(['a/b'])
      expect(tags).toEqual(expect.arrayContaining(['a', 'a/b']))
    })
  })
  ```

- [ ] **Step 2: Run tests to verify they fail (extractTags/mergeTagsWithBody not yet imported via test)**

  Run: `npx vitest run src/vault/__tests__/scan.test.ts`

  Expected: PASS — these functions already exist and the etags computation is pure inline logic. If any fail, check import path.

- [ ] **Step 3: Update `EMPTY_CONTENT` in `src/vault/scan.ts`**

  Open `src/vault/scan.ts`. Find `EMPTY_CONTENT` (around line 75). Add `etags: []`:

  ```ts
  const EMPTY_CONTENT: Pick<
    FileMeta,
    'frontmatter' | 'outLinks' | 'etags' | 'tags' | 'aliases' | 'updated' | 'tasks'
  > = {
    frontmatter: {},
    outLinks: [],
    etags: [],
    tags: [],
    aliases: [],
    updated: null,
    tasks: [],
  }
  ```

- [ ] **Step 4: Compute `etags` in `runPhase1`**

  In `src/vault/scan.ts`, find the section inside `runPhase1` that computes `parsed` (around line 193). Replace:

  ```ts
  const parsed = {
    frontmatter,
    outLinks,
    tags: mergeTagsWithBody(extractTags(frontmatter.tags), inlineTags),
    aliases: extractAliases(frontmatter.aliases),
    created,
    updated,
    dated,
    tasks,
  }
  ```

  With:

  ```ts
  const fmTags = extractTags(frontmatter.tags)
  const etags  = [...new Set([...fmTags, ...inlineTags])]
  const tags   = mergeTagsWithBody(fmTags, inlineTags)
  const parsed = {
    frontmatter,
    outLinks,
    etags,
    tags,
    aliases: extractAliases(frontmatter.aliases),
    created,
    updated,
    dated,
    tasks,
  }
  ```

- [ ] **Step 5: Verify TypeScript compiles**

  Run: `npx tsc --noEmit`

  Expected: no errors

- [ ] **Step 6: Run all tests**

  Run: `npx vitest run`

  Expected: all pass

- [ ] **Step 7: Commit**

  ```bash
  git add src/vault/scan.ts src/vault/__tests__/scan.test.ts
  git commit -m "feat: compute etags (original unexpanded tags) in scan.ts"
  ```

---

### Task 3: Rewrite TagsPanel with inline file expansion

**Files:**
- Modify: `src/plugins/tags/index.tsx`

- [ ] **Step 1: Replace the full contents of `src/plugins/tags/index.tsx`**

  ```tsx
  import { createMemo, createSignal, For, Show } from 'solid-js'
  import { vaultStore } from '../../vault'
  import { workspaceActions } from '../../stores/workspaceStore'
  import { definePlugin } from '../../lib/pluginRegistry'

  interface TagNode {
    segment: string
    fullTag: string
    count: number
    children: TagNode[]
  }

  function buildTagTree(tagMap: Record<string, string[]>): TagNode[] {
    const tagged: Record<string, number> = {}
    for (const [tag, files] of Object.entries(tagMap)) {
      if (files?.length) tagged[tag] = files.length
    }

    function buildLevel(prefix: string): TagNode[] {
      const seen = new Map<string, string>()
      for (const tag of Object.keys(tagged)) {
        const rest = prefix
          ? tag.startsWith(prefix + '/') ? tag.slice(prefix.length + 1) : null
          : tag
        if (rest === null) continue
        const segment = rest.split('/')[0]
        const fullTag = prefix ? `${prefix}/${segment}` : segment
        if (!seen.has(segment)) seen.set(segment, fullTag)
      }
      return [...seen.entries()]
        .map(([segment, fullTag]) => ({
          segment,
          fullTag,
          count: tagged[fullTag] ?? 0,
          children: buildLevel(fullTag),
        }))
        .sort((a, b) => a.segment.localeCompare(b.segment))
    }

    return buildLevel('')
  }

  function subtreeCount(node: TagNode): number {
    return node.count + node.children.reduce((s, c) => s + subtreeCount(c), 0)
  }

  function getFilesForTag(tagMap: Record<string, string[]>, tag: string): string[] {
    const paths = new Set<string>()
    for (const [k, files] of Object.entries(tagMap)) {
      if (k === tag || k.startsWith(tag + '/')) {
        for (const f of files) paths.add(f)
      }
    }
    return [...paths].sort()
  }

  function displayName(path: string): string {
    const name = path.split('/').pop() ?? path
    return name.endsWith('.md') ? name.slice(0, -3) : name
  }

  function TagTreeNode(props: {
    node: TagNode
    depth: number
    collapsed: Set<string>
    expandedFiles: Set<string>
    onToggleCollapse: (tag: string) => void
    onToggleFiles: (tag: string) => void
    tagMap: Record<string, string[]>
  }) {
    const hasChildren = () => props.node.children.length > 0
    const isCollapsed = () => props.collapsed.has(props.node.fullTag)
    const isFilesExpanded = () => props.expandedFiles.has(props.node.fullTag)
    const total = () => subtreeCount(props.node)
    const files = () => isFilesExpanded()
      ? getFilesForTag(props.tagMap, props.node.fullTag)
      : []

    return (
      <div>
        <div
          class="flex items-center gap-1 py-0.5 rounded cursor-pointer hover:bg-(--bg-hover) text-[11px] select-none"
          style={{ 'padding-left': `${8 + props.depth * 12}px`, 'padding-right': '8px' }}
          onClick={() => props.onToggleFiles(props.node.fullTag)}
        >
          <span
            class="w-3 shrink-0 text-center text-(--text-4) text-[9px]"
            onClick={(e) => {
              if (!hasChildren()) return
              e.stopPropagation()
              props.onToggleCollapse(props.node.fullTag)
            }}
          >
            {hasChildren() ? (isCollapsed() ? '▶' : '▼') : ''}
          </span>
          <span class="text-(--text-4)">#</span>
          <span class="flex-1 text-(--text-2)">{props.node.segment}</span>
          <span class="text-(--text-4) text-[10px]">{total()}</span>
        </div>
        <Show when={isFilesExpanded()}>
          <For each={files()}>
            {(path) => (
              <div
                class="truncate text-[11px] cursor-pointer hover:bg-(--bg-hover) text-(--text-2) py-0.5"
                style={{
                  'padding-left': `${8 + (props.depth + 1) * 12 + 4}px`,
                  'padding-right': '8px',
                }}
                title={path}
                onClick={() => workspaceActions.openFile(path)}
              >
                {displayName(path)}
              </div>
            )}
          </For>
        </Show>
        <Show when={hasChildren() && !isCollapsed()}>
          <For each={props.node.children}>
            {(child) => (
              <TagTreeNode
                node={child}
                depth={props.depth + 1}
                collapsed={props.collapsed}
                expandedFiles={props.expandedFiles}
                onToggleCollapse={props.onToggleCollapse}
                onToggleFiles={props.onToggleFiles}
                tagMap={props.tagMap}
              />
            )}
          </For>
        </Show>
      </div>
    )
  }

  function TagsPanel() {
    const [collapsed, setCollapsed] = createSignal(new Set<string>())
    const [expandedFiles, setExpandedFiles] = createSignal(new Set<string>())
    const roots = createMemo(() => buildTagTree(vaultStore.tagMap))

    function toggleCollapse(tag: string) {
      setCollapsed(prev => {
        const next = new Set(prev)
        next.has(tag) ? next.delete(tag) : next.add(tag)
        return next
      })
    }

    function toggleFiles(tag: string) {
      setExpandedFiles(prev => {
        const next = new Set(prev)
        next.has(tag) ? next.delete(tag) : next.add(tag)
        return next
      })
    }

    return (
      <div class="py-1 overflow-y-auto h-full">
        <Show
          when={roots().length > 0}
          fallback={<div class="px-3 py-2 text-[11px] text-(--text-4) italic">暂无标签</div>}
        >
          <For each={roots()}>
            {(node) => (
              <TagTreeNode
                node={node}
                depth={0}
                collapsed={collapsed()}
                expandedFiles={expandedFiles()}
                onToggleCollapse={toggleCollapse}
                onToggleFiles={toggleFiles}
                tagMap={vaultStore.tagMap}
              />
            )}
          </For>
        </Show>
      </div>
    )
  }

  export const TagsPlugin = definePlugin({
    id: 'tags',
    name: '标签',
    core: true,
    setup(ctx) {
      ctx.view({
        kind: 'panel',
        position: 'right',
        type: 'tags',
        getDisplayText: () => '标签',
        component: TagsPanel,
      })
    },
  })
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  Run: `npx tsc --noEmit`

  Expected: no errors

- [ ] **Step 3: Run all tests**

  Run: `npx vitest run`

  Expected: all pass

- [ ] **Step 4: Commit**

  ```bash
  git add src/plugins/tags/index.tsx
  git commit -m "feat: unified tags panel with inline file expansion"
  ```
