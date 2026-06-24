# 时间轴日记脉 + 日期对齐网格 + 出链箭头 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把多列时间轴改造成「日记列可任意摆放的日期对齐网格」，BFS 遍历到日记不再展开，并在有出链关系的卡片间画可配样式（直线/折线/曲线 + 颜色）的箭头。

**Architecture:** 纯逻辑分三层——`columns.ts` 增 `by:'diary'` 过滤、`selection.ts` 的 BFS 跳过日记展开、新增 `grid.ts` 把事件铺成「日期行 × 列」网格并算出箭头边集。`TimelineView` 用 CSS Grid 按日期对齐渲染，叠一层 SVG 画箭头。所有归列/网格逻辑是纯函数、可单测；箭头几何在 DOM 层手动验证。

**Tech Stack:** SolidJS、TypeScript、CSS Grid、SVG、Vitest（node 环境）。

依据：`docs/superpowers/specs/2026-06-24-timeline-diary-grid-arrows-design.md`。

## Global Constraints

- 语言：注释 / commit / UI 文案中文为主；变量与类型名英文。
- 组件用 **SolidJS**（`createSignal`/`createMemo`/`<For>`/`<Show>`），不要写 React。
- 纯逻辑配 `__tests__`；测试环境 node；运行 `npx vitest run <file>`。
- 提交前 `npm run build`（含 tsc）与 `npx vitest run` 均须通过。
- commit：`type(scope): 描述`，结尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- 已在分支 `feat/timeline-diary-grid`；spec 已提交。
- **日记判定**：`extractDateFromName(path) != null`（`src/vault` 已 re-export）。
- **新参数一律设可选默认**，避免破坏 `TimelineView` 既有调用、保持每个任务 build 绿。

---

## File Structure

| 文件 | 责任 |
|---|---|
| `src/plugins/timeline/columns.ts` | `ColumnFilter` 增 `{by:'diary'}`；`assignColumns`/`matches` 加可选 `isDiary` |
| `src/plugins/timeline/selection.ts` | `buildNeighborhood` opts 加可选 `isDiary`，跳过日记展开 |
| `src/plugins/timeline/grid.ts`（新） | `buildGrid` 把事件铺成网格 + 箭头边集 |
| `src/plugins/timeline/TimelineView.tsx` | CSS Grid 日期对齐渲染 + 列重排/日记列配置 + SVG 箭头叠层 + 箭头样式 |

权威类型（后续任务引用）：

```ts
// columns.ts
export type ColumnFilter =
  | { by: 'diary' }
  | { by: 'heading'; value: string }
  | { by: 'tag'; value: string }
  | { by: 'direction'; value: 'out' | 'in' }
  | null
export type Column = { filter: ColumnFilter; priority: number; repeat: boolean }
export function assignColumns(
  noteIds: string[],
  edgesByNote: Map<string, Edge[]>,
  columns: Column[],
  isDiary?: (path: string) => boolean,
): string[][]

// grid.ts
export interface Grid {
  rows: string[]
  cells: Map<string, Map<number, TimelineEvent[]>>
  arrows: { from: string; to: string }[]
}
export function buildGrid(
  events: TimelineEvent[],
  columns: Column[],
  edges: Edge[],
  isDiary: (path: string) => boolean,
): Grid

// TimelineView 内部
type ArrowStyle = { shape: 'straight' | 'elbow' | 'curve'; color: string }
```

---

## Task 1: `columns.ts` 增日记过滤

`ColumnFilter` 增 `{by:'diary'}`，`assignColumns`/`matches` 收可选 `isDiary`（默认永不匹配，保持既有调用不破）。

**Files:**
- Modify: `src/plugins/timeline/columns.ts`
- Test: `src/plugins/timeline/__tests__/columns.test.ts`（追加）

**Interfaces:**
- Produces: `ColumnFilter` 增 `{by:'diary'}`；`assignColumns(noteIds, edgesByNote, columns, isDiary?)`；`matches` 内部按 `isDiary(note)` 处理 diary。

- [ ] **Step 1: 追加失败测试**

在 `src/plugins/timeline/__tests__/columns.test.ts` 末尾追加（复用文件顶部已有的 `describe/it/expect`、`Edge`、`assignColumns`/`Column` import）：

```ts
describe('assignColumns by:diary', () => {
  const edges = new Map<string, Edge[]>()
  const notes = ['journal/2026-06-20.md', 'plan.md']
  const isDiary = (p: string) => /\d{4}-\d{2}-\d{2}/.test(p)

  it('diary 列按 isDiary 归入', () => {
    const cols: Column[] = [
      { filter: { by: 'diary' }, priority: 0, repeat: false },
      { filter: null, priority: 1, repeat: false },
    ]
    const [c0, c1] = assignColumns(notes, edges, cols, isDiary)
    expect(c0).toEqual(['journal/2026-06-20.md'])
    expect(c1).toEqual(['plan.md'])
  })

  it('缺省 isDiary 时 diary 列不匹配', () => {
    const cols: Column[] = [{ filter: { by: 'diary' }, priority: 0, repeat: false }]
    expect(assignColumns(notes, edges, cols)).toEqual([[]])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/plugins/timeline/__tests__/columns.test.ts`
Expected: FAIL（diary 分支未实现 / 类型不含 diary）

- [ ] **Step 3: 实现**

把 `src/plugins/timeline/columns.ts` 改为：

```ts
import type { Edge } from './selection'

export type ColumnFilter =
  | { by: 'diary' }
  | { by: 'heading'; value: string }
  | { by: 'tag'; value: string }
  | { by: 'direction'; value: 'out' | 'in' }
  | null

export type Column = { filter: ColumnFilter; priority: number; repeat: boolean }

function matches(
  filter: ColumnFilter,
  edges: Edge[],
  note: string,
  isDiary: (path: string) => boolean,
): boolean {
  if (filter === null) return true
  if (filter.by === 'diary') return isDiary(note)
  return edges.some(e => {
    if (filter.by === 'heading') return e.headingPath.includes(filter.value)
    if (filter.by === 'tag') return e.lineTags.includes(filter.value)
    return e.dir === filter.value
  })
}

/** 每个 note 按 priority 升序找第一个匹配列归入；repeat 列额外把所有匹配项也收一份。 */
export function assignColumns(
  noteIds: string[],
  edgesByNote: Map<string, Edge[]>,
  columns: Column[],
  isDiary: (path: string) => boolean = () => false,
): string[][] {
  const order = columns
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.priority - b.c.priority)
  const out: string[][] = columns.map(() => [])

  for (const note of noteIds) {
    const edges = edgesByNote.get(note) ?? []
    let claimed = false
    for (const { c, i } of order) {
      if (!matches(c.filter, edges, note, isDiary)) continue
      if (c.repeat) { out[i].push(note); continue }
      if (!claimed) { out[i].push(note); claimed = true }
    }
  }
  return out
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/plugins/timeline/__tests__/columns.test.ts`
Expected: PASS（含既有 4 例 + 新增 2 例）

- [ ] **Step 5: 类型检查（既有调用不破）**

Run: `npm run build`
Expected: tsc 通过（`isDiary` 可选，`TimelineView` 现有 `assignColumns(...)` 三参调用仍合法）

- [ ] **Step 6: 提交**

```bash
git add src/plugins/timeline/columns.ts src/plugins/timeline/__tests__/columns.test.ts
git commit -m "feat(timeline): ColumnFilter 增 by:diary，assignColumns 收 isDiary

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: BFS 跳过日记展开

`buildNeighborhood` opts 加可选 `isDiary`，展开时跳过日记节点（仍保留指向它的边）。

**Files:**
- Modify: `src/plugins/timeline/selection.ts`
- Test: `src/plugins/timeline/__tests__/selection.test.ts`（追加）

**Interfaces:**
- Consumes: 无新增
- Produces: `buildNeighborhood(focus, files, backlinkMap, resolve, { maxFiles, isDiary? })`

- [ ] **Step 1: 追加失败测试**

在 `src/plugins/timeline/__tests__/selection.test.ts` 末尾追加：

```ts
describe('buildNeighborhood isDiary 跳过展开', () => {
  const files = {
    'A.md': { outLinks: [link('2026-06-20.md')] },
    '2026-06-20.md': { outLinks: [link('Z.md')] }, // 日记的出链 Z 不应被展开
    'Z.md': { outLinks: [] as WikiLinkInfo[] },
  }
  const backlinkMap = { '2026-06-20.md': ['A.md'], 'Z.md': ['2026-06-20.md'] }
  const resolve = (t: string) => (t in files ? t : null)
  const isDiary = (p: string) => /\d{4}-\d{2}-\d{2}/.test(p)

  it('日记被收下但不展开 → Z 不进邻域；指向日记的边保留', () => {
    const n = buildNeighborhood('A.md', files, backlinkMap, resolve, { maxFiles: 99, isDiary })
    expect(n.notes.map(x => x.path).sort()).toEqual(['2026-06-20.md', 'A.md'])
    expect(n.edges.some(e => e.from === 'A.md' && e.to === '2026-06-20.md')).toBe(true)
  })
})
```

> 文件顶部已有 `link` 辅助与 `WikiLinkInfo`/`buildNeighborhood` import，沿用。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/plugins/timeline/__tests__/selection.test.ts`
Expected: FAIL（Z.md 被展开进了邻域 / opts 不接受 isDiary）

- [ ] **Step 3: 实现**

`src/plugins/timeline/selection.ts` 改 `buildNeighborhood` 签名与循环：

```ts
export function buildNeighborhood(
  focus: string,
  files: Record<string, Pick<FileMeta, 'outLinks'>>,
  backlinkMap: Record<string, string[]>,
  resolve: (target: string) => string | null,
  opts: { maxFiles: number; isDiary?: (path: string) => boolean },
): Neighborhood {
```

把循环体首行加守卫（`isDiary` 缺省视为永不跳过）：

```ts
  const isDiary = opts.isDiary ?? (() => false)
  // …
  while (frontier.length && hop.size < opts.maxFiles) {
    const next: string[] = []
    for (const cur of frontier) {
      if (isDiary(cur) && cur !== focus) continue   // 日记是叶子：收下但不展开其出/入链
      // …原有出边 / 入边扩展不变…
    }
    depth++
    if (hop.size >= opts.maxFiles) break
    frontier = next
  }
```

> `const isDiary = ...` 放在 `let frontier = [focus]` 之前。其余逻辑不动。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/plugins/timeline/__tests__/selection.test.ts`
Expected: PASS（既有用例 + 新增）

- [ ] **Step 5: 类型检查**

Run: `npm run build`
Expected: 通过（`TimelineView` 现有 `{ maxFiles: maxFiles() }` 调用仍合法，因 `isDiary` 可选）

- [ ] **Step 6: 提交**

```bash
git add src/plugins/timeline/selection.ts src/plugins/timeline/__tests__/selection.test.ts
git commit -m "feat(timeline): buildNeighborhood isDiary 跳过日记展开

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `buildGrid` 网格数据模型

**Files:**
- Create: `src/plugins/timeline/grid.ts`
- Test: `src/plugins/timeline/__tests__/grid.test.ts`

**Interfaces:**
- Consumes: `TimelineEvent`（events.ts）、`Edge`（selection.ts）、`Column`/`assignColumns`（columns.ts）、`edgesByNote`（events.ts）
- Produces: `Grid` 与 `buildGrid(events, columns, edges, isDiary)`（见权威类型）

- [ ] **Step 1: 写失败测试**

```ts
// src/plugins/timeline/__tests__/grid.test.ts
import { describe, it, expect } from 'vitest'
import { buildGrid } from '../grid'
import type { TimelineEvent } from '../events'
import type { Edge } from '../selection'
import type { Column } from '../columns'

const ev = (path: string, date: string): TimelineEvent => ({
  path, date, title: path, tags: [], linkCount: 0, kind: 'note',
})
const edge = (from: string, to: string): Edge => ({
  from, to, dir: 'out', headingPath: [], lineTags: [],
})
const isDiary = (p: string) => /\d{4}-\d{2}-\d{2}/.test(p)

describe('buildGrid', () => {
  const events = [
    ev('2026-06-20.md', '2026-06-20'),
    ev('plan.md', '2026-06-20'),
    ev('reflect.md', '2026-06-22'),
  ]
  const columns: Column[] = [
    { filter: { by: 'heading', value: '计划' }, priority: 1, repeat: false }, // col 0（左）
    { filter: { by: 'diary' }, priority: 0, repeat: false },                  // col 1（中）
    { filter: null, priority: 2, repeat: false },                             // col 2（右）
  ]
  const edges = [edge('plan.md', '2026-06-20.md'), edge('plan.md', 'gone.md')]

  it('rows = 可见事件日期并集且升序', () => {
    const g = buildGrid(events, columns, edges, isDiary)
    expect(g.rows).toEqual(['2026-06-20', '2026-06-22'])
  })

  it('日记进 diary 列（col 1），列索引=数组次序', () => {
    const g = buildGrid(events, columns, edges, isDiary)
    expect(g.cells.get('2026-06-20')?.get(1)?.map(e => e.path)).toEqual(['2026-06-20.md'])
  })

  it('非日记落入匹配/兜底列', () => {
    const g = buildGrid(events, columns, edges, isDiary)
    // plan.md 无标题上下文 → 不匹配 col0(计划)，落 col2(全部)
    expect(g.cells.get('2026-06-20')?.get(2)?.map(e => e.path)).toEqual(['plan.md'])
    expect(g.cells.get('2026-06-22')?.get(2)?.map(e => e.path)).toEqual(['reflect.md'])
  })

  it('arrows 仅含 out 且两端可见的边', () => {
    const g = buildGrid(events, columns, edges, isDiary)
    expect(g.arrows).toEqual([{ from: 'plan.md', to: '2026-06-20.md' }]) // gone.md 不可见被剔除
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/plugins/timeline/__tests__/grid.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// src/plugins/timeline/grid.ts
import type { TimelineEvent } from './events'
import type { Edge } from './selection'
import type { Column } from './columns'
import { assignColumns } from './columns'
import { edgesByNote } from './events'

export interface Grid {
  rows: string[]                                    // 升序日期；可见事件 date 的并集
  cells: Map<string, Map<number, TimelineEvent[]>>  // cells.get(date)?.get(colIdx)
  arrows: { from: string; to: string }[]            // 两端都可见的出链边
}

export function buildGrid(
  events: TimelineEvent[],
  columns: Column[],
  edges: Edge[],
  isDiary: (path: string) => boolean,
): Grid {
  const visible = new Set(events.map(e => e.path))
  const byNote = edgesByNote(edges)
  const byPath = new Map(events.map(e => [e.path, e]))

  const buckets = assignColumns(events.map(e => e.path), byNote, columns, isDiary)

  const cells = new Map<string, Map<number, TimelineEvent[]>>()
  buckets.forEach((ids, colIdx) => {
    for (const id of ids) {
      const e = byPath.get(id)
      if (!e) continue
      let row = cells.get(e.date)
      if (!row) { row = new Map(); cells.set(e.date, row) }
      const arr = row.get(colIdx) ?? []
      arr.push(e)
      row.set(colIdx, arr)
    }
  })

  const rows = [...new Set(events.map(e => e.date))].sort()

  const arrows = edges
    .filter(e => e.dir === 'out' && visible.has(e.from) && visible.has(e.to))
    .map(e => ({ from: e.from, to: e.to }))

  return { rows, cells, arrows }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/plugins/timeline/__tests__/grid.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/plugins/timeline/grid.ts src/plugins/timeline/__tests__/grid.test.ts
git commit -m "feat(timeline): buildGrid 日期对齐网格 + 箭头边集

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: TimelineView 日期对齐网格渲染 + 列配置（日记/重排）

把视图从「独立多列」改为「CSS Grid 日期对齐」，配置栏加日记过滤选项与列左右重排，并接入 `isDiary`。

**Files:**
- Modify: `src/plugins/timeline/TimelineView.tsx`

**Interfaces:**
- Consumes: `buildGrid`/`Grid`（Task 3）、`buildNeighborhood`（Task 2 的 isDiary）、`assignColumns` 间接、`extractDateFromName`（`../../vault`）

- [ ] **Step 1: 引入 isDiary 与 grid，替换 neighborhood/cols memo**

在 `src/plugins/timeline/TimelineView.tsx` 顶部 import 增加：

```ts
import { extractDateFromName } from '../../vault'
import { buildGrid } from './grid'
```

把 `columns` 默认值改为日记脉开局，并加 `isDiary`：

```ts
const isDiary = (p: string) => extractDateFromName(p) != null
const [columns, setColumns] = createSignal<Column[]>([
  { filter: { by: 'diary' }, priority: 0, repeat: false },
])
```

`neighborhood` memo 传 isDiary：

```ts
return buildNeighborhood(f, files, vaultStore.backlinkMap, resolve, {
  maxFiles: maxFiles(),
  isDiary,
})
```

删除旧的 `cols` memo，改为 `grid` memo：

```ts
const grid = createMemo(() => buildGrid(events(), columns(), neighborhood().edges, isDiary))
```

- [ ] **Step 2: 列配置：加日记选项、重排按钮**

`setBy` 增 diary 分支：

```ts
function setBy(i: number, by: string): void {
  let filter: ColumnFilter = null
  if (by === 'diary') filter = { by: 'diary' }
  else if (by === 'heading') filter = { by: 'heading', value: headingOptions()[0] ?? '' }
  else if (by === 'tag') filter = { by: 'tag', value: tagOptions()[0] ?? '' }
  else if (by === 'direction') filter = { by: 'direction', value: 'out' }
  updateColumn(i, { filter })
}
```

新增列移动：

```ts
function moveColumn(i: number, dir: -1 | 1): void {
  setColumns((cs) => {
    const j = i + dir
    if (j < 0 || j >= cs.length) return cs
    const next = [...cs]
    ;[next[i], next[j]] = [next[j], next[i]]
    return next
  })
}
```

`filterLabel` 增 diary：

```ts
function filterLabel(f: ColumnFilter | undefined): string {
  if (!f) return '全部'
  if (f.by === 'diary') return '日记'
  if (f.by === 'heading') return `标题：${f.value}`
  if (f.by === 'tag') return `#${f.value}`
  return f.value === 'out' ? '出链' : '入链'
}
```

在列控件块的 `by` 下拉里加日记项，并在删除按钮旁加左右移动按钮：

```tsx
<select ... onChange={(e) => setBy(i(), e.currentTarget.value)}>
  <option value="none">全部</option>
  <option value="diary">日记</option>
  <option value="heading">标题</option>
  <option value="tag">标签</option>
  <option value="direction">方向</option>
</select>
{/* …value 子选择、priority、repeat 不变… */}
<button class="t-3 hover:t-base px-1" title="左移" onClick={() => moveColumn(i(), -1)}>←</button>
<button class="t-3 hover:t-base px-1" title="右移" onClick={() => moveColumn(i(), 1)}>→</button>
<button class="t-3 hover:t-base px-1" title="删除此列" onClick={() => removeColumn(i())}>✕</button>
```

> `value` 子选择的 `<Show when={col.filter && col.filter.by !== 'direction'}>` 需排除 diary（diary 无 value）。改条件为 `col.filter?.by === 'heading' || col.filter?.by === 'tag'`。

- [ ] **Step 3: 网格渲染替换原多列 `<div class="flex">`**

把原 `<Show when={events().length>0}>…</Show>` 内的渲染整体替换为 CSS Grid。`gridTemplateColumns` = 日期标尺列 + 各列；显式 `grid-row`/`grid-column` 定位保证对齐：

```tsx
<Show when={events().length > 0} fallback={<EmptyHint text="这篇笔记暂无关联笔记。" />}>
  <div
    ref={(el) => (gridContainer = el)}
    class="relative grid gap-x-6 gap-y-2 items-start"
    style={{
      'grid-template-columns': `72px repeat(${columns().length}, minmax(0, 1fr))`,
    }}
  >
    {/* 表头行（row 1）：列标题 */}
    <div style={{ 'grid-row': '1', 'grid-column': '1' }} />
    <For each={columns()}>
      {(col, ci) => (
        <div
          class="text-[11px] t-3 pb-1 border-b border-(--border)"
          style={{ 'grid-row': '1', 'grid-column': `${ci() + 2}` }}
        >
          {filterLabel(col.filter)}
        </div>
      )}
    </For>

    {/* 数据行：每个日期一行（row 从 2 起） */}
    <For each={grid().rows}>
      {(date, r) => (
        <>
          <time
            class="text-[11px] t-3 mt-1.5"
            style={{ 'grid-row': `${r() + 2}`, 'grid-column': '1' }}
          >
            {date}
          </time>
          <For each={columns()}>
            {(_col, ci) => (
              <div style={{ 'grid-row': `${r() + 2}`, 'grid-column': `${ci() + 2}` }}>
                <For each={grid().cells.get(date)?.get(ci()) ?? []}>
                  {(ev) => renderCard(ev)}
                </For>
              </div>
            )}
          </For>
        </>
      )}
    </For>
  </div>
</Show>
```

把现有卡片 `<button>…</button>` 抽成组件作用域内的 `renderCard(ev: TimelineEvent)` 函数（内容与现卡片一致：date/title/焦点徽标/span/缩略图/snippet/tags/linkCount），`onClick={() => openCard(ev)}`，并在按钮根节点加 `ref={(el) => cardRefs.set(ev.path, el)}`（cardRefs 在 Task 5 声明；本任务先不画箭头，可暂不加 ref，Task 5 再补）。声明组件级变量：

```ts
let gridContainer: HTMLDivElement | undefined
```

- [ ] **Step 4: 类型检查 + 既有测试**

Run: `npm run build && npx vitest run`
Expected: tsc 通过；既有测试全绿（纯逻辑未受影响）。

- [ ] **Step 5: 手动验证**

Run: `npm run dev`
- 焦点笔记 → 出现日期对齐网格，最左是日期标尺；
- 默认有「日记」列；加「标题=计划」「全部」等列，用 ←/→ 把日记列移到中间，左计划右反思；
- 同一日期的卡片横向对齐到同一行；日记不再把图炸开（其出链不展开）。

- [ ] **Step 6: 提交**

```bash
git add src/plugins/timeline/TimelineView.tsx
git commit -m "feat(timeline): 日期对齐网格渲染 + 日记列/列重排配置

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: SVG 出链箭头叠层 + 样式配置

在网格上叠一层 SVG，对 `grid().arrows` 每条边画箭头；样式（直线/折线/曲线 + 颜色）可配。

**Files:**
- Modify: `src/plugins/timeline/TimelineView.tsx`

**Interfaces:**
- Consumes: `grid().arrows`（Task 3）、`cardRefs`、`gridContainer`（Task 4）

- [ ] **Step 1: 声明样式信号、refs、几何信号**

在组件体加：

```ts
type ArrowStyle = { shape: 'straight' | 'elbow' | 'curve'; color: string }
const [arrowStyle, setArrowStyle] = createSignal<ArrowStyle>({ shape: 'curve', color: '#6aa0ff' })
const cardRefs = new Map<string, HTMLElement>()
const [arrowPaths, setArrowPaths] = createSignal<string[]>([])
```

确保 Task 4 的 `renderCard` 根 `<button>` 带 `ref={(el) => cardRefs.set(ev.path, el)}`（并在卡片不再渲染时无需手动清理：每次重算前我们只读当前存在的 ref；离场的 path 在 computeArrows 里跳过）。

- [ ] **Step 2: 计算函数 + SVG path 生成**

```ts
function pointsFor(fromEl: HTMLElement, toEl: HTMLElement, base: DOMRect) {
  const a = fromEl.getBoundingClientRect()
  const b = toEl.getBoundingClientRect()
  // 源卡右缘中点 → 目标卡左缘中点（相对容器）
  const sx = a.right - base.left, sy = a.top + a.height / 2 - base.top
  const ex = b.left - base.left, ey = b.top + b.height / 2 - base.top
  return { sx, sy, ex, ey }
}

function pathD(shape: ArrowStyle['shape'], p: { sx: number; sy: number; ex: number; ey: number }) {
  const { sx, sy, ex, ey } = p
  if (shape === 'straight') return `M ${sx} ${sy} L ${ex} ${ey}`
  if (shape === 'elbow') {
    const mx = (sx + ex) / 2
    return `M ${sx} ${sy} L ${mx} ${sy} L ${mx} ${ey} L ${ex} ${ey}`
  }
  // curve：水平切出的三次贝塞尔
  const dx = Math.max(40, Math.abs(ex - sx) / 2)
  return `M ${sx} ${sy} C ${sx + dx} ${sy} ${ex - dx} ${ey} ${ex} ${ey}`
}

function computeArrows(): void {
  const base = gridContainer?.getBoundingClientRect()
  if (!base) { setArrowPaths([]); return }
  const shape = arrowStyle().shape
  const ds: string[] = []
  for (const { from, to } of grid().arrows) {
    const f = cardRefs.get(from), t = cardRefs.get(to)
    if (!f || !t) continue
    ds.push(pathD(shape, pointsFor(f, t, base)))
  }
  setArrowPaths(ds)
}
```

- [ ] **Step 3: 重算时机（数据/样式/尺寸/滚动）**

```ts
import { createEffect, onCleanup, onMount } from 'solid-js'

createEffect(() => {
  grid(); arrowStyle(); columns(); maxFiles()   // 依赖触发
  queueMicrotask(computeArrows)                 // 等 DOM 落定后量取
})

onMount(() => {
  const ro = new ResizeObserver(() => computeArrows())
  if (gridContainer) ro.observe(gridContainer)
  const onScroll = () => computeArrows()
  const scroller = gridContainer?.closest('.overflow-auto') ?? window
  scroller.addEventListener('scroll', onScroll, { passive: true })
  onCleanup(() => { ro.disconnect(); scroller.removeEventListener('scroll', onScroll) })
})
```

> `createEffect`/`onMount`/`onCleanup` 若未 import 需补；`onMount` 在 SolidJS 中可用。

- [ ] **Step 4: SVG 叠层渲染**

在 Task 4 的网格容器 `<div ref=gridContainer …>` **内部**、`<For>` 之后加：

```tsx
<svg class="absolute inset-0 pointer-events-none" style={{ overflow: 'visible' }}>
  <defs>
    <marker id="tl-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
      <path d="M0,0 L8,4 L0,8 Z" fill={arrowStyle().color} />
    </marker>
  </defs>
  <For each={arrowPaths()}>
    {(d) => (
      <path
        d={d}
        fill="none"
        stroke={arrowStyle().color}
        stroke-width="1.5"
        marker-end="url(#tl-arrow)"
      />
    )}
  </For>
</svg>
```

- [ ] **Step 5: 箭头样式配置 UI（配置栏）**

在配置栏（maxFiles 旁）加：

```tsx
<label class="flex items-center gap-1">
  箭头
  <select
    class="bg-(--bg-base) border border-(--border) rounded px-1"
    value={arrowStyle().shape}
    onChange={(e) => setArrowStyle((s) => ({ ...s, shape: e.currentTarget.value as ArrowStyle['shape'] }))}
  >
    <option value="straight">直线</option>
    <option value="elbow">折线</option>
    <option value="curve">曲线</option>
  </select>
  <input
    type="color"
    value={arrowStyle().color}
    onInput={(e) => setArrowStyle((s) => ({ ...s, color: e.currentTarget.value }))}
    class="w-7 h-6 p-0 border border-(--border) rounded"
  />
</label>
```

- [ ] **Step 6: 类型检查 + 测试**

Run: `npm run build && npx vitest run`
Expected: tsc 通过；测试全绿。

- [ ] **Step 7: 手动验证**

Run: `npm run dev`
- 有出链关系的两卡之间出现箭头，指向被链接者；
- 切直线/折线/曲线即时变化；改颜色 stroke 与箭头头同步；
- 滚动/改窗口宽度/调 maxFiles/重排列后箭头重新对位。

- [ ] **Step 8: 提交**

```bash
git add src/plugins/timeline/TimelineView.tsx
git commit -m "feat(timeline): SVG 出链箭头叠层 + 直线/折线/曲线与颜色配置

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 收尾

- [ ] **全量回归**

Run: `npm run build && npx vitest run`
Expected: 全绿。

- [ ] **完成开发分支**：用 superpowers:finishing-a-development-branch 决定合并/PR/清理。

---

## Self-Review 记录

- **Spec 覆盖**：§1 日记判定→Task 4(isDiary 注入)；§2 BFS 跳过→Task 2；§3 buildGrid→Task 3；§4 网格渲染→Task 4；§5 箭头叠层+样式→Task 5；§6 列配置(diary 过滤/重排/dedupe)→Task 1 + Task 4。无遗漏。
- **占位符**：无 TBD/TODO；每个 code step 给出完整代码。
- **类型一致**：`ColumnFilter{by:'diary'}`、`assignColumns(...,isDiary?)`（Task 1）、`buildNeighborhood(...,{maxFiles,isDiary?})`（Task 2）、`Grid`/`buildGrid`（Task 3）、`ArrowStyle`（Task 5）在引用处签名一致。
- **增量 build 绿**：Task 1/2 的新参数均可选，`TimelineView` 旧调用不破；Task 3 纯新增；Task 4 切换调用；Task 5 叠加。
- **已知前置确认点**：`TimelineView` 现有配置栏与卡片 JSX 结构（Task 4 Step 2/3 在其上增改）；网格滚动容器的类名（Task 5 Step 3 用 `.overflow-auto`，对应 `TimelineView` 根 `<div class="h-full overflow-auto ...">`）。
```
