# 模板功能（阶段一）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 symbol-notes 实现通用动态模板系统的阶段一：占位符引擎、可配置模板文件夹、文件树右键"从模板新建"(A)、Ribbon"插入模板"(B)，并让每日日记自动套用模板。

**Architecture:** 纯逻辑放进新建的共享 lib `src/lib/templates/`（占位符引擎、扩展日期格式化、模板发现、共享文件夹配置），入口集中在新建的 `src/plugins/templates/` 插件，并对 `pluginRegistry` 做两处基础设施增强（context menu 支持同类型多 factory、`workspace.insertAtCursor` 原语）。每日日记插件读取共享 `listTemplates()` 填充下拉并在创建时套用。

**Tech Stack:** SolidJS、CodeMirror 6、Vitest、TypeScript、Tailwind（`(--var)` 主题变量约定）。

**测试运行约定：** 项目无 `test` npm script。单测用 `npx vitest run <path>` 执行；类型检查用 `npx tsc --noEmit`。

**关于阶段二：** 编辑器内 `/` 斜杠命令（入口 C）是独立的 CM6 扩展，单独成一份计划，不在本计划内。

---

## 文件结构

新增：
- `src/lib/templates/formatDate.ts` — 扩展的日期格式化（YYYY/MM/DD/HH/mm/ss）
- `src/lib/templates/resolveTemplate.ts` — 占位符引擎
- `src/lib/templates/store.ts` — `templatesFolder` 配置信号 + `filterTemplateFiles`（纯函数）+ `listTemplates()`
- `src/lib/templates/index.ts` — barrel 导出
- `src/lib/templates/__tests__/formatDate.test.ts`
- `src/lib/templates/__tests__/resolveTemplate.test.ts`
- `src/lib/templates/__tests__/store.test.ts`
- `src/plugins/templates/pickerStore.ts` — TemplatePicker 的开启/关闭状态
- `src/plugins/templates/TemplatePicker.tsx` — 选择弹窗组件
- `src/plugins/templates/index.tsx` — 插件：设置页、Ribbon(B)、右键(A)

修改：
- `src/plugins/daily-note/formatDate.ts` — 改为从 lib 导入并 re-export `formatDate`，保留 `todayPath`
- `src/lib/pluginRegistry.ts` — context menu 多 factory；`workspace.insertAtCursor`
- `src/lib/__tests__/contextMenuRegistry.test.ts` — 增加多 factory 测试
- `src/plugins/daily-note/index.tsx` — 模板下拉 + 创建时套用
- `src/App.tsx` — 注册 `TemplatesPlugin`，挂载 `<TemplatePicker>`

---

## Task 1: 扩展 formatDate（加 HH/mm/ss）

**Files:**
- Create: `src/lib/templates/formatDate.ts`
- Create: `src/lib/templates/__tests__/formatDate.test.ts`
- Modify: `src/plugins/daily-note/formatDate.ts`

- [ ] **Step 1: 写失败测试**

Create `src/lib/templates/__tests__/formatDate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatDate } from '../formatDate'

describe('formatDate (extended)', () => {
  it('keeps date tokens working', () => {
    expect(formatDate(new Date(2026, 4, 29), 'YYYY-MM-DD')).toBe('2026-05-29')
  })
  it('formats HH:mm time tokens', () => {
    expect(formatDate(new Date(2026, 4, 29, 9, 5), 'HH:mm')).toBe('09:05')
  })
  it('formats seconds', () => {
    expect(formatDate(new Date(2026, 4, 29, 23, 59, 7), 'HH:mm:ss')).toBe('23:59:07')
  })
  it('does not let MM (month) collide with mm (minute)', () => {
    expect(formatDate(new Date(2026, 0, 2, 3, 4), 'MM mm')).toBe('01 04')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/lib/templates/__tests__/formatDate.test.ts`
Expected: FAIL（模块不存在 / Cannot find module '../formatDate'）

- [ ] **Step 3: 实现**

Create `src/lib/templates/formatDate.ts`:

```ts
export function formatDate(date: Date, fmt: string): string {
  const y = date.getFullYear().toString()
  const M = (date.getMonth() + 1).toString().padStart(2, '0')
  const D = date.getDate().toString().padStart(2, '0')
  const H = date.getHours().toString().padStart(2, '0')
  const m = date.getMinutes().toString().padStart(2, '0')
  const s = date.getSeconds().toString().padStart(2, '0')
  return fmt
    .replaceAll('YYYY', y)
    .replaceAll('MM', M)
    .replaceAll('DD', D)
    .replaceAll('HH', H)
    .replaceAll('mm', m)
    .replaceAll('ss', s)
}
```

- [ ] **Step 4: 让 daily-note 复用同一实现**

Replace the contents of `src/plugins/daily-note/formatDate.ts` with:

```ts
import { formatDate } from '../../lib/templates/formatDate'

export { formatDate }

export function todayPath(folder: string, dateFormat: string, date = new Date()): string {
  const name = formatDate(date, dateFormat) + '.md'
  return folder ? `${folder}/${name}` : name
}
```

- [ ] **Step 5: 运行新旧测试，确认全绿**

Run: `npx vitest run src/lib/templates/__tests__/formatDate.test.ts src/plugins/daily-note/__tests__/formatDate.test.ts`
Expected: PASS（两个文件、原有 daily-note 测试不回归）

- [ ] **Step 6: Commit**

```bash
git add src/lib/templates/formatDate.ts src/lib/templates/__tests__/formatDate.test.ts src/plugins/daily-note/formatDate.ts
git commit -m "feat(templates): add extended formatDate with time tokens"
```

---

## Task 2: 占位符引擎 resolveTemplate

**Files:**
- Create: `src/lib/templates/resolveTemplate.ts`
- Create: `src/lib/templates/__tests__/resolveTemplate.test.ts`

- [ ] **Step 1: 写失败测试**

Create `src/lib/templates/__tests__/resolveTemplate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveTemplate } from '../resolveTemplate'

const NOW = new Date(2026, 5, 7, 9, 5, 0) // 2026-06-07 周日 09:05

describe('resolveTemplate', () => {
  it('replaces {{date}} with default format', () => {
    expect(resolveTemplate('# {{date}}', { now: NOW }).text).toBe('# 2026-06-07')
  })
  it('replaces {{date:FMT}} with custom format', () => {
    expect(resolveTemplate('{{date:YYYY/MM/DD}}', { now: NOW }).text).toBe('2026/06/07')
  })
  it('replaces {{time}} with default HH:mm', () => {
    expect(resolveTemplate('{{time}}', { now: NOW }).text).toBe('09:05')
  })
  it('replaces {{yesterday}} and {{tomorrow}}', () => {
    expect(resolveTemplate('{{yesterday}}|{{tomorrow}}', { now: NOW }).text).toBe(
      '2026-06-06|2026-06-08',
    )
  })
  it('replaces {{weekday}} with Chinese weekday', () => {
    expect(resolveTemplate('{{weekday}}', { now: NOW }).text).toBe('周日')
  })
  it('replaces {{title}} with provided title', () => {
    expect(resolveTemplate('{{title}}', { now: NOW, title: '我的笔记' }).text).toBe('我的笔记')
  })
  it('replaces missing title with empty string', () => {
    expect(resolveTemplate('[{{title}}]', { now: NOW }).text).toBe('[]')
  })
  it('strips {{cursor}} and returns its offset', () => {
    const r = resolveTemplate('ab{{cursor}}cd', { now: NOW })
    expect(r.text).toBe('abcd')
    expect(r.cursorPos).toBe(2)
  })
  it('keeps first {{cursor}} as position, removes the rest', () => {
    const r = resolveTemplate('a{{cursor}}b{{cursor}}c', { now: NOW })
    expect(r.text).toBe('abc')
    expect(r.cursorPos).toBe(1)
  })
  it('returns null cursorPos when no cursor token', () => {
    expect(resolveTemplate('plain', { now: NOW }).cursorPos).toBeNull()
  })
  it('tolerates whitespace inside braces', () => {
    expect(resolveTemplate('{{ date }}', { now: NOW }).text).toBe('2026-06-07')
  })
  it('leaves unrecognized placeholders untouched', () => {
    expect(resolveTemplate('{{unknown}}', { now: NOW }).text).toBe('{{unknown}}')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/lib/templates/__tests__/resolveTemplate.test.ts`
Expected: FAIL（Cannot find module '../resolveTemplate'）

- [ ] **Step 3: 实现**

Create `src/lib/templates/resolveTemplate.ts`:

```ts
import { formatDate } from './formatDate'

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const CURSOR_SENTINEL = '\u0000'

export interface TemplateContext {
  title?: string
  now?: Date
}

export interface ResolvedTemplate {
  text: string
  cursorPos: number | null
}

function offsetDay(base: Date, days: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d
}

export function resolveTemplate(
  content: string,
  ctx: TemplateContext = {},
): ResolvedTemplate {
  const now = ctx.now ?? new Date()
  const title = ctx.title ?? ''

  const replaced = content.replace(/\{\{([^}]*)\}\}/g, (match, raw: string) => {
    const expr = raw.trim()
    if (expr === 'cursor') return CURSOR_SENTINEL
    const colon = expr.indexOf(':')
    const name = (colon === -1 ? expr : expr.slice(0, colon)).trim()
    const fmt = colon === -1 ? '' : expr.slice(colon + 1).trim()
    switch (name) {
      case 'date':
        return formatDate(now, fmt || 'YYYY-MM-DD')
      case 'time':
        return formatDate(now, fmt || 'HH:mm')
      case 'yesterday':
        return formatDate(offsetDay(now, -1), fmt || 'YYYY-MM-DD')
      case 'tomorrow':
        return formatDate(offsetDay(now, 1), fmt || 'YYYY-MM-DD')
      case 'weekday':
        return WEEKDAYS[now.getDay()]
      case 'title':
        return title
      default:
        return match
    }
  })

  const firstCursor = replaced.indexOf(CURSOR_SENTINEL)
  const cursorPos = firstCursor === -1 ? null : firstCursor
  const text = replaced.split(CURSOR_SENTINEL).join('')
  return { text, cursorPos }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/lib/templates/__tests__/resolveTemplate.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: Commit**

```bash
git add src/lib/templates/resolveTemplate.ts src/lib/templates/__tests__/resolveTemplate.test.ts
git commit -m "feat(templates): add placeholder resolution engine"
```

---

## Task 3: 共享配置与模板发现

**Files:**
- Create: `src/lib/templates/store.ts`
- Create: `src/lib/templates/__tests__/store.test.ts`

`filterTemplateFiles` 是纯函数（接收 files 字典 + 文件夹），便于单测；`listTemplates()` 用它包装读取 `vaultStore.files`。

- [ ] **Step 1: 写失败测试**

Create `src/lib/templates/__tests__/store.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { filterTemplateFiles } from '../store'
import type { FileMeta } from '../../../stores/types'

function file(path: string): FileMeta {
  const name = path.split('/').pop()!
  return {
    name,
    path,
    kind: 'file',
    parent: path.includes('/') ? path.split('/').slice(0, -1).join('/') : null,
    size: 0,
    mtime: 0,
    hash: '',
    frontmatter: {},
    outLinks: [],
    etags: [],
    tags: [],
    aliases: [],
    created: '',
    updated: null,
    dated: '',
    tasks: [],
  } as FileMeta
}

describe('filterTemplateFiles', () => {
  const files: Record<string, FileMeta> = {
    'templates/daily.md': file('templates/daily.md'),
    'templates/meeting.md': file('templates/meeting.md'),
    'templates/img.png': file('templates/img.png'),
    'journal/2026-06-07.md': file('journal/2026-06-07.md'),
    'root.md': file('root.md'),
  }

  it('returns only .md files under the configured folder, name without extension', () => {
    const result = filterTemplateFiles(files, 'templates')
    expect(result).toEqual([
      { name: 'daily', path: 'templates/daily.md' },
      { name: 'meeting', path: 'templates/meeting.md' },
    ])
  })
  it('tolerates trailing slash in folder', () => {
    expect(filterTemplateFiles(files, 'templates/').map((t) => t.name)).toEqual([
      'daily',
      'meeting',
    ])
  })
  it('returns empty array when folder is blank', () => {
    expect(filterTemplateFiles(files, '')).toEqual([])
  })
  it('returns empty array when folder has no markdown files', () => {
    expect(filterTemplateFiles(files, 'nonexistent')).toEqual([])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/lib/templates/__tests__/store.test.ts`
Expected: FAIL（Cannot find module '../store'）

- [ ] **Step 3: 实现**

Create `src/lib/templates/store.ts`:

```ts
import { createSignal } from 'solid-js'
import { loadFromStorage, saveToStorage } from '../localStorage'
import { vaultStore } from '../../vault'
import type { FileMeta } from '../../stores/types'

const KEY = 'sn-templates'

export interface TemplateEntry {
  name: string
  path: string
}

const initial = loadFromStorage<{ folder: string }>(
  KEY,
  { folder: 'templates' },
  (v) => typeof v === 'object' && v !== null,
)

const [templatesFolder, setTemplatesFolderSignal] = createSignal(initial.folder)

export { templatesFolder }

export function setTemplatesFolder(folder: string): void {
  setTemplatesFolderSignal(folder)
  saveToStorage(KEY, { folder })
}

export function filterTemplateFiles(
  files: Record<string, FileMeta>,
  folder: string,
): TemplateEntry[] {
  const trimmed = folder.replace(/\/+$/, '')
  if (!trimmed) return []
  const prefix = trimmed + '/'
  return Object.values(files)
    .filter(
      (f) =>
        f.kind === 'file' &&
        f.path.endsWith('.md') &&
        f.path.startsWith(prefix),
    )
    .map((f) => ({ name: f.name.replace(/\.md$/, ''), path: f.path }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function listTemplates(): TemplateEntry[] {
  return filterTemplateFiles(vaultStore.files, templatesFolder())
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/lib/templates/__tests__/store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/templates/store.ts src/lib/templates/__tests__/store.test.ts
git commit -m "feat(templates): add shared templates folder config and discovery"
```

---

## Task 4: barrel 导出

**Files:**
- Create: `src/lib/templates/index.ts`

- [ ] **Step 1: 创建 barrel**

Create `src/lib/templates/index.ts`:

```ts
export { formatDate } from './formatDate'
export { resolveTemplate } from './resolveTemplate'
export type { TemplateContext, ResolvedTemplate } from './resolveTemplate'
export {
  templatesFolder,
  setTemplatesFolder,
  filterTemplateFiles,
  listTemplates,
} from './store'
export type { TemplateEntry } from './store'
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add src/lib/templates/index.ts
git commit -m "feat(templates): add lib barrel exports"
```

---

## Task 5: context menu 注册支持同类型多 factory

当前 `_contextMenuRegistry` 是 `Map<string, ContextMenuFactory>`，`set` 会覆盖同类型。模板插件要往 `directory` 菜单追加项目而不覆盖 files 插件，需改为每类型多 factory 并合并输出（不同 factory 的非空结果之间插入分隔符）。

**Files:**
- Modify: `src/lib/pluginRegistry.ts:171-192` 与 `:304-307`
- Modify: `src/lib/__tests__/contextMenuRegistry.test.ts`

- [ ] **Step 1: 增加多 factory 测试**

Append to `src/lib/__tests__/contextMenuRegistry.test.ts` inside the file (add a new `describe`):

```ts
describe('multiple factories per type', () => {
  it('merges items from all factories with a separator between groups', () => {
    const a = () => [{ label: 'A', action: () => {} }]
    const b = () => [{ label: 'B', action: () => {} }]
    registerContextMenu('directory', a)
    registerContextMenu('directory', b)
    const items = getMenuItems('directory', {} as DOMStringMap)
    expect(items).toHaveLength(3)
    expect((items[0] as { label: string }).label).toBe('A')
    expect('separator' in items[1]).toBe(true)
    expect((items[2] as { label: string }).label).toBe('B')
  })
  it('unregisters only the given factory', () => {
    const a = () => [{ label: 'A', action: () => {} }]
    const b = () => [{ label: 'B', action: () => {} }]
    registerContextMenu('directory', a)
    registerContextMenu('directory', b)
    unregisterContextMenu('directory', a)
    const items = getMenuItems('directory', {} as DOMStringMap)
    expect(items).toHaveLength(1)
    expect((items[0] as { label: string }).label).toBe('B')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/lib/__tests__/contextMenuRegistry.test.ts`
Expected: FAIL（多 factory 时第二次 register 覆盖了第一次 / unregister 签名不接受第二参数）

- [ ] **Step 3: 改注册表为多 factory**

In `src/lib/pluginRegistry.ts`, replace lines 173-192 (the registry declaration through `_resetContextMenuForTest`) with:

```ts
const _contextMenuRegistry = new Map<string, ContextMenuFactory[]>()

export function registerContextMenu(
  type: string,
  factory: ContextMenuFactory,
): void {
  const list = _contextMenuRegistry.get(type)
  if (list) list.push(factory)
  else _contextMenuRegistry.set(type, [factory])
}

export function unregisterContextMenu(
  type: string,
  factory?: ContextMenuFactory,
): void {
  if (!factory) {
    _contextMenuRegistry.delete(type)
    return
  }
  const list = _contextMenuRegistry.get(type)
  if (!list) return
  const next = list.filter((f) => f !== factory)
  if (next.length > 0) _contextMenuRegistry.set(type, next)
  else _contextMenuRegistry.delete(type)
}

export function getMenuItems(type: string, dataset: DOMStringMap): MenuItem[] {
  const list = _contextMenuRegistry.get(type)
  if (!list || list.length === 0) return []
  const groups = list.map((f) => f(dataset)).filter((g) => g.length > 0)
  const out: MenuItem[] = []
  groups.forEach((g, i) => {
    if (i > 0) out.push({ separator: true })
    out.push(...g)
  })
  return out
}

export function _resetContextMenuForTest(): void {
  _contextMenuRegistry.clear()
}
```

- [ ] **Step 4: 让 ctx 清理时按 factory 注销**

In `src/lib/pluginRegistry.ts:304-307`, change the `contextMenu` ctx method to pass the factory to unregister:

```ts
      contextMenu(type, factory) {
        registerContextMenu(type, factory)
        onCleanup(() => unregisterContextMenu(type, factory))
      },
```

- [ ] **Step 5: 运行全部 registry 测试，确认全绿**

Run: `npx vitest run src/lib/__tests__/contextMenuRegistry.test.ts`
Expected: PASS（原有单 factory 用例 + 新增多 factory 用例）

- [ ] **Step 6: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 7: Commit**

```bash
git add src/lib/pluginRegistry.ts src/lib/__tests__/contextMenuRegistry.test.ts
git commit -m "feat(plugin): support multiple context menu factories per type"
```

---

## Task 6: workspace.insertAtCursor 原语

往当前激活编辑器光标处插入文本（入口 B 用，阶段二也可复用）。利用 `leafInstances[activeLeafId].cmView`（EditorViewer 已注册实时 EditorView）。

**Files:**
- Modify: `src/lib/pluginRegistry.ts`（接口 `:223-252` 区段、import、实现 `:338-359` 区段）

- [ ] **Step 1: 确保 leafInstances 已导入**

In `src/lib/pluginRegistry.ts`, the workspace store import block (around `:12`) imports `workspaceActions`, `activeLayout` 等。Add `leafInstances` to that import from `'../stores/workspaceStore'`（与 `activeLayout` 同源）。确认最终包含：

```ts
import {
  activeLayout,
  leafInstances,
  workspaceActions,
} from '../stores/workspaceStore'
```

（保留该 import 中原有的其它命名导出，只新增 `leafInstances`。）

- [ ] **Step 2: 在 workspace 接口加方法声明**

In the `PluginContext.workspace` interface (around `:223-252`), add after `activeHeadings(): Heading[]`:

```ts
    /** Insert text at the cursor of the active editor. cursorPos = offset within
     *  the inserted text to place the caret (null/undefined → end of insert).
     *  Returns false when no editor is active. */
    insertAtCursor(text: string, cursorPos?: number | null): boolean
```

- [ ] **Step 3: 实现该方法**

In the `workspace: { ... }` object of the ctx (the block containing `activeHeadings: () => {...}`, around `:355-358`), add a sibling property:

```ts
        insertAtCursor: (text, cursorPos) => {
          const id = activeLayout().activeLeafId
          if (!id) return false
          const view = leafInstances[id]?.cmView
          if (!view) return false
          const sel = view.state.selection.main
          const caret = sel.from + (cursorPos ?? text.length)
          view.dispatch({
            changes: { from: sel.from, to: sel.to, insert: text },
            selection: { anchor: caret },
          })
          view.focus()
          return true
        },
```

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 5: Commit**

```bash
git add src/lib/pluginRegistry.ts
git commit -m "feat(plugin): add workspace.insertAtCursor primitive"
```

---

## Task 7: TemplatePicker 状态 store

弹窗用 Promise 返回选择结果，open 时由调用方 await。

**Files:**
- Create: `src/plugins/templates/pickerStore.ts`

- [ ] **Step 1: 创建 store**

Create `src/plugins/templates/pickerStore.ts`:

```ts
import { createSignal } from 'solid-js'

export type PickerMode = 'create' | 'insert'

export interface PickerResult {
  templatePath: string
  /** Only present in 'create' mode: the new note name (without extension). */
  name?: string
}

interface PickerState {
  mode: PickerMode
  resolve: (result: PickerResult | null) => void
}

const [pickerState, setPickerState] = createSignal<PickerState | null>(null)

export { pickerState }

export function openTemplatePicker(mode: PickerMode): Promise<PickerResult | null> {
  // Cancel any in-flight picker first.
  const existing = pickerState()
  if (existing) existing.resolve(null)
  return new Promise((resolve) => setPickerState({ mode, resolve }))
}

export function resolveTemplatePicker(result: PickerResult | null): void {
  const state = pickerState()
  if (state) state.resolve(result)
  setPickerState(null)
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add src/plugins/templates/pickerStore.ts
git commit -m "feat(templates): add template picker store"
```

---

## Task 8: TemplatePicker 组件

模态弹窗，沿用 `ConfirmModal` 的遮罩/卡片样式约定。create 模式带文件名输入，insert 模式仅列表。空模板时显示提示。

**Files:**
- Create: `src/plugins/templates/TemplatePicker.tsx`

- [ ] **Step 1: 创建组件**

Create `src/plugins/templates/TemplatePicker.tsx`:

```tsx
import { Show, For, createSignal, createMemo, createEffect } from 'solid-js'
import { listTemplates } from '../../lib/templates'
import { pickerState, resolveTemplatePicker } from './pickerStore'

export function TemplatePicker() {
  const [selected, setSelected] = createSignal<string | null>(null)
  const [name, setName] = createSignal('')
  const templates = createMemo(() => (pickerState() ? listTemplates() : []))

  // Reset selection/name whenever the picker (re)opens.
  createEffect(() => {
    if (pickerState()) {
      const first = templates()[0]
      setSelected(first ? first.path : null)
      setName('')
    }
  })

  const mode = () => pickerState()?.mode ?? 'insert'

  function confirm() {
    const path = selected()
    if (!path) return
    if (mode() === 'create' && !name().trim()) return
    resolveTemplatePicker({
      templatePath: path,
      name: mode() === 'create' ? name().trim() : undefined,
    })
  }

  return (
    <Show when={pickerState()}>
      <div
        class="fixed inset-0 z-[10000] flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.55)' }}
        onClick={() => resolveTemplatePicker(null)}
      >
        <div
          class="bg-(--bg-elevated) border border-(--border-2) rounded-lg shadow-xl p-5 flex flex-col gap-4"
          style={{ 'min-width': '340px', 'max-width': '480px' }}
          onClick={(e) => e.stopPropagation()}
        >
          <h2 class="text-[15px] font-semibold text-(--text)">
            {mode() === 'create' ? '从模板新建' : '插入模板'}
          </h2>

          <Show
            when={templates().length > 0}
            fallback={
              <p class="text-[13px] text-(--text-3) leading-relaxed">
                没有可用模板。请在设置 → 模板 中配置模板文件夹，并在其中放入 .md 模板文件。
              </p>
            }
          >
            <div class="flex flex-col gap-1 max-h-[260px] overflow-auto">
              <For each={templates()}>
                {(t) => (
                  <button
                    class={`text-left px-2 py-1.5 text-[13px] rounded border transition-colors ${
                      selected() === t.path
                        ? 'border-(--accent) text-(--accent) bg-(--accent)/10'
                        : 'border-transparent text-(--text-2) hover:bg-(--bg-active)'
                    }`}
                    onClick={() => setSelected(t.path)}
                    onDblClick={confirm}
                  >
                    {t.name}
                  </button>
                )}
              </For>
            </div>

            <Show when={mode() === 'create'}>
              <input
                type="text"
                placeholder="新笔记名称"
                class="px-2 py-1 text-[13px] rounded border border-(--border) bg-(--bg-base) text-(--text) focus:outline-none focus:border-(--accent)"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                onKeyDown={(e) => e.key === 'Enter' && confirm()}
              />
            </Show>
          </Show>

          <div class="flex justify-end gap-2">
            <button
              class="px-3 py-1.5 text-[13px] rounded border border-(--border-2) text-(--text-3) hover:text-(--text) transition-colors"
              onClick={() => resolveTemplatePicker(null)}
            >
              取消
            </button>
            <Show when={templates().length > 0}>
              <button
                class="px-3 py-1.5 text-[13px] rounded border border-(--accent) text-(--accent) hover:bg-(--accent)/10 transition-colors"
                onClick={confirm}
              >
                {mode() === 'create' ? '创建' : '插入'}
              </button>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  )
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add src/plugins/templates/TemplatePicker.tsx
git commit -m "feat(templates): add TemplatePicker modal component"
```

---

## Task 9: templates 插件（设置页 + Ribbon B + 右键 A）

**Files:**
- Create: `src/plugins/templates/index.tsx`

参考 `src/plugins/daily-note/index.tsx` 的 `TextRow` 与设置页写法、`src/plugins/files/index.tsx` 的 contextMenu 写法、`src/stores/toastStore.ts` 的报错提示。

- [ ] **Step 1: 确认 toast API**

Run: `grep -n "export" src/stores/toastStore.ts`
Expected: 看到一个显示错误/消息的导出（如 `showToast` 或 `toast`）。下一步代码使用 `showToast`；若实际命名不同，按实际命名替换 import 与调用。

- [ ] **Step 2: 创建插件**

Create `src/plugins/templates/index.tsx`:

```tsx
import { FileText } from 'lucide-solid'
import { definePlugin } from '../../lib/pluginRegistry'
import type { SettingsTabProps } from '../../lib/pluginRegistry'
import {
  listTemplates,
  resolveTemplate,
  templatesFolder,
  setTemplatesFolder,
} from '../../lib/templates'
import { showToast } from '../../stores/toastStore'
import { openTemplatePicker } from './pickerStore'

function TemplatesSettings(_props: SettingsTabProps) {
  return (
    <div class="flex flex-col gap-5">
      <div class="flex flex-col gap-1">
        <div class="text-[13px] t-base font-medium">模板文件夹</div>
        <div class="text-[11px] t-3 leading-relaxed">
          相对 vault 根目录。该文件夹下的 .md 文件会作为模板。
        </div>
        <input
          type="text"
          class="mt-1 px-2 py-1 text-[13px] rounded border border-(--border) bg-(--bg-base) text-(--text) focus:outline-none focus:border-(--accent)"
          value={templatesFolder()}
          onInput={(e) => setTemplatesFolder(e.currentTarget.value)}
        />
      </div>
    </div>
  )
}

export const TemplatesPlugin = definePlugin({
  id: 'templates',
  name: '模板',
  description: '动态模板：从模板新建笔记或插入到当前笔记',
  defaultEnabled: true,
  setup(ctx) {
    async function applyToNewNote(templatePath: string, name: string, folder: string) {
      const targetDir = folder.replace(/\/+$/, '')
      const path = targetDir ? `${targetDir}/${name}` : name
      const created = await ctx.vault.createFile(path)
      if (!created) return
      try {
        const raw = await ctx.vault.readFile(templatePath)
        const { text } = resolveTemplate(raw, { title: name })
        await ctx.vault.saveFile(created, text)
      } catch {
        showToast('读取模板失败，已创建空文件')
      }
      ctx.workspace.openFile(created)
    }

    // 入口 A: 文件树文件夹右键 → 从模板新建
    ctx.contextMenu('directory', (d) => {
      const dir = d.path ?? ''
      return [
        {
          label: '从模板新建',
          action: () => {
            void openTemplatePicker('create').then((result) => {
              if (!result || !result.name) return
              void applyToNewNote(result.templatePath, result.name, dir)
            })
          },
        },
      ]
    })

    // 入口 B: Ribbon → 插入模板（到当前编辑器；无编辑器则新建）
    ctx.ribbon({
      id: 'templates-insert',
      title: '插入模板',
      getIcon: () => <FileText size={18} />,
      onClick: () => {
        if (listTemplates().length === 0) {
          showToast('没有可用模板，请先在设置中配置模板文件夹')
          return
        }
        void openTemplatePicker('insert').then(async (result) => {
          if (!result) return
          try {
            const raw = await ctx.vault.readFile(result.templatePath)
            const { text, cursorPos } = resolveTemplate(raw, {})
            const inserted = ctx.workspace.insertAtCursor(text, cursorPos)
            if (!inserted) {
              // 无激活编辑器 → 回退到新建流程
              void openTemplatePicker('create').then((r2) => {
                if (!r2 || !r2.name) return
                void applyToNewNote(r2.templatePath, r2.name, '')
              })
            }
          } catch {
            showToast('读取模板失败')
          }
        })
      },
      isActive: () => false,
    })

    ctx.settings.tab({
      name: '模板',
      component: TemplatesSettings,
    })
  },
})
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误（若 `showToast`/`SettingsTabProps` 命名与实际不符，按实际修正）

- [ ] **Step 4: Commit**

```bash
git add src/plugins/templates/index.tsx
git commit -m "feat(templates): add templates plugin (settings, ribbon, context menu)"
```

---

## Task 10: 注册插件并挂载 TemplatePicker

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 注册插件**

In `src/App.tsx`, add an import near the other plugin imports (around `:20-21`):

```ts
import { TemplatesPlugin } from './plugins/templates'
```

And register it alongside the others (after `registerPlugin(SearchPlugin)`, around `:58`):

```ts
registerPlugin(TemplatesPlugin)
```

- [ ] **Step 2: 挂载弹窗组件**

In `src/App.tsx`, find where `ConfirmModal` / `ContextMenu` / `ToastContainer` are rendered in JSX, add `<TemplatePicker />` next to them. Add the import:

```ts
import { TemplatePicker } from './plugins/templates/TemplatePicker'
```

and render `<TemplatePicker />` adjacent to `<ConfirmModal />` (same JSX parent).

Run to locate the spot: `grep -n "ConfirmModal\|ContextMenu\|ToastContainer" src/App.tsx`

- [ ] **Step 3: 类型检查 + 构建冒烟**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 4: 手动验证（开发服务器）**

Run: `npm run dev`，在浏览器中打开 vault：
1. 设置 → 模板：设置模板文件夹（如 `templates`），在该文件夹建一个 `daily.md`，内容含 `# {{date}} {{weekday}}` 与 `{{cursor}}`。
2. 文件夹右键 → "从模板新建" → 选模板、填名字 → 应创建并打开，`{{date}}`/`{{weekday}}` 被替换，`{{cursor}}` 被移除。
3. 打开任意笔记，光标置于某处 → 点 Ribbon "插入模板" → 选模板 → 文本插入到光标处，光标落在 `{{cursor}}` 位置。
4. 关闭所有编辑器后点 Ribbon "插入模板" → 应回退为新建流程。

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(templates): register plugin and mount TemplatePicker"
```

---

## Task 11: 每日日记联动

**Files:**
- Modify: `src/plugins/daily-note/index.tsx`

在 daily-note 设置页加"模板"下拉（选项来自 `listTemplates()`，含"无"），创建日记后套用模板。

- [ ] **Step 1: 扩展 DEFAULTS 与 import**

In `src/plugins/daily-note/index.tsx`, add to imports:

```ts
import { For } from 'solid-js'
import { listTemplates, resolveTemplate } from '../../lib/templates'
```

Change `DEFAULTS` (`:7-11`) to include a template path:

```ts
const DEFAULTS = {
  folder: 'journal',
  dateFormat: 'YYYY-MM-DD',
  autoCreate: false,
  template: '', // 模板文件 path；空 = 不使用
}
```

- [ ] **Step 2: 在设置页加模板下拉**

In `DailyNoteSettings` (`:69-93`), add after the `ToggleRow`:

```tsx
      <div class="flex flex-col gap-1">
        <div class="text-[13px] t-base font-medium">模板</div>
        <div class="text-[11px] t-3 leading-relaxed">
          新建日记时套用的模板（来自“模板”设置里配置的文件夹）。
        </div>
        <select
          class="mt-1 px-2 py-1 text-[13px] rounded border border-(--border) bg-(--bg-base) text-(--text) focus:outline-none focus:border-(--accent)"
          value={config().template as string}
          onChange={(e) => props.setConfig({ template: e.currentTarget.value })}
        >
          <option value="">无</option>
          <For each={listTemplates()}>
            {(t) => <option value={t.path}>{t.name}</option>}
          </For>
        </select>
      </div>
```

- [ ] **Step 3: 创建后套用模板**

In `setup` → `openToday` (`:102-135`), extract a helper that creates and applies the template, and use it in both the `autoCreate` branch and the modal "创建" button.

Replace the body of `openToday` from the `autoCreate` check onward with:

```ts
      const { template } = ctx.settings.getConfig(DEFAULTS)

      const createWithTemplate = async () => {
        const created = await ctx.vault.createFile(path)
        if (!created) return
        const tpl = template as string
        if (tpl) {
          try {
            const raw = await ctx.vault.readFile(tpl)
            const fileName = path.split('/').pop()!.replace(/\.md$/, '')
            const { text } = resolveTemplate(raw, { title: fileName })
            await ctx.vault.saveFile(created, text)
          } catch {
            // 模板读取失败：保持空文件
          }
        }
        ctx.workspace.openFile(created)
      }

      if (autoCreate) {
        await createWithTemplate()
        return
      }

      showModal({
        title: '创建今日日记',
        message: `创建 ${path}？`,
        buttons: [
          { label: '取消', variant: 'ghost', onClick: closeModal },
          {
            label: '创建',
            variant: 'primary',
            onClick: () => {
              closeModal()
              void createWithTemplate()
            },
          },
        ],
      })
```

（注意：保留函数顶部已有的 `const { folder, dateFormat, autoCreate } = ctx.settings.getConfig(DEFAULTS)`、`const path = todayPath(...)` 以及"文件已存在则直接打开"的早返回逻辑不变；本步只改 autoCreate 分支及之后。）

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 5: 运行 daily-note 既有测试，确认无回归**

Run: `npx vitest run src/plugins/daily-note/__tests__/formatDate.test.ts`
Expected: PASS

- [ ] **Step 6: 手动验证**

`npm run dev`：在 daily-note 设置里选一个模板 → 点 Ribbon "今日日记" → 新建的日记应套用模板，`{{date}}`/`{{weekday}}` 等被替换为今天。未选模板时仍创建空文件。

- [ ] **Step 7: Commit**

```bash
git add src/plugins/daily-note/index.tsx
git commit -m "feat(daily-note): apply selected template on note creation"
```

---

## 收尾验证

- [ ] **全量单测**

Run: `npx vitest run`
Expected: 全绿（含 formatDate、resolveTemplate、store、contextMenuRegistry 等）

- [ ] **类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **构建冒烟**

Run: `npm run build`
Expected: 构建成功
