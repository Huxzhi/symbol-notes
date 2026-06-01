# Files Panel Virtual Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the recursive `FileTreeNode` renderer in `FilesPanel` with `@tanstack/solid-virtual` virtual scrolling, so 5000+ file vaults render without lag.

**Architecture:** Flatten the visible tree into a `FlatRow[]` memo (depth-annotated), feed it into `createVirtualizer` from `@tanstack/solid-virtual`, render only the rows in the viewport via absolute positioning. Drag-and-drop target resolution is extended so file rows resolve to their parent directory.

**Tech Stack:** SolidJS, `@tanstack/solid-virtual`, Vitest, Tailwind CSS

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `src/plugins/files/treeUtils.ts` | `FlatRow`, `flattenTree`, `resolveDropTarget`, `isOtherFile` |
| Create | `src/plugins/files/__tests__/treeUtils.test.ts` | Unit tests for treeUtils |
| Modify | `src/plugins/files/FilesPanel.tsx` | Replace FileTreeNode with FileRow + virtualizer |

---

## Task 1: Install `@tanstack/solid-virtual`

**Files:**
- Modify: `package.json` (via npm)

- [ ] **Step 1: Install the package**

```bash
npm add @tanstack/solid-virtual
```

- [ ] **Step 2: Verify it's in package.json**

```bash
grep "solid-virtual" package.json
```

Expected output: `"@tanstack/solid-virtual": "^0.x.x"` (version may vary)

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @tanstack/solid-virtual"
```

---

## Task 2: Write failing tests for treeUtils

**Files:**
- Create: `src/plugins/files/__tests__/treeUtils.test.ts`

- [ ] **Step 1: Create test file**

```typescript
// src/plugins/files/__tests__/treeUtils.test.ts
import { describe, it, expect } from 'vitest'
import { flattenTree, resolveDropTarget } from '../treeUtils'
import type { FileMeta } from '../../../stores/types'

function m(
  overrides: Pick<FileMeta, 'name' | 'path' | 'kind' | 'parent'>,
): FileMeta {
  return {
    size: 0, mtime: 0, hash: '',
    frontmatter: {}, outLinks: [], tags: [], aliases: [],
    created: '2026-01-01', updated: null, dated: '2026-01-01', tasks: [],
    ...overrides,
  }
}

const files: Record<string, FileMeta> = {
  'a.md':   m({ name: 'a.md',   path: 'a.md',        kind: 'file',      parent: null }),
  'b.md':   m({ name: 'b.md',   path: 'b.md',        kind: 'file',      parent: null }),
  'dir1':   m({ name: 'dir1',   path: 'dir1',        kind: 'directory', parent: null }),
  'dir1/c.md': m({ name: 'c.md', path: 'dir1/c.md', kind: 'file',      parent: 'dir1' }),
  'img.png': m({ name: 'img.png', path: 'img.png',   kind: 'file',      parent: null }),
}

describe('flattenTree', () => {
  it('puts directories before files, alphabetical within each group', () => {
    const rows = flattenTree(null, 0, [], files, true)
    expect(rows[0].entry.path).toBe('dir1')
    expect(rows[1].entry.path).toBe('a.md')
    expect(rows[2].entry.path).toBe('b.md')
    expect(rows[3].entry.path).toBe('img.png')
  })

  it('includes children of expanded folders with depth + 1', () => {
    const rows = flattenTree(null, 0, [], files, true)
    const dir = rows.find(r => r.entry.path === 'dir1')!
    const child = rows.find(r => r.entry.path === 'dir1/c.md')!
    expect(dir.depth).toBe(0)
    expect(child.depth).toBe(1)
  })

  it('child immediately follows parent in output order', () => {
    const rows = flattenTree(null, 0, [], files, true)
    const dirIdx = rows.findIndex(r => r.entry.path === 'dir1')
    const childIdx = rows.findIndex(r => r.entry.path === 'dir1/c.md')
    expect(childIdx).toBe(dirIdx + 1)
  })

  it('excludes children of collapsed folders', () => {
    const rows = flattenTree(null, 0, ['dir1'], files, true)
    expect(rows.find(r => r.entry.path === 'dir1/c.md')).toBeUndefined()
    expect(rows.find(r => r.entry.path === 'dir1')).toBeDefined()
  })

  it('skips non-md files when showOtherFiles is false', () => {
    const rows = flattenTree(null, 0, [], files, false)
    expect(rows.find(r => r.entry.path === 'img.png')).toBeUndefined()
  })

  it('includes non-md files when showOtherFiles is true', () => {
    const rows = flattenTree(null, 0, [], files, true)
    expect(rows.find(r => r.entry.path === 'img.png')).toBeDefined()
  })

  it('returns empty array for empty files map', () => {
    expect(flattenTree(null, 0, [], {}, false)).toEqual([])
  })
})

describe('resolveDropTarget', () => {
  it('returns own path for a directory entry', () => {
    const dir = m({ name: 'dir1', path: 'dir1', kind: 'directory', parent: null })
    expect(resolveDropTarget(dir)).toBe('dir1')
  })

  it('returns parent path for a file inside a folder', () => {
    const file = m({ name: 'c.md', path: 'dir1/c.md', kind: 'file', parent: 'dir1' })
    expect(resolveDropTarget(file)).toBe('dir1')
  })

  it('returns null for a root-level file', () => {
    const file = m({ name: 'a.md', path: 'a.md', kind: 'file', parent: null })
    expect(resolveDropTarget(file)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL with "Cannot find module '../treeUtils'"**

```bash
npx vitest run src/plugins/files/__tests__/treeUtils.test.ts
```

Expected: test collection error (module not found). This confirms the test is wired up correctly before implementation.

---

## Task 3: Implement `treeUtils.ts`

**Files:**
- Create: `src/plugins/files/treeUtils.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/plugins/files/treeUtils.ts
import type { FileMeta } from '../../stores/types'

export interface FlatRow {
  entry: FileMeta
  depth: number
}

const MD_EXT = '.md'

export function isOtherFile(name: string): boolean {
  return !name.endsWith(MD_EXT)
}

function childrenOf(
  parentPath: string | null,
  files: Record<string, FileMeta>,
): FileMeta[] {
  return Object.values(files)
    .filter(e => e.parent === parentPath)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

export function flattenTree(
  parentPath: string | null,
  depth: number,
  collapsed: string[],
  files: Record<string, FileMeta>,
  showOtherFiles: boolean,
): FlatRow[] {
  const rows: FlatRow[] = []
  for (const entry of childrenOf(parentPath, files)) {
    if (entry.kind === 'file' && isOtherFile(entry.name) && !showOtherFiles) continue
    rows.push({ entry, depth })
    if (entry.kind === 'directory' && !collapsed.includes(entry.path)) {
      rows.push(...flattenTree(entry.path, depth + 1, collapsed, files, showOtherFiles))
    }
  }
  return rows
}

export function resolveDropTarget(entry: FileMeta): string | null {
  return entry.kind === 'directory' ? entry.path : entry.parent
}
```

- [ ] **Step 2: Run tests — expect all PASS**

```bash
npx vitest run src/plugins/files/__tests__/treeUtils.test.ts
```

Expected:
```
✓ src/plugins/files/__tests__/treeUtils.test.ts (10)
  ✓ flattenTree (7)
  ✓ resolveDropTarget (3)
```

- [ ] **Step 3: Commit**

```bash
git add src/plugins/files/treeUtils.ts src/plugins/files/__tests__/treeUtils.test.ts
git commit -m "feat: add flattenTree and resolveDropTarget for virtual scroll"
```

---

## Task 4: Rewrite `FilesPanel.tsx` with virtual scrolling

**Files:**
- Modify: `src/plugins/files/FilesPanel.tsx`

This task rewrites the file in full. The complete new file is shown below.

Key changes vs current:
- Remove `MD_EXT`, `isOtherFile`, `childrenOf` (moved to treeUtils)
- Remove `FileTreeNode` (recursive component, replaced by flat `FileRow`)
- Add `FileRow` (single-row, no children, positions via `style` prop)
- Add `ROW_HEIGHT = 22` constant
- Add `flatRows` memo via `flattenTree`
- Wire `createVirtualizer` with `scrollEl` ref
- Add `createEffect` to scroll to renamed item when rename op starts
- Replace `handleDirDragOver/Leave/Drop` with `handleRowDragOver/Leave/Drop` (using `resolveDropTarget`)
- Add `dragLeaveTimer` to prevent drag-over flicker between adjacent rows
- Move `<Show when={isCreating()}>` above the virtualizer div (outside the scroll height div)

- [ ] **Step 1: Replace FilesPanel.tsx with the new implementation**

```tsx
// src/plugins/files/FilesPanel.tsx
import { FolderOpen } from 'lucide-solid'
import { createEffect, createMemo, createSignal, For, JSX, Show } from 'solid-js'
import { createVirtualizer } from '@tanstack/solid-virtual'

import { appActions, fileActions } from '../../stores/runtimeStore'
import { workspaceActions } from '../../stores/workspaceStore'
import { computeWikiLink, isValidMoveDrop } from '../../lib/dragDropHelpers'
import { vaultStore } from '../../stores/vaultStore'
import { runtimeStore } from '../../stores/runtimeStore'
import { settingsStore } from '../../stores/settingsStore'
import { showError, showToast } from '../../stores/toastStore'
import { getFileViewForPath } from '../../lib/pluginRegistry'
import type { FileMeta, ViewComponentProps } from '../../stores/types'
import { activeFilePath } from '../../stores/workspaceStore'
import { flattenTree, resolveDropTarget, isOtherFile, type FlatRow } from './treeUtils'

export function toggleInArray(arr: string[], val: string): string[] {
  return arr.includes(val) ? arr.filter((p) => p !== val) : [...arr, val]
}

const ROW_HEIGHT = 22

function displayName(name: string): string {
  if (name.endsWith('.excalidraw.md')) return name.slice(0, -14)
  return name.endsWith('.md') ? name.slice(0, -3) : name
}

function canOpen(path: string): boolean {
  return getFileViewForPath(path) !== undefined
}

function FileRow(props: {
  row: FlatRow
  style: JSX.CSSProperties
  collapsedFolders: string[]
  onToggle: (path: string) => void
  dragSrc: () => string | null
  dragOver: () => string | null
  onDragStart: (e: DragEvent, entry: FileMeta) => void
  onDragEnd: () => void
  onRowDragOver: (e: DragEvent, entry: FileMeta) => void
  onRowDragLeave: (e: DragEvent) => void
  onRowDrop: (e: DragEvent, entry: FileMeta) => void
}) {
  const entry = () => props.row.entry
  const isActive = () => activeFilePath() === entry().path
  const isOther = () => entry().kind === 'file' && isOtherFile(entry().name)
  const isCollapsed = () =>
    entry().kind === 'directory' && props.collapsedFolders.includes(entry().path)
  const isRenaming = () =>
    runtimeStore.fileOp?.type === 'rename' &&
    (runtimeStore.fileOp as { path: string }).path === entry().path
  const isDragTarget = () =>
    entry().kind === 'directory' && props.dragOver() === entry().path

  const [renameValue, setRenameValue] = createSignal('')

  const confirmRename = async () => {
    const val = renameValue().trim()
    if (!val) {
      fileActions.cancelOp()
      return
    }
    try {
      await fileActions.commitRename(entry().path, val)
    } catch (err) {
      showError(err instanceof Error ? err.message : '重命名失败')
    }
  }

  const onRenameKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') void confirmRename()
    else if (e.key === 'Escape') fileActions.cancelOp()
  }

  return (
    <div
      data-ctx={entry().kind === 'directory' ? 'directory' : 'file'}
      data-path={entry().path}
      draggable={true}
      style={{
        ...props.style,
        'padding-left': `${6 + props.row.depth * 14}px`,
      }}
      class={`flex items-center gap-1 text-[11px] cursor-pointer hover:bg-(--bg-hover) select-none
        ${
          isActive()
            ? 'bg-(--bg-hover) border-l-2 border-(--accent) text-(--text)'
            : isOther()
              ? 'text-(--text-4) border-l-2 border-transparent'
              : 'text-(--text-2) border-l-2 border-transparent'
        }
        ${props.dragSrc() === entry().path ? 'opacity-50' : ''}
        ${isDragTarget() ? 'outline outline-(--accent-2) -outline-offset-1 bg-(--bg-hover) border-(--accent-2)!' : ''}
      `}
      onClick={() => {
        if (isRenaming()) return
        if (entry().kind === 'directory') {
          props.onToggle(entry().path)
          return
        }
        if (!canOpen(entry().path)) return
        workspaceActions.openFile(entry().path)
      }}
      onDblClick={() => {
        if (isRenaming()) return
        if (entry().kind !== 'file') return
        if (!canOpen(entry().path)) return
        workspaceActions.openFile(entry().path, { newTab: true, pin: true })
      }}
      onDragStart={(e) => props.onDragStart(e, entry())}
      onDragEnd={props.onDragEnd}
      onDragOver={(e) => props.onRowDragOver(e, entry())}
      onDragLeave={props.onRowDragLeave}
      onDrop={(e) => props.onRowDrop(e, entry())}
    >
      <Show when={entry().kind === 'directory'}>
        <span class="text-[9px] text-(--text-3)">
          {isCollapsed() ? '▸' : '▾'}
        </span>
      </Show>
      <Show
        when={isRenaming()}
        fallback={
          <span class={isActive() ? 'text-(--accent)' : ''}>
            {displayName(entry().name)}
          </span>
        }
      >
        <input
          class="flex-1 bg-(--bg-hover) border border-(--accent) rounded px-1 py-0 text-[11px] text-(--text) outline-none min-w-0"
          value={renameValue()}
          onInput={(e) => setRenameValue(e.currentTarget.value)}
          onKeyDown={onRenameKeyDown}
          onBlur={() => void confirmRename()}
          ref={(el) => {
            setRenameValue(displayName(entry().name))
            setTimeout(() => {
              el?.focus()
              el?.select()
            }, 0)
          }}
          onClick={(e) => e.stopPropagation()}
        />
      </Show>
    </div>
  )
}

export function FilesPanel(props: ViewComponentProps) {
  const collapsedFolders = () =>
    (props.viewState.collapsedFolders as string[] | undefined) ?? []

  const handleToggle = (path: string) => {
    workspaceActions.setLeafViewState(props.leafId, {
      type: 'files',
      state: {
        ...props.viewState,
        collapsedFolders: toggleInArray(collapsedFolders(), path),
      },
    })
  }

  const flatRows = createMemo(() =>
    flattenTree(null, 0, collapsedFolders(), vaultStore.files, settingsStore.showOtherFiles)
  )

  let scrollEl!: HTMLDivElement

  const virtualizer = createVirtualizer({
    get count() { return flatRows().length },
    getScrollElement: () => scrollEl,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })

  const [dragSrc, setDragSrc] = createSignal<string | null>(null)
  const [dragOver, setDragOver] = createSignal<string | null>(null)

  // Scroll to renamed item so the input is in the DOM
  createEffect(() => {
    const op = runtimeStore.fileOp
    if (op?.type === 'rename') {
      const path = (op as { path: string }).path
      const idx = flatRows().findIndex(r => r.entry.path === path)
      if (idx !== -1) virtualizer.scrollToIndex(idx, { align: 'auto' })
    }
  })

  const handleDragStart = (e: DragEvent, entry: FileMeta) => {
    setDragSrc(entry.path)
    e.dataTransfer!.setData('application/x-symbol-notes-file', entry.path)
    e.dataTransfer!.setData('text/plain', computeWikiLink(entry.name, entry.kind))
    e.dataTransfer!.effectAllowed = 'copyMove'

    const ghost = document.createElement('div')
    ghost.textContent = displayName(entry.name)
    Object.assign(ghost.style, {
      position: 'fixed', top: '-100px', left: '-100px',
      padding: '2px 8px', borderRadius: '4px', fontSize: '11px',
      background: 'var(--bg-hover)', color: 'var(--text)',
      border: '1px solid var(--accent)', whiteSpace: 'nowrap', pointerEvents: 'none',
    })
    document.body.appendChild(ghost)
    e.dataTransfer!.setDragImage(ghost, ghost.offsetWidth / 2, 12)
    setTimeout(() => ghost.remove(), 0)
  }

  const handleDragEnd = () => {
    setDragSrc(null)
    setDragOver(null)
  }

  let dragLeaveTimer: ReturnType<typeof setTimeout> | null = null

  const handleRowDragOver = (e: DragEvent, entry: FileMeta) => {
    e.stopPropagation()
    const src = dragSrc()
    if (!src) return
    const target = resolveDropTarget(entry)
    const srcEntry = vaultStore.files[src]
    if (!isValidMoveDrop(src, target, srcEntry?.parent ?? null)) return
    e.preventDefault()
    e.dataTransfer!.dropEffect = 'move'
    if (dragLeaveTimer) { clearTimeout(dragLeaveTimer); dragLeaveTimer = null }
    setDragOver(target)
  }

  const handleRowDragLeave = (_e: DragEvent) => {
    dragLeaveTimer = setTimeout(() => setDragOver(null), 0)
  }

  const handleRowDrop = async (e: DragEvent, entry: FileMeta) => {
    e.preventDefault()
    e.stopPropagation()
    const src = dragSrc()
    const target = resolveDropTarget(entry)
    setDragSrc(null)
    setDragOver(null)
    if (dragLeaveTimer) { clearTimeout(dragLeaveTimer); dragLeaveTimer = null }
    if (!src) return
    const srcEntry = vaultStore.files[src]
    if (!isValidMoveDrop(src, target, srcEntry?.parent ?? null)) return
    const srcName = displayName(srcEntry?.name ?? src.split('/').pop()!)
    const destName = target ? (target.split('/').pop() ?? target) : '根目录'
    try {
      await fileActions.moveEntry(src, target)
      showToast(`已移动 ${srcName} → ${destName}`)
    } catch (err) {
      showError(err instanceof Error ? err.message : '移动失败')
    }
  }

  const handleRootDragOver = (e: DragEvent) => {
    const src = dragSrc()
    if (!src) return
    const srcEntry = vaultStore.files[src]
    if (!isValidMoveDrop(src, null, srcEntry?.parent ?? null)) return
    e.preventDefault()
    e.dataTransfer!.dropEffect = 'move'
    if (dragLeaveTimer) { clearTimeout(dragLeaveTimer); dragLeaveTimer = null }
    setDragOver('__root__')
  }

  const handleRootDragLeave = (e: DragEvent) => {
    const rel = e.relatedTarget as Node | null
    if (rel && (e.currentTarget as Element).contains(rel)) return
    if (dragOver() === '__root__') setDragOver(null)
  }

  const handleRootDrop = async (e: DragEvent) => {
    e.preventDefault()
    const src = dragSrc()
    setDragSrc(null)
    setDragOver(null)
    if (!src) return
    const srcEntry = vaultStore.files[src]
    if (!isValidMoveDrop(src, null, srcEntry?.parent ?? null)) return
    const srcName = displayName(srcEntry?.name ?? src.split('/').pop()!)
    try {
      await fileActions.moveEntry(src, null)
      showToast(`已移动 ${srcName} → 根目录`)
    } catch (err) {
      showError(err instanceof Error ? err.message : '移动失败')
    }
  }

  const fileOp = () => runtimeStore.fileOp
  const isCreating = () =>
    fileOp()?.type === 'create-file' || fileOp()?.type === 'create-folder'

  const [createValue, setCreateValue] = createSignal('')

  const confirmCreate = async () => {
    const val = createValue().trim()
    if (!val) {
      fileActions.cancelOp()
      return
    }
    await fileActions.commitCreate(val)
  }

  const onCreateKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') void confirmCreate()
    else if (e.key === 'Escape') fileActions.cancelOp()
  }

  return (
    <div class="flex flex-col h-full relative">
      <div class="border-b border-(--border) shrink-0 flex items-center gap-0.5 pr-1 min-w-0">
        <button
          class="flex items-center gap-1.5 flex-1 px-2.5 py-2 text-left hover:bg-(--bg-hover) transition-colors min-w-0 group"
          onClick={() => void appActions.openVault()}
          title={runtimeStore.rootHandle ? '切换文件夹' : '打开文件夹'}
        >
          <FolderOpen size={12} class="shrink-0 text-(--accent) group-hover:text-(--accent-2)" />
          <span class="truncate text-[10px] text-(--accent) font-bold tracking-widest uppercase group-hover:text-(--accent-2)">
            {runtimeStore.rootHandle?.name ?? '打开文件夹'}
          </span>
        </button>
        <Show when={runtimeStore.rootHandle}>
          <button
            class="shrink-0 text-(--text-3) hover:text-(--accent-2) w-5 h-5 flex items-center justify-center rounded hover:bg-(--bg-hover) transition-colors text-[13px]"
            title="新建文件夹"
            onClick={() => { setCreateValue(''); fileActions.beginCreate('folder') }}
          >⊞</button>
          <button
            class="shrink-0 text-(--text-3) hover:text-(--accent-2) w-5 h-5 flex items-center justify-center rounded hover:bg-(--bg-hover) transition-colors"
            title="新建文件"
            onClick={() => { setCreateValue(''); fileActions.beginCreate('file') }}
          >+</button>
        </Show>
      </div>

      <div
        ref={scrollEl}
        class={`overflow-y-auto flex-1 ${dragOver() === '__root__' ? 'outline outline-1 outline-(--accent-2) outline-offset-[-2px]' : ''}`}
        onDragOver={handleRootDragOver}
        onDragLeave={handleRootDragLeave}
        onDrop={handleRootDrop}
      >
        <Show when={isCreating()}>
          <div class="flex items-center gap-1 px-2 py-1">
            <span class="text-[9px] text-(--text-3)">
              {fileOp()?.type === 'create-folder' ? '▸' : ''}
            </span>
            <input
              class="flex-1 bg-(--bg-hover) border border-(--accent) rounded px-1.5 py-0.5 text-[11px] text-(--text) outline-none min-w-0"
              placeholder={
                fileOp()?.type === 'create-folder'
                  ? '文件夹 或 父/子/文件夹'
                  : '文件名 或 目录/文件名'
              }
              value={createValue()}
              onInput={(e) => setCreateValue(e.currentTarget.value)}
              onKeyDown={onCreateKeyDown}
              onBlur={() => void confirmCreate()}
              ref={(el) => {
                const prefix = (fileOp() as { prefix?: string } | null)?.prefix ?? ''
                setCreateValue(prefix)
                setTimeout(() => el?.focus(), 0)
              }}
            />
          </div>
        </Show>

        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: 'relative',
            'margin-top': '4px',
          }}
        >
          <For each={virtualizer.getVirtualItems()}>
            {(vItem) => (
              <FileRow
                row={flatRows()[vItem.index]}
                style={{
                  position: 'absolute',
                  top: `${vItem.start}px`,
                  height: `${ROW_HEIGHT}px`,
                  width: '100%',
                }}
                collapsedFolders={collapsedFolders()}
                onToggle={handleToggle}
                dragSrc={dragSrc}
                dragOver={dragOver}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onRowDragOver={handleRowDragOver}
                onRowDragLeave={handleRowDragLeave}
                onRowDrop={handleRowDrop}
              />
            )}
          </For>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Check for TypeScript errors**

```bash
npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors. If there are errors, fix them before continuing (common issues: missing JSX import, wrong `createVirtualizer` API shape).

- [ ] **Step 3: Run existing tests to confirm no regressions**

```bash
npx vitest run
```

Expected: all tests pass (treeUtils + all pre-existing test suites).

- [ ] **Step 4: Commit**

```bash
git add src/plugins/files/FilesPanel.tsx
git commit -m "feat: virtual scroll in FilesPanel via @tanstack/solid-virtual"
```

---

## Task 5: Manual verification

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Open the app and open a vault folder**

Navigate to the app in the browser. Click "打开文件夹" and open a folder with many files.

- [ ] **Step 3: Verify basic rendering**

- Files and folders appear in the panel
- Folders before files, alphabetical order
- Folder expand/collapse works (clicking folder name)
- Active file is highlighted

- [ ] **Step 4: Verify virtual scrolling**

Open DevTools → Elements. Scroll the file panel. Confirm:
- Only ~viewport_height/22 + 20 rows exist in DOM at any time (not all files)
- The `div[style*="position: absolute"]` rows appear/disappear as you scroll

- [ ] **Step 5: Verify drag-and-drop**

- Drag a file onto a folder → file moves to that folder
- Drag a file onto another file → file moves to that file's parent folder
- Drag a file to empty space → file moves to root

- [ ] **Step 6: Verify rename**

Right-click a file → Rename. Confirm:
- The rename input appears in the panel (item scrolled into view if needed)
- Enter confirms, Escape cancels

- [ ] **Step 7: Verify new file/folder creation**

Click + (new file) or ⊞ (new folder). Confirm the input appears above the list.

- [ ] **Step 8: Commit any fixes found during verification, then final commit**

```bash
git add -p
git commit -m "fix: <describe any fixes found during manual testing>"
```
