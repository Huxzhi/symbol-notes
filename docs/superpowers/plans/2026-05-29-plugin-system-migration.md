# Plugin System Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all core UI features into self-contained plugins and expand `PluginContext` to close API gaps that currently force plugins to import directly from internal stores.

**Architecture:** Each feature (files, editor, links, outline, tags, search, app) becomes a `core: true` plugin that registers its views, ribbon items, and context menus exclusively through `ctx`. Panel and viewer component code moves into its plugin directory. `App.tsx` becomes a pure registration list.

**Tech Stack:** SolidJS, TypeScript, Vitest

---

## File Map

| Status | Path | Change |
|--------|------|--------|
| Modify | `src/lib/contextMenuRegistry.ts` | Add `unregisterContextMenu` |
| Modify | `src/lib/pluginRegistry.ts` | Expand `PluginContext` interface + wiring |
| Modify | `src/plugins/calendar/index.tsx` | Remove direct store imports, use ctx |
| Move → | `src/components/panels/FilesPanel.tsx` → `src/plugins/files/FilesPanel.tsx` | |
| Create | `src/plugins/files/index.tsx` | FilesPlugin definition |
| Move → | `src/components/viewer/EditorViewer.tsx` → `src/plugins/editor/EditorViewer.tsx` | |
| Move → | `src/components/viewer/ImageViewer.tsx` → `src/plugins/editor/ImageViewer.tsx` | |
| Create | `src/plugins/editor/index.tsx` | EditorPlugin definition |
| Move → | `src/components/panels/LinksPanel.tsx` → `src/plugins/links/index.tsx` | (inline, 69 lines) |
| Move → | `src/components/panels/OutlinePanel.tsx` → `src/plugins/outline/index.tsx` | (inline, 53 lines) |
| Move → | `src/components/panels/TagsPanel.tsx` → `src/plugins/tags/index.tsx` | (inline, 131 lines) |
| Move → | `src/components/panels/SearchPanel.tsx` → `src/plugins/search/index.tsx` | (inline, 56 lines) |
| Create | `src/plugins/app/index.tsx` | AppPlugin definition |
| Move → | `src/components/panels/CalendarPanel.tsx` → `src/plugins/calendar/CalendarPanel.tsx` | |
| Move → | `src/components/viewer/CalendarViewer.tsx` → `src/plugins/calendar/CalendarViewer.tsx` | |
| Modify | `src/App.tsx` | Replace raw registry calls with registerPlugin list |
| Delete | `src/components/panels/` | After all panels migrated |
| Delete | `src/components/viewer/` | After all viewers migrated |

---

## Task 1: Add `unregisterContextMenu` to contextMenuRegistry

**Files:**
- Modify: `src/lib/contextMenuRegistry.ts`
- Create: `src/lib/__tests__/contextMenuRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/contextMenuRegistry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerContextMenu,
  getMenuItems,
  unregisterContextMenu,
  _resetForTest,
} from '../contextMenuRegistry'

beforeEach(() => _resetForTest())

describe('registerContextMenu', () => {
  it('returns items from registered factory', () => {
    registerContextMenu('file', () => [{ label: 'Delete', action: () => {} }])
    const items = getMenuItems('file', {} as DOMStringMap)
    expect(items).toHaveLength(1)
    expect((items[0] as { label: string }).label).toBe('Delete')
  })
  it('returns empty array for unknown type', () => {
    expect(getMenuItems('unknown', {} as DOMStringMap)).toEqual([])
  })
})

describe('unregisterContextMenu', () => {
  it('removes the factory so getMenuItems returns []', () => {
    registerContextMenu('tab', () => [{ label: 'Close', action: () => {} }])
    unregisterContextMenu('tab')
    expect(getMenuItems('tab', {} as DOMStringMap)).toEqual([])
  })
  it('is a no-op for unknown type', () => {
    expect(() => unregisterContextMenu('nonexistent')).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/__tests__/contextMenuRegistry.test.ts
```

Expected: FAIL — `unregisterContextMenu` is not exported.

- [ ] **Step 3: Add `unregisterContextMenu` to contextMenuRegistry**

Edit `src/lib/contextMenuRegistry.ts` — add after `registerContextMenu`:

```ts
export function unregisterContextMenu(type: string): void {
  registry.delete(type)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/__tests__/contextMenuRegistry.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/contextMenuRegistry.ts src/lib/__tests__/contextMenuRegistry.test.ts
git commit -m "feat: add unregisterContextMenu to contextMenuRegistry"
```

---

## Task 2: Expand PluginContext with workspace selectors and contextMenu

**Files:**
- Modify: `src/lib/pluginRegistry.ts`

- [ ] **Step 1: Update `PluginContext` interface**

In `src/lib/pluginRegistry.ts`, replace the existing `PluginContext` interface with:

```ts
import type { MenuItem } from './contextMenuRegistry'

type ContextMenuFactory = (dataset: DOMStringMap) => MenuItem[]

export interface PluginContext {
  view(def: ViewDef): void
  ribbon(def: RibbonItemDef): void
  contextMenu(type: string, factory: ContextMenuFactory): void
  workspace: {
    openFile(path: string, opts?: { area?: 'left' | 'main' | 'right'; newTab?: boolean }): void
    openPage(type: string): void
    openPanel(area: 'left' | 'right', type: string, state?: Record<string, unknown>): void
    getLeafsByType(type: string): string[]
    activeLeafId(): string | null
    activeFilePath(): string | null
    activeSidebarType(side: 'left' | 'right'): string | null
    switchSidebarPanel(side: 'left' | 'right', type: string): void
  }
  settings: {
    tab(def: SettingsTabInput): void
    getConfig<T extends Record<string, unknown>>(defaults: T): T
    setConfig(patch: Record<string, unknown>): void
  }
}
```

- [ ] **Step 2: Add missing imports to pluginRegistry.ts**

At the top of `src/lib/pluginRegistry.ts`, ensure these imports exist (add whichever are missing):

```ts
import {
  registerContextMenu,
  unregisterContextMenu,
  type MenuItem,
} from './contextMenuRegistry'
import {
  activeFilePath,
  activeSidebarType,
  workspaceActions,
} from '../stores/workspaceStore'
```

- [ ] **Step 3: Wire new methods into `loadPlugin`'s `ctx` object**

Inside `loadPlugin`, add to the `ctx` object:

```ts
contextMenu(type, factory) {
  registerContextMenu(type, factory)
  onCleanup(() => unregisterContextMenu(type))
},
workspace: {
  openFile:  (path, opts) => workspaceActions.openFile(path, opts),
  openPage:  (type)       => workspaceActions.openPage(type),
  openPanel: (area, type, state) => workspaceActions.openSidebarPanel(area, type, state),
  getLeafsByType,
  activeLeafId:         () => activeLayout().activeLeafId,
  activeFilePath:       () => activeFilePath(),
  activeSidebarType:    (side) => activeSidebarType(side),
  switchSidebarPanel:   (side, type) => workspaceActions.switchSidebarPanel(side, type),
},
```

- [ ] **Step 4: Verify TypeScript compiles with no errors**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pluginRegistry.ts
git commit -m "feat: expand PluginContext with activeFilePath, activeSidebarType, switchSidebarPanel, contextMenu"
```

---

## Task 3: Update CalendarPlugin to use ctx only

**Files:**
- Modify: `src/plugins/calendar/index.tsx`

CalendarPlugin currently imports `activeSidebarType`, `activeLayout`, `findLeafInTree`, `activeRoot` directly from `workspaceStore`. Replace all with ctx calls.

- [ ] **Step 1: Update CalendarPlugin imports and setup**

Replace `src/plugins/calendar/index.tsx` entirely with:

```tsx
import { CalendarDays, CalendarRange } from 'lucide-solid'
import { definePlugin } from '../../lib/pluginRegistry'
import { CalendarPanel } from './CalendarPanel'
import { CalendarViewer } from './CalendarViewer'
import type { SettingsTabProps } from '../../lib/settingsTabRegistry'

function CalendarSettings(props: SettingsTabProps) {
  const config = () => props.getConfig({
    weekStartsMonday: true,
    showLunar: false,
  })

  return (
    <div class="flex flex-col gap-5">
      <ToggleRow
        label="周一作为一周起始"
        description="将周一设为日历每行的第一天"
        checked={config().weekStartsMonday}
        onChange={(v) => props.setConfig({ weekStartsMonday: v })}
      />
      <ToggleRow
        label="显示农历"
        description="在日历格子中叠加显示农历日期"
        checked={config().showLunar}
        onChange={(v) => props.setConfig({ showLunar: v })}
      />
    </div>
  )
}

function ToggleRow(props: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label class="flex items-start gap-3 cursor-pointer select-none">
      <div class="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          class="sr-only"
          checked={props.checked}
          onChange={(e) => props.onChange(e.currentTarget.checked)}
        />
        <div class={`w-9 h-5 rounded-full transition-colors ${props.checked ? 'bg-(--accent)' : 'bg-(--bg-active)'}`} />
        <div class={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${props.checked ? 'translate-x-4' : ''}`} />
      </div>
      <div>
        <div class="text-[13px] t-base font-medium">{props.label}</div>
        {props.description && (
          <div class="text-[11px] t-3 mt-0.5 leading-relaxed">{props.description}</div>
        )}
      </div>
    </label>
  )
}

export const CalendarPlugin = definePlugin({
  id: 'calendar',
  name: '日历',
  description: '日历面板与日历大图视图',
  defaultEnabled: true,
  setup(ctx) {
    ctx.view({
      kind: 'panel',
      position: 'left',
      type: 'calendar-panel',
      getDisplayText: () => '日历',
      component: CalendarPanel,
    })

    ctx.view({
      kind: 'page',
      type: 'calendar',
      getDisplayText: () => '日历',
      getIcon: () => <CalendarRange size={11} />,
      component: CalendarViewer,
    })

    ctx.ribbon({
      id: 'calendar-panel',
      title: '日历',
      getIcon: () => <CalendarDays size={18} />,
      onClick: () => ctx.workspace.switchSidebarPanel('left', 'calendar-panel'),
      isActive: () => ctx.workspace.activeSidebarType('left') === 'calendar-panel',
    })

    ctx.ribbon({
      id: 'calendar-page',
      title: '日历大图',
      getIcon: () => <CalendarRange size={18} />,
      onClick: () => ctx.workspace.openPage('calendar'),
      isActive: () => {
        const id = ctx.workspace.activeLeafId()
        return id ? ctx.workspace.getLeafsByType('calendar').includes(id) : false
      },
    })

    ctx.settings.tab({
      name: '日历',
      component: CalendarSettings,
    })
  },
})
```

Note: `CalendarPanel` and `CalendarViewer` are still imported from their current locations. They will move to the `calendar/` directory in Task 11 (calendar cleanup step).

- [ ] **Step 2: Verify TypeScript compiles with no errors**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/plugins/calendar/index.tsx
git commit -m "refactor: CalendarPlugin uses ctx instead of direct store imports"
```

---

## Task 4: Move CalendarPanel and CalendarViewer into calendar plugin directory

**Files:**
- Move: `src/components/panels/CalendarPanel.tsx` → `src/plugins/calendar/CalendarPanel.tsx`
- Move: `src/components/viewer/CalendarViewer.tsx` → `src/plugins/calendar/CalendarViewer.tsx`

- [ ] **Step 1: Move the files**

```bash
mv src/components/panels/CalendarPanel.tsx src/plugins/calendar/CalendarPanel.tsx
mv src/components/viewer/CalendarViewer.tsx src/plugins/calendar/CalendarViewer.tsx
```

- [ ] **Step 2: Fix imports inside CalendarPanel.tsx**

`src/plugins/calendar/CalendarPanel.tsx` imports from relative paths. Update any `../../stores/...` or `../../lib/...` paths:

Open `src/plugins/calendar/CalendarPanel.tsx` and change all import paths from `../../stores/` to `../../stores/` — these stay the same depth (plugin is at `src/plugins/calendar/`, stores are at `src/stores/`), so no change needed. Verify by checking the file's imports.

```bash
head -10 src/plugins/calendar/CalendarPanel.tsx
```

The imports use `../../stores/...` and `../../lib/...` which remain correct from `src/plugins/calendar/`.

- [ ] **Step 3: Fix imports inside CalendarViewer.tsx**

Same check:

```bash
head -10 src/plugins/calendar/CalendarViewer.tsx
```

Imports from `../../stores/...` remain correct.

- [ ] **Step 4: Verify TypeScript compiles with no errors**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/calendar/CalendarPanel.tsx src/plugins/calendar/CalendarViewer.tsx
git commit -m "refactor: move CalendarPanel and CalendarViewer into calendar plugin directory"
```

---

## Task 5: Create FilesPlugin

**Files:**
- Move: `src/components/panels/FilesPanel.tsx` → `src/plugins/files/FilesPanel.tsx`
- Create: `src/plugins/files/index.tsx`

- [ ] **Step 1: Move FilesPanel**

```bash
mkdir -p src/plugins/files
mv src/components/panels/FilesPanel.tsx src/plugins/files/FilesPanel.tsx
```

- [ ] **Step 2: Fix imports inside FilesPanel.tsx**

`FilesPanel.tsx` was at `src/components/panels/`. It is now at `src/plugins/files/`. Update all relative imports:

Open `src/plugins/files/FilesPanel.tsx` and change:
- `../../stores/runtimeStore` → `../../stores/runtimeStore` (unchanged, same depth)
- `../../stores/workspaceStore` → `../../stores/workspaceStore` (unchanged)
- `../../lib/arrayUtils` → `../../lib/arrayUtils` (unchanged)
- `../../stores/cacheStore` → `../../stores/cacheStore` (unchanged)
- `../../stores/settingsStore` → `../../stores/settingsStore` (unchanged)
- `../../lib/dragDropHelpers` → `../../lib/dragDropHelpers` (unchanged)
- `../../stores/toastStore` → `../../stores/toastStore` (unchanged)
- `../../stores/types` → `../../stores/types` (unchanged)

All imports go up two levels to `src/`, which is the same depth as before (was at `src/components/panels/`, now at `src/plugins/files/`). No changes needed.

Verify:

```bash
head -15 src/plugins/files/FilesPanel.tsx
```

- [ ] **Step 3: Create FilesPlugin definition**

Create `src/plugins/files/index.tsx`:

```tsx
import { FolderOpen } from 'lucide-solid'
import { definePlugin } from '../../lib/pluginRegistry'
import { fileActions, appActions } from '../../stores/runtimeStore'
import { FilesPanel } from './FilesPanel'

export const FilesPlugin = definePlugin({
  id: 'files',
  name: '文件列表',
  core: true,
  setup(ctx) {
    ctx.view({
      kind: 'panel',
      position: 'left',
      type: 'files',
      getDisplayText: () => '文件',
      component: FilesPanel,
    })

    ctx.ribbon({
      id: 'files',
      title: '文件列表',
      getIcon: () => <FolderOpen size={18} />,
      onClick: () => ctx.workspace.switchSidebarPanel('left', 'files'),
      isActive: () => ctx.workspace.activeSidebarType('left') === 'files',
    })

    ctx.contextMenu('file', (d) => {
      const path = d.path!
      return [
        { label: '重命名', action: () => fileActions.beginRename(path) },
        { separator: true as const },
        { label: '删除', action: () => { if (confirm(`删除 ${path.split('/').pop()}？`)) void fileActions.deleteFile(path) } },
      ]
    })

    ctx.contextMenu('directory', (d) => {
      const path = d.path!
      return [
        { label: '新建文件', action: () => fileActions.beginCreate('file', path + '/') },
        { label: '新建文件夹', action: () => fileActions.beginCreate('folder', path + '/') },
        { separator: true as const },
        { label: '删除文件夹', action: () => { if (confirm(`删除文件夹 ${path.split('/').pop()}？`)) void fileActions.deleteFolder(path) } },
      ]
    })
  },
})
```

- [ ] **Step 4: Verify TypeScript compiles with no errors**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/files/
git commit -m "feat: FilesPlugin - files panel, ribbon, file/dir context menus"
```

---

## Task 6: Create EditorPlugin

**Files:**
- Move: `src/components/viewer/EditorViewer.tsx` → `src/plugins/editor/EditorViewer.tsx`
- Move: `src/components/viewer/ImageViewer.tsx` → `src/plugins/editor/ImageViewer.tsx`
- Create: `src/plugins/editor/index.tsx`

- [ ] **Step 1: Move viewer files**

```bash
mkdir -p src/plugins/editor
mv src/components/viewer/EditorViewer.tsx src/plugins/editor/EditorViewer.tsx
mv src/components/viewer/ImageViewer.tsx src/plugins/editor/ImageViewer.tsx
```

- [ ] **Step 2: Verify imports in moved files**

```bash
head -15 src/plugins/editor/EditorViewer.tsx
head -10 src/plugins/editor/ImageViewer.tsx
```

Both were at `src/components/viewer/` and are now at `src/plugins/editor/`. Imports using `../../stores/...` and `../../lib/...` remain at the same depth — no changes needed.

- [ ] **Step 3: Create EditorPlugin definition**

The `IMAGE_EXTS` set was previously in `App.tsx`. Define it in the plugin.

Create `src/plugins/editor/index.tsx`:

```tsx
import { definePlugin } from '../../lib/pluginRegistry'
import { workspaceActions, activeLayout } from '../../stores/workspaceStore'
import { EditorViewer } from './EditorViewer'
import { ImageViewer } from './ImageViewer'

const IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif',
])

export const EditorPlugin = definePlugin({
  id: 'editor',
  name: '编辑器',
  core: true,
  setup(ctx) {
    ctx.view({
      kind: 'file',
      type: 'markdown',
      getDisplayText: (p) => p.split('/').pop()!,
      canAcceptFile: (ext) => ext === '.md',
      component: EditorViewer,
    })

    ctx.view({
      kind: 'file',
      type: 'image',
      getDisplayText: (p) => p.split('/').pop()!,
      canAcceptFile: (ext) => IMAGE_EXTS.has(ext),
      component: ImageViewer,
    })

    ctx.contextMenu('tab', (d) => {
      const leafId = d.leafId!
      const tabsId = d.tabsId!
      const root = activeLayout().root
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function findTabs(node: any): any {
        if (node.type === 'tabs' && node.id === tabsId) return node
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (node.type === 'split') for (const c of node.children) { const f = findTabs(c); if (f) return f }
        return null
      }
      const tabs = findTabs(root.main)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const siblings: any[] = tabs?.children ?? []
      const idx = siblings.findIndex((l) => l.id === leafId)
      return [
        { label: '关闭', action: () => workspaceActions.closeLeaf(leafId) },
        { label: '关闭其他', action: () => workspaceActions.closeOtherLeaves(tabsId, leafId), disabled: siblings.length <= 1 },
        { label: '关闭右侧', action: () => workspaceActions.closeRightLeaves(tabsId, leafId), disabled: idx >= siblings.length - 1 },
      ]
    })
  },
})
```

Note: `findTabsById` is an internal unexported function in `workspaceStore`. The tab context menu replicates the inline tree search from `App.tsx` as-is.

- [ ] **Step 4: Verify TypeScript compiles with no errors**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/editor/
git commit -m "feat: EditorPlugin - markdown/image viewers, tab context menu"
```

---

## Task 7: Create LinksPlugin

**Files:**
- Move content: `src/components/panels/LinksPanel.tsx` → `src/plugins/links/index.tsx`

- [ ] **Step 1: Create plugin file with component inline**

Create `src/plugins/links/index.tsx` by combining the component and plugin definition.

First read the current file content:

```bash
cat src/components/panels/LinksPanel.tsx
```

Then create `src/plugins/links/index.tsx` with the full component code followed by the plugin definition:

```tsx
// [paste full content of LinksPanel.tsx here, updating imports]
// imports: change ../../stores/... → ../../stores/... (same depth, no change needed)

import { createMemo, For, Show } from 'solid-js'
import { activeFilePath, activeLayout } from '../../stores/workspaceStore'
import { cacheStore } from '../../stores/cacheStore'
import { runtimeStore } from '../../stores/runtimeStore'
import { workspaceActions } from '../../stores/workspaceStore'
import { definePlugin } from '../../lib/pluginRegistry'
// ... rest of LinksPanel component code verbatim ...

export const LinksPlugin = definePlugin({
  id: 'links',
  name: '链接',
  core: true,
  setup(ctx) {
    ctx.view({
      kind: 'panel',
      position: 'right',
      type: 'links',
      getDisplayText: () => '链接',
      component: LinksPanel,
    })
  },
})
```

- [ ] **Step 2: Delete old file**

```bash
rm src/components/panels/LinksPanel.tsx
```

- [ ] **Step 3: Verify TypeScript compiles with no errors**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/plugins/links/index.tsx src/components/panels/LinksPanel.tsx
git commit -m "feat: LinksPlugin - links panel"
```

---

## Task 8: Create OutlinePlugin

**Files:**
- Move content: `src/components/panels/OutlinePanel.tsx` → `src/plugins/outline/index.tsx`

- [ ] **Step 1: Create plugin file with component inline**

```bash
cat src/components/panels/OutlinePanel.tsx
```

Create `src/plugins/outline/index.tsx`:

```tsx
// [paste full content of OutlinePanel.tsx, same import paths]
import { EditorView } from '@codemirror/view'
import { createMemo, For, Show } from 'solid-js'
import { activeLayout } from '../../stores/workspaceStore'
import { runtimeStore } from '../../stores/runtimeStore'
import { definePlugin } from '../../lib/pluginRegistry'
// ... rest of OutlinePanel component code verbatim ...

export const OutlinePlugin = definePlugin({
  id: 'outline',
  name: '大纲',
  core: true,
  setup(ctx) {
    ctx.view({
      kind: 'panel',
      position: 'right',
      type: 'outline',
      getDisplayText: () => '大纲',
      component: OutlinePanel,
    })
  },
})
```

- [ ] **Step 2: Delete old file**

```bash
rm src/components/panels/OutlinePanel.tsx
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/plugins/outline/index.tsx src/components/panels/OutlinePanel.tsx
git commit -m "feat: OutlinePlugin - outline panel"
```

---

## Task 9: Create TagsPlugin

**Files:**
- Move content: `src/components/panels/TagsPanel.tsx` → `src/plugins/tags/index.tsx`

- [ ] **Step 1: Create plugin file with component inline**

```bash
cat src/components/panels/TagsPanel.tsx
```

Create `src/plugins/tags/index.tsx`:

```tsx
// [paste full content of TagsPanel.tsx]
import { createMemo, createSignal, For, Show } from 'solid-js'
import { cacheStore } from '../../stores/cacheStore'
import { workspaceActions } from '../../stores/workspaceStore'
import { definePlugin } from '../../lib/pluginRegistry'
// ... rest of TagsPanel component code verbatim ...

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

- [ ] **Step 2: Delete old file**

```bash
rm src/components/panels/TagsPanel.tsx
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/plugins/tags/index.tsx src/components/panels/TagsPanel.tsx
git commit -m "feat: TagsPlugin - tags panel"
```

---

## Task 10: Create SearchPlugin

**Files:**
- Move content: `src/components/panels/SearchPanel.tsx` → `src/plugins/search/index.tsx`

- [ ] **Step 1: Create plugin file with component inline**

```bash
cat src/components/panels/SearchPanel.tsx
```

Create `src/plugins/search/index.tsx`:

```tsx
// [paste full content of SearchPanel.tsx]
import { createMemo, For, Show } from 'solid-js'
import { cacheStore } from '../../stores/cacheStore'
import { workspaceActions } from '../../stores/workspaceStore'
import { definePlugin } from '../../lib/pluginRegistry'
import type { ViewComponentProps } from '../../stores/types'
// ... rest of SearchPanel component code verbatim ...

export const SearchPlugin = definePlugin({
  id: 'search',
  name: '搜索',
  core: true,
  setup(ctx) {
    ctx.view({
      kind: 'panel',
      position: 'right',
      type: 'search',
      getDisplayText: () => '搜索',
      component: SearchPanel,
    })
  },
})
```

- [ ] **Step 2: Delete old file**

```bash
rm src/components/panels/SearchPanel.tsx
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/plugins/search/index.tsx src/components/panels/SearchPanel.tsx
git commit -m "feat: SearchPlugin - search panel"
```

---

## Task 11: Create AppPlugin

**Files:**
- Create: `src/plugins/app/index.tsx`

- [ ] **Step 1: Create AppPlugin**

Create `src/plugins/app/index.tsx`:

```tsx
import { Network, Settings as SettingsIcon } from 'lucide-solid'
import { definePlugin } from '../../lib/pluginRegistry'
import { appActions } from '../../stores/runtimeStore'

export const AppPlugin = definePlugin({
  id: 'app',
  name: '应用',
  core: true,
  setup(ctx) {
    ctx.ribbon({
      id: 'graph',
      title: '知识图谱',
      getIcon: () => <Network size={18} />,
      onClick: () => {},
    })

    ctx.ribbon({
      id: 'settings',
      title: '设置',
      getIcon: () => <SettingsIcon size={18} />,
      onClick: () => appActions.toggleSettings(),
      position: 'bottom',
    })
  },
})
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/plugins/app/index.tsx
git commit -m "feat: AppPlugin - settings and graph ribbon items"
```

---

## Task 12: Update App.tsx — replace raw registry calls with plugin registrations

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Rewrite App.tsx plugin section**

Replace the entire block of `registerRibbonItem`, `registerView`, `registerPlugin`, `startPlugins`, `registerContextMenu` calls in `src/App.tsx` with:

```tsx
import { FilesPlugin } from './plugins/files'
import { EditorPlugin } from './plugins/editor'
import { LinksPlugin } from './plugins/links'
import { OutlinePlugin } from './plugins/outline'
import { TagsPlugin } from './plugins/tags'
import { SearchPlugin } from './plugins/search'
import { AppPlugin } from './plugins/app'
import { CalendarPlugin } from './plugins/calendar'

registerPlugin(FilesPlugin)
registerPlugin(EditorPlugin)
registerPlugin(LinksPlugin)
registerPlugin(OutlinePlugin)
registerPlugin(TagsPlugin)
registerPlugin(SearchPlugin)
registerPlugin(AppPlugin)
registerPlugin(CalendarPlugin)
startPlugins()
```

Remove these now-unused imports from App.tsx:
- `registerRibbonItem` from `./lib/ribbonRegistry`
- `registerView` from `./lib/viewRegistry`
- `registerContextMenu` from `./lib/contextMenuRegistry`
- `FilesPanel`, `LinksPanel`, `OutlinePanel`, `TagsPanel`, `SearchPanel` from `./components/panels/*`
- `EditorViewer`, `ImageViewer` from `./components/viewer/*`
- `FolderOpen`, `Network`, `Settings` from `lucide-solid` (now owned by plugins)
- `activeSidebarType` from `./stores/workspaceStore` (if only used in removed code)
- `fileActions` from `./stores/runtimeStore` (if only used in removed context menus)

Also remove the `IMAGE_EXTS` constant from `App.tsx` (moved to `EditorPlugin`).

- [ ] **Step 2: Verify TypeScript compiles with no errors**

```bash
npx tsc --noEmit
```

Expected: no errors. If there are import errors, they point to any remaining references to removed items — fix them.

- [ ] **Step 3: Remove empty component directories**

```bash
rmdir src/components/panels src/components/viewer 2>/dev/null || true
```

(If either directory still has files, `rmdir` will fail safely — investigate before forcing.)

- [ ] **Step 4: Run the full test suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: App.tsx — replace raw registry calls with plugin registrations, remove empty component dirs"
```

---

## Task 13: Smoke test in browser

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Open vault and verify all panels work**

Open the app in the browser. Check:
- Files panel opens from ribbon (left sidebar)
- Calendar panel ribbon button toggles calendar panel
- Calendar page ribbon button opens full calendar view
- Links / Outline / Tags / Search panels all appear in right sidebar
- Markdown file opens in editor when clicked
- Image file opens in image viewer when clicked
- Right-click on a file → rename / delete context menu appears
- Right-click on a folder → new file / new folder / delete context menu appears
- Right-click on a tab → close / close others / close right context menu appears
- Settings ribbon button (bottom) opens settings panel

- [ ] **Step 3: Verify settings tabs**

Open Settings → Calendar tab should still appear with weekStartsMonday and showLunar toggles.

- [ ] **Step 4: Commit if any last fixes were needed**

If any browser issues were found and fixed, commit those fixes before marking done.
