# 日历显示 BuJo 条目（第二期 b-①）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除 dashboard 插件，并在日历月视图里新增事件/心情/想法三类 BuJo 条目（过滤项 + 日期格显示）。

**Architecture:** 复用 `vaultStore.files[*].lists`；新增纯函数 `buildEntryDayData` 把事件`-`/心情`=`/想法`~`按 `fields['due'] ?? 文件dated` 聚合成"日期→条目"。`CalendarViewer` 加 3 个过滤 chip、3 种 cell 渲染分支。dashboard 插件整删。

**Tech Stack:** TypeScript、SolidJS、Vitest。

参考 spec：`docs/superpowers/specs/2026-06-10-calendar-bujo-entries-design.md`

---

## 文件结构

- Delete: `src/plugins/dashboard/`（整目录）
- Modify: `src/App.tsx`（删 import + register 各一行）
- Modify: `src/plugins/calendar/calendarUtils.ts`（新增 `buildEntryDayData`）
- Modify: `src/plugins/calendar/__tests__/calendarUtils.test.ts`（新增测试）
- Modify: `src/plugins/calendar/CalendarViewer.tsx`（过滤项 / cell / 渲染 / chip）

---

## Task 1: 删除 dashboard 插件

**Files:**
- Delete: `src/plugins/dashboard/`
- Modify: `src/App.tsx:22,65`

- [ ] **Step 1: 删目录**

```bash
git rm -r src/plugins/dashboard
```

- [ ] **Step 2: 删 `src/App.tsx` 的两处引用**

删除第 22 行：

```ts
import { DashboardPlugin } from './plugins/dashboard'
```

删除第 65 行：

```ts
registerPlugin(DashboardPlugin)
```

- [ ] **Step 3: 确认无残留引用**

Run: `grep -rn "dashboard\|Dashboard" src --include=*.ts --include=*.tsx`
Expected: 无输出（零引用）。

- [ ] **Step 4: 类型检查 + 全量测试**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc 无错误；测试全绿（dashboard 测试随目录删除而消失）。

- [ ] **Step 5: 提交**

```bash
git add -A src/App.tsx src/plugins/dashboard
git commit -m "chore(dashboard): remove dashboard plugin (superseded by calendar)"
```

---

## Task 2: buildEntryDayData 聚合纯函数

**Files:**
- Modify: `src/plugins/calendar/calendarUtils.ts`（接 `buildTaskDayData` 之后）
- Modify: `src/plugins/calendar/__tests__/calendarUtils.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/plugins/calendar/__tests__/calendarUtils.test.ts` 顶部 import 加入 `buildEntryDayData`：

```ts
import {
  buildMonthRows,
  buildRangeRows,
  toIsoDate,
  buildEntryDayData,
} from '../calendarUtils'
import type { MonthHeaderRow, WeekRow } from '../calendarUtils'
import type { FileMeta, ListItem } from '../../../stores/types'
```

文件末尾追加：

```ts
function listItem(over: Partial<ListItem>): ListItem {
  return {
    text: '', visual: '', line: 0, lineCount: 1, symbol: '-',
    signifier: null, status: null, checked: false, task: false,
    fields: {}, tags: [], ...over,
  }
}

function fileMeta(path: string, dated: string, lists: ListItem[]): FileMeta {
  return {
    name: path.split('/').pop()!, path, kind: 'file', parent: null,
    size: 0, mtime: 0, hash: '', frontmatter: {}, outLinks: [], etags: [],
    tags: [], aliases: [], created: dated, updated: null, dated, lists,
  }
}

describe('buildEntryDayData', () => {
  it('places event/mood/idea on the file dated', () => {
    const files = {
      'journal/2026-06-10.md': fileMeta('journal/2026-06-10.md', '2026-06-10', [
        listItem({ signifier: '-', visual: '看了电影' }),
        listItem({ signifier: '=', visual: '很开心' }),
        listItem({ signifier: '~', visual: '一个点子' }),
      ]),
    }
    const map = buildEntryDayData(files)
    expect(map['2026-06-10'].map(e => e.signifier)).toEqual(['-', '=', '~'])
    expect(map['2026-06-10'][0].path).toBe('journal/2026-06-10.md')
  })

  it('uses explicit [due::] over file dated', () => {
    const files = {
      'a.md': fileMeta('a.md', '2026-06-01', [
        listItem({ signifier: '-', fields: { due: '2026-06-20' } }),
      ]),
    }
    const map = buildEntryDayData(files)
    expect(map['2026-06-20']).toHaveLength(1)
    expect(map['2026-06-01']).toBeUndefined()
  })

  it('skips tasks, plain lists, and ! & signifiers', () => {
    const files = {
      'a.md': fileMeta('a.md', '2026-06-01', [
        listItem({ task: true, status: ' ' }),       // 任务
        listItem({ signifier: null }),                // 普通列表
        listItem({ signifier: '!' }),                 // 重要
        listItem({ signifier: '&' }),                 // 留意
      ]),
    }
    expect(buildEntryDayData(files)).toEqual({})
  })

  it('skips directories and items with no resolvable date', () => {
    const dir: FileMeta = { ...fileMeta('d', '2026-06-01', []), kind: 'directory' }
    const noDate: FileMeta = { ...fileMeta('n.md', '', [listItem({ signifier: '-' })]), dated: '' }
    expect(buildEntryDayData({ 'd': dir, 'n.md': noDate })).toEqual({})
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/plugins/calendar/__tests__/calendarUtils.test.ts -t buildEntryDayData`
Expected: FAIL（`buildEntryDayData` 未导出）

- [ ] **Step 3: 实现 `buildEntryDayData`**

在 `src/plugins/calendar/calendarUtils.ts` 的 `buildTaskDayData` 函数之后插入：

```ts
const ENTRY_SIGNIFIERS = new Set(['-', '=', '~'])

/** 事件/心情/想法条目按日期聚合：fields['due'] 优先，否则文件 dated。 */
export function buildEntryDayData(
  files: Record<string, FileMeta>,
): Record<string, Task[]> {
  const map: Record<string, Task[]> = {}
  for (const [path, meta] of Object.entries(files)) {
    if (meta.kind !== 'file') continue
    const fallback = meta.dated || null
    for (const it of meta.lists) {
      if (!it.signifier || !ENTRY_SIGNIFIERS.has(it.signifier)) continue
      const date = it.fields['due'] ?? fallback
      if (!date) continue
      ;(map[date] ??= []).push({ ...it, path })
    }
  }
  return map
}
```

（`Task = ListItem & { path: string }` 已在本文件定义；`FileMeta` 已 import。确认文件顶部
`import type { TaskItem, FileMeta } from '../../stores/types'` 已是 `ListItem, FileMeta`——
第二期 a 已把 `TaskItem` 改为 `ListItem`，此处应为 `import type { ListItem, FileMeta }`。）

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/plugins/calendar/__tests__/calendarUtils.test.ts`
Expected: PASS（含 buildEntryDayData 全部用例）

- [ ] **Step 5: 提交**

```bash
git add src/plugins/calendar/calendarUtils.ts src/plugins/calendar/__tests__/calendarUtils.test.ts
git commit -m "feat(calendar): aggregate event/mood/idea entries by day"
```

---

## Task 3: CalendarViewer 接入过滤项与渲染

**Files:**
- Modify: `src/plugins/calendar/CalendarViewer.tsx`

- [ ] **Step 1: import 与常量**

第 1 行 import 加 `type JSX`：

```ts
import { createDeferred, createMemo, createSignal, For, Show, type JSX } from 'solid-js'
```

第 6–15 行的 `calendarUtils` import 加入 `buildEntryDayData`：

```ts
import {
  buildDayData,
  buildTaskDayData,
  buildEntryDayData,
  buildRangeRows,
  WEEKDAYS_LONG,
  type CalRow,
  type MonthHeaderRow,
  type WeekRow,
  type Task,
} from './calendarUtils'
```

`FILTER_DEFAULTS`（第 24–30 行）增三键：

```ts
const FILTER_DEFAULTS = {
  dated: true,
  created: true,
  updated: true,
  pending: true,
  done: true,
  event: true,
  mood: true,
  idea: true,
}
```

`CellItem`（第 33–35 行）加三种：

```ts
type CellItem =
  | { kind: 'dated' | 'created' | 'updated'; path: string }
  | { kind: 'pending' | 'done'; task: Task }
  | { kind: 'event' | 'mood' | 'idea'; entry: Task }
```

在 `MAX_CELL_ITEMS` 常量旁加条目样式表（与第二期 a 配色一致）：

```ts
const ENTRY_STYLE: Record<'event' | 'mood' | 'idea', { hue: string; sig: string }> = {
  event: { hue: '#4aa3ff', sig: '-' },
  mood:  { hue: '#56c596', sig: '=' },
  idea:  { hue: '#9d8dff', sig: '~' },
}
```

- [ ] **Step 2: FilterChip 支持 inline dotStyle**

把 `FilterChip`（第 52–69 行）改为可选 `dotStyle`：

```tsx
function FilterChip(props: {
  label: string
  colorClass?: string
  dotStyle?: JSX.CSSProperties
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      class="flex items-center gap-1.5 text-[10px] select-none cursor-pointer transition-opacity"
      style={{ opacity: props.active ? '1' : '0.35' }}
      onClick={props.onClick}
      title={`${props.active ? '隐藏' : '显示'}${props.label}`}
    >
      <span class={`w-2 h-2 rounded-sm shrink-0 ${props.colorClass ?? ''}`} style={props.dotStyle} />
      <span class="text-[var(--text-3)]">{props.label}</span>
    </button>
  )
}
```

- [ ] **Step 3: WeekRowComp 接收 entryDayData 并渲染**

`WeekRowComp` props（第 79–86 行）加 `entryDayData`：

```ts
function WeekRowComp(props: {
  row: WeekRow
  dayData: () => ReturnType<typeof buildDayData>
  taskDayData: () => Record<string, Task[]>
  entryDayData: () => Record<string, Task[]>
  filter: () => typeof FILTER_DEFAULTS
  todayStr: string
  onOpenFile: (path: string) => void
}) {
```

`cellData()` 里的 `all` 数组（第 105–111 行）末尾追加三类条目：

```ts
            const ed = props.entryDayData()
            const entries = ed[dayStr] ?? []
            const all: CellItem[] = [
              ...(f.dated ? (d.dated[dayStr] ?? []).map((path): CellItem => ({ kind: 'dated', path })) : []),
              ...(f.created ? (d.created[dayStr] ?? []).map((path): CellItem => ({ kind: 'created', path })) : []),
              ...(f.updated ? (d.updated[dayStr] ?? []).map((path): CellItem => ({ kind: 'updated', path })) : []),
              ...(f.pending ? (td[dayStr] ?? []).filter(t => !t.checked).map((task): CellItem => ({ kind: 'pending', task })) : []),
              ...(f.done ? (td[dayStr] ?? []).filter(t => t.checked).map((task): CellItem => ({ kind: 'done', task })) : []),
              ...(f.event ? entries.filter(e => e.signifier === '-').map((entry): CellItem => ({ kind: 'event', entry })) : []),
              ...(f.mood ? entries.filter(e => e.signifier === '=').map((entry): CellItem => ({ kind: 'mood', entry })) : []),
              ...(f.idea ? entries.filter(e => e.signifier === '~').map((entry): CellItem => ({ kind: 'idea', entry })) : []),
            ]
```

在 `done` 渲染分支（第 165–173 行）之后、`return null` 之前，加条目渲染分支：

```tsx
                    if (item.kind === 'event' || item.kind === 'mood' || item.kind === 'idea') {
                      const st = ENTRY_STYLE[item.kind]
                      return (
                        <button
                          class="shrink-0 text-left text-[10px] leading-snug px-1.5 py-0.5 rounded w-full cursor-pointer transition-colors truncate hover:opacity-80"
                          style={{ color: st.hue, 'background-color': `color-mix(in srgb, ${st.hue} 16%, transparent)` }}
                          onClick={() => props.onOpenFile(item.entry.path)}
                          title={item.entry.path}
                        >
                          {st.sig} {item.entry.visual}
                        </button>
                      )
                    }
```

- [ ] **Step 4: 主组件接 entryDayData + 三个 chip + 传参**

主组件里 `taskDayData`（第 207 行）之后加：

```ts
  const entryDayData = createDeferred(() => buildEntryDayData(vaultStore.files))
```

工具栏"已完成"chip（第 323–328 行）之后加三个 chip：

```tsx
          <FilterChip
            label="事件"
            dotStyle={{ 'background-color': '#4aa3ff' }}
            active={filter().event}
            onClick={() => toggleFilter('event')}
          />
          <FilterChip
            label="心情"
            dotStyle={{ 'background-color': '#56c596' }}
            active={filter().mood}
            onClick={() => toggleFilter('mood')}
          />
          <FilterChip
            label="想法"
            dotStyle={{ 'background-color': '#9d8dff' }}
            active={filter().idea}
            onClick={() => toggleFilter('idea')}
          />
```

`WeekRowComp` 的使用处（第 377–384 行）传入 `entryDayData`：

```tsx
                    <WeekRowComp
                      row={row() as WeekRow}
                      dayData={dayData}
                      taskDayData={taskDayData}
                      entryDayData={entryDayData}
                      filter={filter}
                      todayStr={todayStr}
                      onOpenFile={workspaceActions.openFile}
                    />
```

- [ ] **Step 5: 类型检查 + 测试 + 构建**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc 无错误；测试全绿；构建成功。

- [ ] **Step 6: 手动验证**

Run: `npm run dev`，打开 vault（含一篇日记如 `journal/2026-06-10.md`，内有 `- - 看了电影` / `- = 很开心` / `- ~ 点子` / `- [ ] 任务`）。点击侧栏"日历大图"。
Expected：
- 该日期格显示任务（☐）+ 事件（淡蓝 `- 看了电影`）+ 心情（淡绿 `= 很开心`）+ 想法（淡紫 `~ 点子`）。
- 工具栏出现 事件/心情/想法 三个 chip；点击可隐藏/显示对应条目。
- 点条目跳转到来源文件。
- dashboard 入口/页签已消失。

- [ ] **Step 7: 提交**

```bash
git add src/plugins/calendar/CalendarViewer.tsx
git commit -m "feat(calendar): show event/mood/idea entries with filters"
```

---

## 完成标准

- dashboard 插件已删，无残留引用，`tsc`/`build`/测试全绿。
- 日历月视图日期格显示事件/心情/想法条目（对应淡色），与任务并列；点击跳转。
- 工具栏三个新过滤 chip 可独立开关；`MAX_CELL_ITEMS` 溢出计入。
- 条目落位 `fields['due'] ?? 文件dated`；仅 `-`/`=`/`~` 三类。
- `buildEntryDayData` 有单测覆盖落位/过滤/边界。
