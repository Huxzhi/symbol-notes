# FilesPanel Drag-and-Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add drag-and-drop to FilesPanel so files/folders can be moved between directories, and dragging into CM6 inserts `[[wikilink]]` syntax.

**Architecture:** Two new pure helper functions handle wiki-link text generation and drop validity checks (testable). Three new `fileActions` methods (`moveFile`, `moveFolder`, `moveEntry`) handle FS operations using read-copy-delete (native `FileSystemHandle.move()` is OPFS-only). FilesPanel gains local `dragSrc`/`dragOver` signals and drag event handlers on `FileTreeNode`.

**Tech Stack:** SolidJS signals, HTML5 Drag and Drop API, File System Access API, Vitest

---

## File Map

| File | Change |
|------|--------|
| `src/lib/dragDropHelpers.ts` | **Create** — `computeWikiLink`, `isValidMoveDrop` |
| `src/__tests__/dragDropHelpers.test.ts` | **Create** — unit tests for helpers |
| `src/stores/runtimeStore.ts` | **Modify** — add `moveFile`, `moveFolder`, `moveEntry` to `fileActions` |
| `src/components/panels/FilesPanel.tsx` | **Modify** — drag signals, events, visual feedback |

---

### Task 1: Pure helper functions + tests

**Files:**
- Create: `src/lib/dragDropHelpers.ts`
- Create: `src/__tests__/dragDropHelpers.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/dragDropHelpers.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeWikiLink, isValidMoveDrop } from '../lib/dragDropHelpers'

describe('computeWikiLink', () => {
  it('strips .md extension for markdown files', () => {
    expect(computeWikiLink('note.md', 'file')).toBe('[[note]]')
  })
  it('uses ![[]] for image files', () => {
    expect(computeWikiLink('photo.png', 'file')).toBe('![[photo.png]]')
  })
  it('uses ![[]] for all image extensions', () => {
    expect(computeWikiLink('a.jpg', 'file')).toBe('![[a.jpg]]')
    expect(computeWikiLink('b.webp', 'file')).toBe('![[b.webp]]')
    expect(computeWikiLink('c.svg', 'file')).toBe('![[c.svg]]')
  })
  it('uses [[]] for other file types', () => {
    expect(computeWikiLink('data.csv', 'file')).toBe('[[data.csv]]')
  })
  it('uses [[]] for directories', () => {
    expect(computeWikiLink('projects', 'directory')).toBe('[[projects]]')
  })
})

describe('isValidMoveDrop', () => {
  it('rejects drop onto current parent (no-op)', () => {
    expect(isValidMoveDrop('a/note.md', 'a', 'a')).toBe(false)
  })
  it('rejects drop onto self (folder → itself)', () => {
    expect(isValidMoveDrop('a/b', 'a/b', 'a')).toBe(false)
  })
  it('rejects drop into own descendant', () => {
    expect(isValidMoveDrop('a', 'a/b', null)).toBe(false)
    expect(isValidMoveDrop('a', 'a/b/c', null)).toBe(false)
  })
  it('rejects root-level file dropped back to root', () => {
    expect(isValidMoveDrop('note.md', null, null)).toBe(false)
  })
  it('accepts drop into a sibling folder', () => {
    expect(isValidMoveDrop('a/note.md', 'b', 'a')).toBe(true)
  })
  it('accepts drop to root from nested folder', () => {
    expect(isValidMoveDrop('a/note.md', null, 'a')).toBe(true)
  })
  it('accepts drop into a nested folder', () => {
    expect(isValidMoveDrop('note.md', 'a/b', null)).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/__tests__/dragDropHelpers.test.ts
```
Expected: FAIL with "Cannot find module '../lib/dragDropHelpers'"

- [ ] **Step 3: Create `src/lib/dragDropHelpers.ts`**

```ts
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif'])

export function computeWikiLink(name: string, kind: 'file' | 'directory'): string {
  if (kind === 'directory') return `[[${name}]]`
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  if (IMAGE_EXTS.has(ext)) return `![[${name}]]`
  if (name.endsWith('.md')) return `[[${name.slice(0, -3)}]]`
  return `[[${name}]]`
}

// Returns false when the move would be a no-op or invalid (cycle).
export function isValidMoveDrop(
  srcPath: string,
  destDirPath: string | null,
  srcParentPath: string | null,
): boolean {
  if (destDirPath === srcParentPath) return false
  if (destDirPath === srcPath) return false
  if (destDirPath !== null && destDirPath.startsWith(srcPath + '/')) return false
  return true
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/__tests__/dragDropHelpers.test.ts
```
Expected: all 12 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/dragDropHelpers.ts src/__tests__/dragDropHelpers.test.ts
git commit -m "feat: add dragDropHelpers (computeWikiLink, isValidMoveDrop)"
```

---

### Task 2: `fileActions.moveFile`

**Files:**
- Modify: `src/stores/runtimeStore.ts` (after `commitRename`, before closing brace of `fileActions`)

- [ ] **Step 1: Add `moveFile` to `fileActions` in `src/stores/runtimeStore.ts`**

Add after the `commitRename` method (line ~260):

```ts
  async moveFile(srcPath: string, destDirPath: string | null): Promise<void> {
    const { rootHandle } = runtimeStore
    if (!rootHandle) return
    const name = srcPath.split('/').pop()!
    const newPath = destDirPath ? `${destDirPath}/${name}` : name
    if (newPath === srcPath) return

    const oldContent = await readFile(srcPath)
    await writeFile(newPath, oldContent, true)

    const oldParts = srcPath.split('/')
    const oldFileName = oldParts.pop()!
    let oldDir: FileSystemDirectoryHandle = rootHandle
    for (const part of oldParts) oldDir = await oldDir.getDirectoryHandle(part)
    await oldDir.removeEntry(oldFileName)

    invalidateFile(srcPath)
    await deleteFileStatEntry(srcPath)

    const backlinks = cacheStore.backlinkMap[srcPath] ?? []
    cacheActions.removeCacheEntry(srcPath)
    setCacheStore('files', produce((m: Record<string, FileMeta>) => { delete m[srcPath] }))

    const entry: FileMeta = {
      name, path: newPath, kind: 'file', parent: destDirPath ?? null,
      size: 0, mtime: 0, hash: '', frontmatter: {}, outLinks: [], tags: [], aliases: [],
      created: new Date(0).toISOString().slice(0, 10),
      updated: null, dated: new Date(0).toISOString().slice(0, 10), tasks: [],
    }
    setCacheStore('files', newPath, entry)

    const { workspaceActions } = await import('./workspaceStore')
    workspaceActions.renameLeafPath(srcPath, newPath)
    await cacheActions.reindexFile(newPath, oldContent)
    await updateBacklinks(backlinks, srcPath, newPath)
  },
```

- [ ] **Step 2: Run full test suite to confirm no regressions**

```bash
npx vitest run
```
Expected: all existing tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/stores/runtimeStore.ts
git commit -m "feat: add fileActions.moveFile"
```

---

### Task 3: `fileActions.moveFolder` + `moveEntry`

**Files:**
- Modify: `src/stores/runtimeStore.ts` (after `moveFile`)

- [ ] **Step 1: Add `moveFolder` and `moveEntry` to `fileActions`**

Add after `moveFile`:

```ts
  async moveFolder(srcPath: string, destDirPath: string | null): Promise<void> {
    const { rootHandle } = runtimeStore
    if (!rootHandle) return
    const folderName = srcPath.split('/').pop()!
    const newFolderPath = destDirPath ? `${destDirPath}/${folderName}` : folderName
    if (newFolderPath === srcPath) return
    if (newFolderPath.startsWith(srcPath + '/')) return

    const descendants = Object.values(cacheStore.files).filter(
      e => e.path === srcPath || e.path.startsWith(srcPath + '/'),
    )
    const fileEntries = descendants.filter(e => e.kind === 'file')
    const dirEntries = descendants.filter(e => e.kind === 'directory')

    // Create new directory structure (sorted by depth so parents come first)
    const allNewDirs = [newFolderPath, ...dirEntries.map(
      e => newFolderPath + e.path.slice(srcPath.length),
    )].sort((a, b) => a.split('/').length - b.split('/').length)

    for (const dirPath of allNewDirs) {
      const parts = dirPath.split('/')
      let dir: FileSystemDirectoryHandle = rootHandle
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true })
    }

    // Copy each file to the new location
    const fileContents = new Map<string, string>()
    for (const entry of fileEntries) {
      const content = await readFile(entry.path)
      fileContents.set(entry.path, content)
      const newFilePath = newFolderPath + entry.path.slice(srcPath.length)
      await writeFile(newFilePath, content, true)
    }

    // Delete old folder in one shot
    const oldParts = srcPath.split('/')
    const oldFolderName = oldParts.pop()!
    let oldParentDir: FileSystemDirectoryHandle = rootHandle
    for (const part of oldParts) oldParentDir = await oldParentDir.getDirectoryHandle(part)
    await oldParentDir.removeEntry(oldFolderName, { recursive: true })

    // Invalidate old file caches
    for (const entry of fileEntries) {
      invalidateFile(entry.path)
      await deleteFileStatEntry(entry.path)
    }

    // Update cacheStore: remove old entries, insert new ones
    setCacheStore('files', produce((m: Record<string, FileMeta>) => {
      for (const entry of descendants) delete m[entry.path]
    }))
    for (const entry of descendants) {
      const newEntryPath = newFolderPath + entry.path.slice(srcPath.length)
      const newParent = newEntryPath.includes('/')
        ? newEntryPath.slice(0, newEntryPath.lastIndexOf('/'))
        : null
      setCacheStore('files', newEntryPath, { ...entry, path: newEntryPath, parent: newParent, hash: '' })
    }

    // Reindex files and update workspace tabs + backlinks
    const { workspaceActions } = await import('./workspaceStore')
    for (const entry of fileEntries) {
      const newFilePath = newFolderPath + entry.path.slice(srcPath.length)
      const content = fileContents.get(entry.path) ?? ''
      workspaceActions.renameLeafPath(entry.path, newFilePath)
      await cacheActions.reindexFile(newFilePath, content)
      const backlinks = cacheStore.backlinkMap[entry.path] ?? []
      await updateBacklinks(backlinks, entry.path, newFilePath)
    }
  },

  async moveEntry(srcPath: string, destDirPath: string | null): Promise<void> {
    const entry = cacheStore.files[srcPath]
    if (!entry) return
    if (entry.kind === 'directory') {
      await fileActions.moveFolder(srcPath, destDirPath)
    } else {
      await fileActions.moveFile(srcPath, destDirPath)
    }
  },
```

- [ ] **Step 2: Run full test suite**

```bash
npx vitest run
```
Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/stores/runtimeStore.ts
git commit -m "feat: add fileActions.moveFolder and moveEntry"
```

---

### Task 4: FilesPanel — drag source + drop targets + visual feedback

**Files:**
- Modify: `src/components/panels/FilesPanel.tsx`

This task wires all drag events and visual feedback in one pass since they share the same local signals and are tightly coupled.

- [ ] **Step 1: Add import for helpers at top of `FilesPanel.tsx`**

After the existing imports, add:

```ts
import { computeWikiLink, isValidMoveDrop } from '../../lib/dragDropHelpers'
```

- [ ] **Step 2: Update `FileTreeNode` props interface and add drag handlers**

Replace the `FileTreeNode` function signature:

```ts
function FileTreeNode(props: {
  entry: FileMeta
  depth: number
  collapsedFolders: string[]
  onToggle: (path: string) => void
  dragSrc: () => string | null
  dragOver: () => string | null
  onDragStart: (e: DragEvent, entry: FileMeta) => void
  onDragEnd: () => void
  onDirDragOver: (e: DragEvent, path: string) => void
  onDirDragLeave: (e: DragEvent, path: string) => void
  onDirDrop: (e: DragEvent, destDirPath: string) => void
})
```

- [ ] **Step 3: Replace the row `<div>` inside `FileTreeNode` with drag-enabled version**

Replace the inner row div (the one with `data-ctx`, `data-path`, `class`, `style`, `onClick`, `onDblClick`) with:

```tsx
<div
  data-ctx={props.entry.kind === 'directory' ? 'directory' : 'file'}
  data-path={props.entry.path}
  draggable={true}
  class={`flex items-center gap-1 py-0.5 text-[11px] cursor-pointer hover:bg-(--bg-hover) select-none
    ${isActive()
      ? 'bg-(--bg-hover) border-l-2 border-(--accent) text-(--text)'
      : isOther()
        ? 'text-(--text-4) border-l-2 border-transparent'
        : 'text-(--text-2) border-l-2 border-transparent'
    }
    ${props.dragSrc() === props.entry.path ? 'opacity-50' : ''}
    ${props.entry.kind === 'directory' && props.dragOver() === props.entry.path
      ? '!bg-(--bg-hover) !border-l-2 !border-(--accent-2)'
      : ''}
  `}
  style={{ 'padding-left': `${6 + props.depth * 14}px` }}
  onClick={() => {
    if (isRenaming()) return
    if (props.entry.kind === 'directory') { props.onToggle(props.entry.path); return }
    if (!canOpen(props.entry.name)) return
    workspaceActions.openFile(props.entry.path)
  }}
  onDblClick={() => {
    if (isRenaming()) return
    if (props.entry.kind !== 'file') return
    if (!canOpen(props.entry.name)) return
    workspaceActions.openFile(props.entry.path, { newTab: true, pin: true })
  }}
  onDragStart={(e) => props.onDragStart(e, props.entry)}
  onDragEnd={props.onDragEnd}
  onDragOver={props.entry.kind === 'directory'
    ? (e) => props.onDirDragOver(e, props.entry.path)
    : undefined}
  onDragLeave={props.entry.kind === 'directory'
    ? (e) => props.onDirDragLeave(e, props.entry.path)
    : undefined}
  onDrop={props.entry.kind === 'directory'
    ? (e) => props.onDirDrop(e, props.entry.path)
    : undefined}
>
```

- [ ] **Step 4: Pass drag props down in the recursive `<For>` inside `FileTreeNode`**

In the `<Show when={props.entry.kind === 'directory' && !isCollapsed()}>` block, update the `<FileTreeNode>` call to forward all drag props:

```tsx
<FileTreeNode
  entry={child}
  depth={props.depth + 1}
  collapsedFolders={props.collapsedFolders}
  onToggle={props.onToggle}
  dragSrc={props.dragSrc}
  dragOver={props.dragOver}
  onDragStart={props.onDragStart}
  onDragEnd={props.onDragEnd}
  onDirDragOver={props.onDirDragOver}
  onDirDragLeave={props.onDirDragLeave}
  onDirDrop={props.onDirDrop}
/>
```

- [ ] **Step 5: Add drag signals and handlers in `FilesPanel` body**

Inside `FilesPanel`, after `const handleToggle = ...`, add:

```ts
const [dragSrc, setDragSrc] = createSignal<string | null>(null)
const [dragOver, setDragOver] = createSignal<string | null>(null)

const handleDragStart = (e: DragEvent, entry: FileMeta) => {
  setDragSrc(entry.path)
  e.dataTransfer!.setData('application/x-symbol-notes-file', entry.path)
  e.dataTransfer!.setData('text/plain', computeWikiLink(entry.name, entry.kind))
  e.dataTransfer!.effectAllowed = 'move'
}

const handleDragEnd = () => {
  setDragSrc(null)
  setDragOver(null)
}

const handleDirDragOver = (e: DragEvent, path: string) => {
  const src = dragSrc()
  if (!src) return
  const srcEntry = cacheStore.files[src]
  if (!isValidMoveDrop(src, path, srcEntry?.parent ?? null)) return
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'move'
  setDragOver(path)
}

const handleDirDragLeave = (e: DragEvent, path: string) => {
  const rel = e.relatedTarget as Node | null
  if (rel && (e.currentTarget as Element).contains(rel)) return
  if (dragOver() === path) setDragOver(null)
}

const handleDirDrop = (e: DragEvent, destDirPath: string) => {
  e.preventDefault()
  const src = dragSrc()
  setDragSrc(null)
  setDragOver(null)
  if (!src) return
  const srcEntry = cacheStore.files[src]
  if (!isValidMoveDrop(src, destDirPath, srcEntry?.parent ?? null)) return
  void fileActions.moveEntry(src, destDirPath)
}

const handleRootDragOver = (e: DragEvent) => {
  const src = dragSrc()
  if (!src) return
  const srcEntry = cacheStore.files[src]
  if (!isValidMoveDrop(src, null, srcEntry?.parent ?? null)) return
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'move'
  setDragOver('__root__')
}

const handleRootDragLeave = (e: DragEvent) => {
  const rel = e.relatedTarget as Node | null
  if (rel && (e.currentTarget as Element).contains(rel)) return
  if (dragOver() === '__root__') setDragOver(null)
}

const handleRootDrop = (e: DragEvent) => {
  e.preventDefault()
  const src = dragSrc()
  setDragSrc(null)
  setDragOver(null)
  if (!src) return
  const srcEntry = cacheStore.files[src]
  if (!isValidMoveDrop(src, null, srcEntry?.parent ?? null)) return
  void fileActions.moveEntry(src, null)
}
```

- [ ] **Step 6: Update the scroll container `<div>` to be a root drop zone**

Replace the scroll container div:

```tsx
<div
  class={`overflow-y-auto flex-1 py-1 ${dragOver() === '__root__' ? 'outline outline-1 outline-(--accent-2) outline-offset-[-2px]' : ''}`}
  onDragOver={handleRootDragOver}
  onDragLeave={handleRootDragLeave}
  onDrop={handleRootDrop}
>
```

- [ ] **Step 7: Pass drag props to root-level `<FileTreeNode>` calls**

In the `<For each={childrenOf(null)}>` block, update:

```tsx
<FileTreeNode
  entry={entry}
  depth={0}
  collapsedFolders={collapsedFolders()}
  onToggle={handleToggle}
  dragSrc={dragSrc}
  dragOver={dragOver}
  onDragStart={handleDragStart}
  onDragEnd={handleDragEnd}
  onDirDragOver={handleDirDragOver}
  onDirDragLeave={handleDirDragLeave}
  onDirDrop={handleDirDrop}
/>
```

- [ ] **Step 8: Run full test suite**

```bash
npx vitest run
```
Expected: all tests PASS

- [ ] **Step 9: Commit**

```bash
git add src/components/panels/FilesPanel.tsx
git commit -m "feat: wire drag-and-drop events in FilesPanel"
```

---

## Self-Review

**Spec coverage:**
- ✓ Files and folders draggable
- ✓ Drop to root (destDirPath = null)
- ✓ Drop to existing folder
- ✓ Can't drop into self / descendant / same parent (isValidMoveDrop)
- ✓ `dragstart` sets `text/plain` → CM6 editor drop inserts wiki link
- ✓ `.md` → `[[stem]]`, image → `![[name]]`, folder/other → `[[name]]`
- ✓ Visual: dragged item opacity-50, folder target highlight, root outline
- ✓ Invalid drop: no `preventDefault()` → browser shows 🚫

**Placeholder scan:** No TBDs. All steps have complete code.

**Type consistency:**
- `moveEntry` calls `moveFile` / `moveFolder` — both defined in same task
- `computeWikiLink(entry.name, entry.kind)` — matches signature `(name: string, kind: 'file' | 'directory')`
- `isValidMoveDrop(src, destDirPath, srcEntry?.parent ?? null)` — matches signature throughout
- `dragSrc: () => string | null` passed as signal getter, not value — correct for SolidJS reactivity
