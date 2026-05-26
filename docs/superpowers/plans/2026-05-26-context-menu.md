# Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add right-click context menus to tabs and file tree entries, backed by event-delegation + a registry pattern, with all file UI operations (create, rename, delete) coordinated through `runtimeStore.fileOp`.

**Architecture:** A single `contextmenu` listener on `document` walks up the DOM to find `[data-ctx]` elements, looks up a registered `ItemFactory` by type, and shows a floating `Portal` menu. File operation state lives in `runtimeStore.fileOp`; a new `fileOpActions` module provides `startCreate`, `startRename`, `cancel`, `confirmCreate`, `confirmRename`. `FilesPanel` becomes a pure reactive view of that state.

**Tech Stack:** SolidJS 1.9, SolidJS `Portal`, Vitest, TypeScript, Tailwind CSS v4, File System Access API.

---

## File Map

| File | Action |
|------|--------|
| `src/stores/types.ts` | Add `FileOp` union type; add `fileOp` to `RuntimeState` |
| `src/stores/runtimeStore.ts` | Initialize `fileOp: null` |
| `src/actions/fileOpActions.ts` | **New** — `startCreate`, `startRename`, `cancel`, `confirmCreate`, `confirmRename` |
| `src/actions/fsActions.ts` | Add `deleteDirectory` |
| `src/lib/contextMenuRegistry.ts` | **New** — `MenuItem` type, `registerContextMenu`, `getMenuItems` |
| `src/components/ContextMenu.tsx` | **New** — event delegation setup + Portal menu component |
| `src/actions/workspaceActions.ts` | Add `findTabsById` (private), `closeOtherLeaves`, `closeRightLeaves` |
| `src/components/panels/FilesPanel.tsx` | Replace local signals with `runtimeStore.fileOp`; add `data-ctx` attrs; add rename inline input |
| `src/components/workspace/WorkspaceTabsView.tsx` | Add `data-ctx="tab"` + data attrs to non-panel tab divs |
| `src/App.tsx` | Add `<ContextMenu />`; register all factories |
| `src/__tests__/contextMenuRegistry.test.ts` | **New** — registry unit tests |
| `src/__tests__/workspaceActions.test.ts` | **New** — closeOtherLeaves / closeRightLeaves unit tests |

---

## Task 1: FileOp type + runtimeStore

**Files:**
- Modify: `src/stores/types.ts`
- Modify: `src/stores/runtimeStore.ts`

- [ ] **Add `FileOp` type and `fileOp` field to `RuntimeState` in `src/stores/types.ts`**

Find the `RuntimeState` interface (currently around line 121) and add:

```ts
// Add above RuntimeState:
export type FileOp =
  | { type: 'create-file' | 'create-folder'; prefix: string }
  | { type: 'rename'; path: string }
  | null

export interface RuntimeState {
  rootHandle: FileSystemDirectoryHandle | null
  leafInstances: Record<string, LeafRuntimeState>
  fileOp: FileOp
}
```

- [ ] **Initialize `fileOp: null` in `src/stores/runtimeStore.ts`**

```ts
import { createStore } from 'solid-js/store'
import type { RuntimeState } from './types'

const [runtimeStore, setRuntimeStore] = createStore<RuntimeState>({
  rootHandle: null,
  leafInstances: {},
  fileOp: null,
})

export { runtimeStore, setRuntimeStore }
```

- [ ] **Verify TypeScript compiles**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors (or only pre-existing errors unrelated to these files).

- [ ] **Commit**

```bash
git add src/stores/types.ts src/stores/runtimeStore.ts
git commit -m "feat: add FileOp type and fileOp field to runtimeStore"
```

---

## Task 2: fileOpActions.ts

**Files:**
- Create: `src/actions/fileOpActions.ts`

- [ ] **Create `src/actions/fileOpActions.ts`**

```ts
import { runtimeStore, setRuntimeStore } from '../stores/runtimeStore'
import { fsActions } from './fsActions'
import { workspaceActions } from './workspaceActions'

export const fileOpActions = {
  startCreate(mode: 'file' | 'folder', prefix = ''): void {
    setRuntimeStore('fileOp', {
      type: mode === 'file' ? 'create-file' : 'create-folder',
      prefix,
    })
  },

  startRename(path: string): void {
    setRuntimeStore('fileOp', { type: 'rename', path })
  },

  cancel(): void {
    setRuntimeStore('fileOp', null)
  },

  async confirmCreate(name: string): Promise<void> {
    const op = runtimeStore.fileOp
    if (!op || (op.type !== 'create-file' && op.type !== 'create-folder')) return
    setRuntimeStore('fileOp', null)
    if (op.type === 'create-file') {
      const path = await fsActions.createFile(name)
      if (path) workspaceActions.openFile(path, { newTab: true, pin: true })
    } else {
      await fsActions.createDirectory(name)
    }
  },

  async confirmRename(path: string, newName: string): Promise<void> {
    setRuntimeStore('fileOp', null)
    await fsActions.renameFile(path, newName)
  },
}
```

- [ ] **Verify TypeScript compiles**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Commit**

```bash
git add src/actions/fileOpActions.ts
git commit -m "feat: add fileOpActions for coordinated file UI operations"
```

---

## Task 3: fsActions.deleteDirectory

**Files:**
- Modify: `src/actions/fsActions.ts`

- [ ] **Add `deleteDirectory` to `src/actions/fsActions.ts`**

Add after the existing `deleteFile` method:

```ts
  async deleteDirectory(path: string): Promise<void> {
    const { rootHandle } = runtimeStore
    if (!rootHandle) return
    const parts = path.split('/')
    const name = parts.pop()!
    let parentDir: FileSystemDirectoryHandle = rootHandle
    for (const part of parts) parentDir = await parentDir.getDirectoryHandle(part)
    await parentDir.removeEntry(name, { recursive: true })

    const toRemove = Object.values(globalStore.fs.fileMap).filter(
      (e) => e.path === path || e.path.startsWith(path + '/'),
    )
    for (const entry of toRemove) {
      if (entry.kind === 'file') {
        invalidateFile(entry.path)
        await deleteFileStatEntry(entry.path)
        knowledgeActions.removeFileMeta(entry.path)
      }
    }
    setGlobalStore(
      'fs',
      'fileMap',
      produce((m: Record<string, import('../stores/types').FileMapEntry>) => {
        for (const entry of toRemove) delete m[entry.path]
      }),
    )
  },
```

- [ ] **Verify TypeScript compiles**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Commit**

```bash
git add src/actions/fsActions.ts
git commit -m "feat: add fsActions.deleteDirectory with recursive fileMap cleanup"
```

---

## Task 4: contextMenuRegistry

**Files:**
- Create: `src/lib/contextMenuRegistry.ts`
- Create: `src/__tests__/contextMenuRegistry.test.ts`

- [ ] **Write the failing test first at `src/__tests__/contextMenuRegistry.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerContextMenu,
  getMenuItems,
  _resetForTest,
} from '../lib/contextMenuRegistry'

beforeEach(() => _resetForTest())

describe('contextMenuRegistry', () => {
  it('returns empty array for unknown type', () => {
    const dataset = {} as DOMStringMap
    expect(getMenuItems('unknown', dataset)).toEqual([])
  })

  it('calls registered factory with dataset', () => {
    const dataset = { path: '/notes/foo' } as unknown as DOMStringMap
    registerContextMenu('directory', (d) => [
      { label: 'Delete', action: () => {}, disabled: false },
    ])
    const items = getMenuItems('directory', dataset)
    expect(items).toHaveLength(1)
    expect('label' in items[0] && items[0].label).toBe('Delete')
  })

  it('overwrites previous factory for same type', () => {
    registerContextMenu('tab', () => [{ label: 'A', action: () => {} }])
    registerContextMenu('tab', () => [{ label: 'B', action: () => {} }])
    const items = getMenuItems('tab', {} as DOMStringMap)
    expect('label' in items[0] && items[0].label).toBe('B')
  })
})
```

- [ ] **Run test to verify it fails**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run src/__tests__/contextMenuRegistry.test.ts 2>&1 | tail -10
```

Expected: FAIL — `contextMenuRegistry` not found.

- [ ] **Create `src/lib/contextMenuRegistry.ts`**

```ts
export type MenuItem =
  | { label: string; action: () => void; disabled?: boolean }
  | { separator: true }

type ItemFactory = (dataset: DOMStringMap) => MenuItem[]

const registry = new Map<string, ItemFactory>()

export function registerContextMenu(type: string, factory: ItemFactory): void {
  registry.set(type, factory)
}

export function getMenuItems(type: string, dataset: DOMStringMap): MenuItem[] {
  return registry.get(type)?.(dataset) ?? []
}

export function _resetForTest(): void {
  registry.clear()
}
```

- [ ] **Run test to verify it passes**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run src/__tests__/contextMenuRegistry.test.ts 2>&1 | tail -10
```

Expected: PASS — 3 tests passing.

- [ ] **Commit**

```bash
git add src/lib/contextMenuRegistry.ts src/__tests__/contextMenuRegistry.test.ts
git commit -m "feat: add contextMenuRegistry with registerContextMenu/getMenuItems"
```

---

## Task 5: ContextMenu component

**Files:**
- Create: `src/components/ContextMenu.tsx`

- [ ] **Create `src/components/ContextMenu.tsx`**

```tsx
import { For, Show, onMount, onCleanup } from 'solid-js'
import { createStore } from 'solid-js/store'
import { Portal } from 'solid-js/web'
import { getMenuItems, type MenuItem } from '../lib/contextMenuRegistry'

type MenuState = { x: number; y: number; items: MenuItem[] } | null

const [state, setState] = createStore<{ menu: MenuState }>({ menu: null })

function closeMenu() {
  setState('menu', null)
}

export function ContextMenu() {
  onMount(() => {
    function onContextMenu(e: MouseEvent) {
      let el = e.target as HTMLElement | null
      while (el) {
        const ctx = el.dataset.ctx
        if (ctx) {
          const items = getMenuItems(ctx, el.dataset)
          if (items.length > 0) {
            e.preventDefault()
            const approxH = items.length * 28
            const approxW = 160
            setState('menu', {
              x: e.clientX + approxW > window.innerWidth ? e.clientX - approxW : e.clientX,
              y: e.clientY + approxH > window.innerHeight ? e.clientY - approxH : e.clientY,
              items,
            })
          }
          return
        }
        el = el.parentElement
      }
    }

    function onMouseDown(e: MouseEvent) {
      const menuEl = document.querySelector('[data-context-menu-root]')
      if (menuEl && !menuEl.contains(e.target as Node)) closeMenu()
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeMenu()
    }

    document.addEventListener('contextmenu', onContextMenu)
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    onCleanup(() => {
      document.removeEventListener('contextmenu', onContextMenu)
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    })
  })

  return (
    <Show when={state.menu}>
      {(m) => (
        <Portal>
          <div
            data-context-menu-root
            class="fixed z-50 min-w-40 py-1 rounded border border-(--border) bg-(--bg-surface) shadow-lg"
            style={{ left: `${m().x}px`, top: `${m().y}px` }}
          >
            <For each={m().items}>
              {(item) =>
                'separator' in item ? (
                  <div class="my-1 border-t border-(--border)" />
                ) : (
                  <button
                    class="w-full text-left px-3 py-1 text-[11px] text-(--text-2) hover:bg-(--bg-hover) hover:text-(--text) disabled:opacity-40 disabled:pointer-events-none"
                    disabled={item.disabled}
                    onClick={() => {
                      item.action()
                      closeMenu()
                    }}
                  >
                    {item.label}
                  </button>
                )
              }
            </For>
          </div>
        </Portal>
      )}
    </Show>
  )
}
```

- [ ] **Verify TypeScript compiles**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Commit**

```bash
git add src/components/ContextMenu.tsx
git commit -m "feat: add ContextMenu component with event delegation and Portal"
```

---

## Task 6: workspaceActions — closeOtherLeaves + closeRightLeaves

**Files:**
- Modify: `src/actions/workspaceActions.ts`
- Create: `src/__tests__/workspaceActions.test.ts`

- [ ] **Write failing tests at `src/__tests__/workspaceActions.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createStore } from 'solid-js/store'

// We test the pure helper findTabsById separately since workspaceActions
// is hard to unit-test without a full store. Test the logic via helper.
// The actual actions are integration-tested manually.

function findTabsById(root: any, tabsId: string): any {
  if (root.type === 'tabs' && root.id === tabsId) return root
  if (root.type === 'split') {
    for (const child of root.children) {
      const found = findTabsById(child, tabsId)
      if (found) return found
    }
  }
  return null
}

describe('findTabsById', () => {
  it('finds tabs at root', () => {
    const node = { type: 'tabs', id: 't1', children: [], activeLeafId: null }
    expect(findTabsById(node, 't1')).toBe(node)
  })

  it('returns null for wrong id', () => {
    const node = { type: 'tabs', id: 't1', children: [], activeLeafId: null }
    expect(findTabsById(node, 't2')).toBeNull()
  })

  it('finds tabs nested in a split', () => {
    const tabs = { type: 'tabs', id: 't2', children: [], activeLeafId: null }
    const split = { type: 'split', id: 's1', direction: 'horizontal', children: [tabs] }
    expect(findTabsById(split, 't2')).toBe(tabs)
  })
})
```

- [ ] **Run test to verify it passes immediately (pure logic test)**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run src/__tests__/workspaceActions.test.ts 2>&1 | tail -10
```

Expected: PASS — 3 tests passing (pure function, no store needed).

- [ ] **Add `findTabsById` private helper and two new actions to `src/actions/workspaceActions.ts`**

Add `findTabsById` after `mapNode` in the internal helpers section:

```ts
function findTabsById(root: WorkspaceNode, tabsId: string): WorkspaceTabs | null {
  if (root.type === 'tabs' && root.id === tabsId) return root
  if (root.type === 'split') {
    for (const child of root.children) {
      const found = findTabsById(child, tabsId)
      if (found) return found
    }
  }
  return null
}
```

Add `closeOtherLeaves` and `closeRightLeaves` after `closeLeaf` in the actions object:

```ts
  closeOtherLeaves(tabsId: string, keepLeafId: string): void {
    const tabs = findTabsById(activeLayout().root.main, tabsId)
    if (!tabs) return
    const toRemove = tabs.children.filter(l => l.id !== keepLeafId)
    setRoot('main', (root: WorkspaceNode) =>
      mapNode(root, tabsId, node => ({
        ...(node as WorkspaceTabs),
        children: [(node as WorkspaceTabs).children.find(l => l.id === keepLeafId)!],
        activeLeafId: keepLeafId,
      })),
    )
    setLayout('activeLeafId', keepLeafId)
    setRuntimeStore('leafInstances', produce(s => {
      for (const l of toRemove) delete s[l.id]
    }))
  },

  closeRightLeaves(tabsId: string, leafId: string): void {
    const tabs = findTabsById(activeLayout().root.main, tabsId)
    if (!tabs) return
    const idx = tabs.children.findIndex(l => l.id === leafId)
    if (idx === -1) return
    const toRemove = tabs.children.slice(idx + 1)
    if (toRemove.length === 0) return
    const removedIds = new Set(toRemove.map(l => l.id))
    const nextActiveId = removedIds.has(activeLayout().activeLeafId ?? '') ? leafId : activeLayout().activeLeafId
    setRoot('main', (root: WorkspaceNode) =>
      mapNode(root, tabsId, node => ({
        ...(node as WorkspaceTabs),
        children: (node as WorkspaceTabs).children.slice(0, idx + 1),
        activeLeafId: nextActiveId,
      })),
    )
    if (removedIds.has(activeLayout().activeLeafId ?? '')) {
      setLayout('activeLeafId', leafId)
    }
    setRuntimeStore('leafInstances', produce(s => {
      for (const l of toRemove) delete s[l.id]
    }))
  },
```

- [ ] **Verify TypeScript compiles**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Commit**

```bash
git add src/actions/workspaceActions.ts src/__tests__/workspaceActions.test.ts
git commit -m "feat: add closeOtherLeaves and closeRightLeaves workspace actions"
```

---

## Task 7: FilesPanel refactor

**Files:**
- Modify: `src/components/panels/FilesPanel.tsx`

Replace local `createMode`/`newName` signals with `runtimeStore.fileOp`. Add `data-ctx` attrs. Add inline rename input.

- [ ] **Rewrite `src/components/panels/FilesPanel.tsx`**

```tsx
import { FolderOpen } from 'lucide-solid'
import { createSignal, For, Show } from 'solid-js'
import { appActions } from '../../actions/appActions'
import { fileOpActions } from '../../actions/fileOpActions'
import { workspaceActions } from '../../actions/workspaceActions'
import { toggleInArray } from '../../lib/arrayUtils'
import { activeFilePath, globalStore } from '../../stores/globalStore'
import { runtimeStore } from '../../stores/runtimeStore'
import type { FileMapEntry, ViewComponentProps } from '../../stores/types'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif'])
const MD_EXT = '.md'

function displayName(name: string): string {
  return name.endsWith(MD_EXT) ? name.slice(0, -3) : name
}

function isOtherFile(name: string): boolean {
  return !name.endsWith(MD_EXT)
}

function canOpen(name: string): boolean {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return name.endsWith(MD_EXT) || IMAGE_EXTS.has(ext)
}

function childrenOf(parentPath: string | null): FileMapEntry[] {
  return Object.values(globalStore.fs.fileMap)
    .filter((e) => e.parent === parentPath)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

function FileTreeNode(props: {
  entry: FileMapEntry
  depth: number
  collapsedFolders: string[]
  onToggle: (path: string) => void
}) {
  const isActive = () => activeFilePath() === props.entry.path
  const isOther = () => props.entry.kind === 'file' && isOtherFile(props.entry.name)
  const show = () =>
    props.entry.kind === 'directory' ||
    !isOtherFile(props.entry.name) ||
    globalStore.workspace.showOtherFiles
  const isCollapsed = () =>
    props.entry.kind === 'directory' && props.collapsedFolders.includes(props.entry.path)
  const isRenaming = () =>
    runtimeStore.fileOp?.type === 'rename' && runtimeStore.fileOp.path === props.entry.path

  const [renameValue, setRenameValue] = createSignal('')

  const startRenameInput = () => {
    setRenameValue(displayName(props.entry.name))
  }

  const confirmRename = async () => {
    const val = renameValue().trim()
    if (!val) { fileOpActions.cancel(); return }
    await fileOpActions.confirmRename(props.entry.path, val)
  }

  const onRenameKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') void confirmRename()
    else if (e.key === 'Escape') fileOpActions.cancel()
  }

  return (
    <Show when={show()}>
      <div>
        <div
          data-ctx={props.entry.kind === 'directory' ? 'directory' : 'file'}
          data-path={props.entry.path}
          class={`flex items-center gap-1 py-0.5 text-[11px] cursor-pointer hover:bg-(--bg-hover) select-none
            ${isActive()
              ? 'bg-(--bg-hover) border-l-2 border-(--accent) text-(--text)'
              : isOther()
                ? 'text-(--text-4) border-l-2 border-transparent'
                : 'text-(--text-2) border-l-2 border-transparent'
            }`}
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
        >
          <Show when={props.entry.kind === 'directory'}>
            <span class="text-[9px] text-(--text-3)">{isCollapsed() ? '▸' : '▾'}</span>
          </Show>
          <Show
            when={isRenaming()}
            fallback={
              <span class={isActive() ? 'text-(--accent)' : ''}>{displayName(props.entry.name)}</span>
            }
          >
            <input
              class="flex-1 bg-(--bg-hover) border border-(--accent) rounded px-1 py-0 text-[11px] text-(--text) outline-none min-w-0"
              value={renameValue()}
              onInput={(e) => setRenameValue(e.currentTarget.value)}
              onKeyDown={onRenameKeyDown}
              onBlur={() => void confirmRename()}
              ref={(el) => {
                startRenameInput()
                setTimeout(() => { el?.focus(); el?.select() }, 0)
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </Show>
        </div>
        <Show when={props.entry.kind === 'directory' && !isCollapsed()}>
          <For each={childrenOf(props.entry.path)}>
            {(child) => (
              <FileTreeNode
                entry={child}
                depth={props.depth + 1}
                collapsedFolders={props.collapsedFolders}
                onToggle={props.onToggle}
              />
            )}
          </For>
        </Show>
      </div>
    </Show>
  )
}

export function FilesPanel(props: ViewComponentProps) {
  const collapsedFolders = () =>
    (props.viewState.collapsedFolders as string[] | undefined) ?? []

  const handleToggle = (path: string) => {
    workspaceActions.setLeafViewState(props.leafId, {
      type: 'files',
      state: { ...props.viewState, collapsedFolders: toggleInArray(collapsedFolders(), path) },
    })
  }

  const fileOp = () => runtimeStore.fileOp
  const isCreating = () => fileOp()?.type === 'create-file' || fileOp()?.type === 'create-folder'

  const [createValue, setCreateValue] = createSignal('')

  const confirmCreate = async () => {
    const val = createValue().trim()
    if (!val) { fileOpActions.cancel(); return }
    await fileOpActions.confirmCreate(val)
  }

  const onCreateKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') void confirmCreate()
    else if (e.key === 'Escape') fileOpActions.cancel()
  }

  return (
    <div class="flex flex-col h-full">
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
            onClick={() => { setCreateValue(''); fileOpActions.startCreate('folder') }}
          >⊞</button>
          <button
            class="shrink-0 text-(--text-3) hover:text-(--accent-2) w-5 h-5 flex items-center justify-center rounded hover:bg-(--bg-hover) transition-colors"
            title="新建文件"
            onClick={() => { setCreateValue(''); fileOpActions.startCreate('file') }}
          >+</button>
        </Show>
      </div>

      <div class="overflow-y-auto flex-1 py-1">
        <Show when={isCreating()}>
          <div class="flex items-center gap-1 px-2 py-1">
            <span class="text-[9px] text-(--text-3)">
              {fileOp()?.type === 'create-folder' ? '▸' : ''}
            </span>
            <input
              class="flex-1 bg-(--bg-hover) border border-(--accent) rounded px-1.5 py-0.5 text-[11px] text-(--text) outline-none min-w-0"
              placeholder={
                fileOp()?.type === 'create-folder' ? '文件夹 或 父/子/文件夹' : '文件名 或 目录/文件名'
              }
              value={createValue()}
              onInput={(e) => setCreateValue(e.currentTarget.value)}
              onKeyDown={onCreateKeyDown}
              onBlur={() => void confirmCreate()}
              ref={(el) => {
                const prefix = (fileOp() as { prefix: string } | null)?.prefix ?? ''
                setCreateValue(prefix)
                setTimeout(() => el?.focus(), 0)
              }}
            />
          </div>
        </Show>
        <For each={childrenOf(null)}>
          {(entry) => (
            <FileTreeNode
              entry={entry}
              depth={0}
              collapsedFolders={collapsedFolders()}
              onToggle={handleToggle}
            />
          )}
        </For>
      </div>
    </div>
  )
}
```

- [ ] **Verify TypeScript compiles**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Commit**

```bash
git add src/components/panels/FilesPanel.tsx
git commit -m "refactor(FilesPanel): replace local signals with runtimeStore.fileOp; add data-ctx attrs and inline rename"
```

---

## Task 8: WorkspaceTabsView — add data-ctx

**Files:**
- Modify: `src/components/workspace/WorkspaceTabsView.tsx`

- [ ] **Add `data-ctx`, `data-leaf-id`, `data-tabs-id` to non-panel tab divs in `src/components/workspace/WorkspaceTabsView.tsx`**

Find the tab `div` (the one with the `flex items-center gap-1.5 px-3` class). Add data attributes conditionally so panel tabs don't get a context menu:

```tsx
<div
  data-ctx={!isPanelLeaf() ? 'tab' : undefined}
  data-leaf-id={!isPanelLeaf() ? leaf.id : undefined}
  data-tabs-id={!isPanelLeaf() ? props.node.id : undefined}
  class={`flex items-center gap-1.5 px-3 border-r border-(--border)] cursor-pointer text-[11px] shrink-0
    ${isActive()
      ? 'bg-(--bg-base) text-(--text) border-b-2 border-b-(--accent) -mb-px'
      : 'text-(--text-3) hover:bg-(--bg-hover)'
    }`}
  onClick={() => { ... }}   // unchanged
  onDblClick={() => { ... }} // unchanged
>
```

- [ ] **Verify TypeScript compiles**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Commit**

```bash
git add src/components/workspace/WorkspaceTabsView.tsx
git commit -m "feat(tabs): add data-ctx and data attrs for context menu delegation"
```

---

## Task 9: App.tsx — wire ContextMenu + register factories

**Files:**
- Modify: `src/App.tsx`

This is the final wiring step. Add `<ContextMenu />` to the rendered tree and register all four factories.

- [ ] **Update `src/App.tsx`**

Add imports at the top:

```ts
import { fileOpActions } from './actions/fileOpActions'
import { fsActions } from './actions/fsActions'
import { workspaceActions } from './actions/workspaceActions'
import { ContextMenu } from './components/ContextMenu'
import { registerContextMenu } from './lib/contextMenuRegistry'
import { activeLayout } from './stores/globalStore'
```

Add factory registrations after all `registerView(...)` calls (before `export default function App()`):

```ts
// ── Context menu factories ────────────────────────────────────────────────────

registerContextMenu('tab', (d) => {
  const leafId = d.leafId!
  const tabsId = d.tabsId!
  // Find tabs node to determine sibling count and position
  const root = activeLayout().root
  function findTabs(node: any): any {
    if (node.type === 'tabs' && node.id === tabsId) return node
    if (node.type === 'split') for (const c of node.children) { const f = findTabs(c); if (f) return f }
    return null
  }
  const tabs = findTabs(root.main)
  const siblings = tabs?.children ?? []
  const idx = siblings.findIndex((l: any) => l.id === leafId)
  return [
    { label: '关闭', action: () => workspaceActions.closeLeaf(leafId) },
    { label: '关闭其他', action: () => workspaceActions.closeOtherLeaves(tabsId, leafId), disabled: siblings.length <= 1 },
    { label: '关闭右侧', action: () => workspaceActions.closeRightLeaves(tabsId, leafId), disabled: idx >= siblings.length - 1 },
  ]
})

registerContextMenu('file', (d) => {
  const path = d.path!
  return [
    { label: '重命名', action: () => fileOpActions.startRename(path) },
    { separator: true as const },
    { label: '删除', action: () => { if (confirm(`删除 ${path.split('/').pop()}？`)) void fsActions.deleteFile(path) } },
  ]
})

registerContextMenu('directory', (d) => {
  const path = d.path!
  return [
    { label: '新建文件', action: () => { fileOpActions.startCreate('file', path + '/') } },
    { label: '新建文件夹', action: () => { fileOpActions.startCreate('folder', path + '/') } },
    { separator: true as const },
    // 目录重命名已延期（需要 copy+delete 递归，复杂度不同）
    { label: '删除文件夹', action: () => { if (confirm(`删除文件夹 ${path.split('/').pop()}？`)) void fsActions.deleteDirectory(path) } },
  ]
})
```

Add `<ContextMenu />` inside the `return` JSX, just before the closing `</div>`:

```tsx
  return (
    <div class="h-full flex flex-col bg-(--bg-base) text-(--text) overflow-hidden">
      <div class="flex flex-1 overflow-hidden">
        <Ribbon />
        <SidebarRenderer node={activeRoot().left} />
        <div class="flex-1 flex flex-col overflow-hidden min-w-0">
          <WorkspaceNodeRenderer node={activeRoot().main} />
        </div>
        <SidebarRenderer node={activeRoot().right} />
      </div>
      <StatusBar />
      <Show when={globalStore.workspace.showSettings}>
        <Settings />
      </Show>
      <ContextMenu />
    </div>
  )
```

- [ ] **Verify TypeScript compiles**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Run all tests**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire ContextMenu and register tab/file/directory factories in App"
```

---

## Manual Verification Checklist

After all tasks complete, verify in the browser (`npm run dev`):

- [ ] Right-click on a tab → menu shows 关闭 / 关闭其他 / 关闭右侧; 关闭其他 disabled when only 1 tab; 关闭右侧 disabled on last tab
- [ ] Right-click on a file in FilesPanel → menu shows 重命名 / 删除; clicking 重命名 shows inline input on that entry; Enter confirms; Escape cancels
- [ ] Right-click on a directory → menu shows 新建文件 / 新建文件夹 / 重命名 / 删除文件夹; 新建文件 pre-fills input with `dirPath/`; 删除文件夹 shows confirm dialog
- [ ] Toolbar + / ⊞ buttons still work (no prefix, create at root)
- [ ] Clicking outside open menu closes it; Esc closes it
- [ ] Folder collapse still works after FilesPanel refactor
