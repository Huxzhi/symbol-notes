# 日历周视图 + 本周总结反思（第二期 b-②）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给日历加周视图（一页 8 列：7 日列 + 第 8 列内联编辑本周总结/反思），模式与所在周存进 viewState。

**Architecture:** 抽出共享 `CalendarCell`（`buildCellItems` + `CellItemButton`）供月/周复用；新增 `WeekView`（8 列）与 `WeeklyNoteEditor`（第 8 列）；`CalendarViewer` 变壳，按 `viewState.mode` 切换月/周，本地 signal 同步 + `setLeafViewState` 持久化。

**Tech Stack:** TypeScript、SolidJS、CodeMirror 6、Vitest。

参考 spec：`docs/superpowers/specs/2026-06-10-calendar-week-view-design.md`

**注意：** 周视图/编辑器/viewState 涉及 vault 与 DOM，单测只覆盖纯函数（ISO 辅助、`buildCellItems`）；其余靠 `tsc`/`build` + 手动浏览器验证（开 vault）。

---

## 文件结构

- Modify: `src/plugins/calendar/calendarUtils.ts` — 加 ISO 周辅助 + `parseISODate`
- Create: `src/plugins/calendar/CalendarCell.tsx` — 共享 `FILTER_DEFAULTS`/`CellItem`/`ENTRY_STYLE`/`buildCellItems`/`CellItemButton`
- Create: `src/plugins/calendar/WeeklyNoteEditor.tsx` — 第 8 列内联编辑器
- Create: `src/plugins/calendar/WeekView.tsx` — 8 列周视图
- Modify: `src/plugins/calendar/CalendarViewer.tsx` — 改壳（viewState、模式切换、月/周切换、复用 CalendarCell）
- Modify: `src/plugins/calendar/index.tsx` — `weeklyFolder` 设置
- Test: `src/plugins/calendar/__tests__/calendarUtils.test.ts`、新建 `__tests__/calendarCell.test.ts`

---

## Task 1: ISO 周辅助 + parseISODate

**Files:**
- Modify: `src/plugins/calendar/calendarUtils.ts`
- Test: `src/plugins/calendar/__tests__/calendarUtils.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/plugins/calendar/__tests__/calendarUtils.test.ts` 顶部 import 补：

```ts
import {
  buildMonthRows,
  buildRangeRows,
  toIsoDate,
  buildEntryDayData,
  getISOWeek,
  getISOWeekString,
  getISOWeekDates,
  weekFilePath,
  parseISODate,
} from '../calendarUtils'
```

文件末尾追加：

```ts
describe('ISO week helpers', () => {
  it('getISOWeek handles mid-year and year boundaries', () => {
    expect(getISOWeek(new Date(2026, 5, 2))).toEqual({ year: 2026, week: 23 }) // 周二
    expect(getISOWeek(new Date(2021, 0, 1))).toEqual({ year: 2020, week: 53 }) // 跨年归上年 W53
    expect(getISOWeek(new Date(2019, 11, 31))).toEqual({ year: 2020, week: 1 }) // 归下年 W1
  })

  it('getISOWeekString formats as YYYY-Www', () => {
    expect(getISOWeekString(new Date(2026, 5, 2))).toBe('2026-W23')
  })

  it('getISOWeekDates returns Mon..Sun of the ISO week', () => {
    const days = getISOWeekDates(new Date(2026, 5, 10)) // 2026-06-10 周三
    expect(days).toHaveLength(7)
    expect(days[0]).toBe('2026-06-08') // 周一
    expect(days[6]).toBe('2026-06-14') // 周日
  })

  it('weekFilePath joins folder and ISO week name', () => {
    expect(weekFilePath('weekly', new Date(2026, 5, 10))).toBe('weekly/2026-W24.md')
    expect(weekFilePath('', new Date(2026, 5, 10))).toBe('2026-W24.md')
  })

  it('parseISODate parses to a local date', () => {
    const d = parseISODate('2026-06-10')
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 5, 10])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/plugins/calendar/__tests__/calendarUtils.test.ts -t "ISO week"`
Expected: FAIL（函数未导出）

- [ ] **Step 3: 实现**

在 `src/plugins/calendar/calendarUtils.ts` 末尾追加：

```ts
export function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dow = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dow)
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + 1) / 7)
  return { year: d.getUTCFullYear(), week }
}

export function getISOWeekString(date: Date): string {
  const { year, week } = getISOWeek(date)
  return `${year}-W${String(week).padStart(2, '0')}`
}

export function getISOWeekDates(date: Date): string[] {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dow = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() - (dow - 1))
  return Array.from({ length: 7 }, (_, i) => {
    const cur = new Date(d)
    cur.setUTCDate(d.getUTCDate() + i)
    return cur.toISOString().slice(0, 10)
  })
}

export function weekFilePath(folder: string, date: Date): string {
  const name = `${getISOWeekString(date)}.md`
  return folder ? `${folder}/${name}` : name
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/plugins/calendar/__tests__/calendarUtils.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/plugins/calendar/calendarUtils.ts src/plugins/calendar/__tests__/calendarUtils.test.ts
git commit -m "feat(calendar): add ISO week helpers and parseISODate"
```

---

## Task 2: 抽出共享 CalendarCell（buildCellItems + CellItemButton）

**Files:**
- Create: `src/plugins/calendar/CalendarCell.tsx`
- Create: `src/plugins/calendar/__tests__/calendarCell.test.ts`
- Modify: `src/plugins/calendar/CalendarViewer.tsx`

- [ ] **Step 1: 写失败测试 `src/plugins/calendar/__tests__/calendarCell.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { buildCellItems, FILTER_DEFAULTS } from '../CalendarCell'
import type { ListItem } from '../../../stores/types'

function entry(over: Partial<ListItem>): ListItem & { path: string } {
  return {
    text: '', visual: '', line: 0, lineCount: 1, symbol: '-',
    signifier: null, status: null, checked: false, task: false,
    fields: {}, tags: [], path: 'x.md', ...over,
  }
}

const emptyDayData = { created: {}, updated: {}, dated: {} }

describe('buildCellItems', () => {
  it('collects files, tasks and entries for a day', () => {
    const data = {
      dayData: { created: { '2026-06-10': ['a.md'] }, updated: {}, dated: {} },
      taskDayData: { '2026-06-10': [entry({ task: true, status: ' ', checked: false })] },
      entryDayData: { '2026-06-10': [entry({ signifier: '-' }), entry({ signifier: '=' }), entry({ signifier: '~' })] },
    }
    const items = buildCellItems('2026-06-10', FILTER_DEFAULTS, data)
    expect(items.map(i => i.kind)).toEqual(['created', 'pending', 'event', 'mood', 'idea'])
  })

  it('respects filter toggles', () => {
    const data = {
      dayData: emptyDayData,
      taskDayData: {},
      entryDayData: { '2026-06-10': [entry({ signifier: '-' }), entry({ signifier: '=' })] },
    }
    const f = { ...FILTER_DEFAULTS, event: false }
    const items = buildCellItems('2026-06-10', f, data)
    expect(items.map(i => i.kind)).toEqual(['mood'])
  })

  it('returns empty for a day with nothing', () => {
    const data = { dayData: emptyDayData, taskDayData: {}, entryDayData: {} }
    expect(buildCellItems('2026-06-10', FILTER_DEFAULTS, data)).toEqual([])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/plugins/calendar/__tests__/calendarCell.test.ts`
Expected: FAIL（`CalendarCell` 不存在）

- [ ] **Step 3: 新建 `src/plugins/calendar/CalendarCell.tsx`**

```tsx
import type { JSX } from 'solid-js'
import { buildDayData, type Task } from './calendarUtils'

export const FILTER_DEFAULTS = {
  dated: true,
  created: true,
  updated: true,
  pending: true,
  done: true,
  event: true,
  mood: true,
  idea: true,
}
export type FilterKey = keyof typeof FILTER_DEFAULTS
export type FilterState = typeof FILTER_DEFAULTS

export type CellItem =
  | { kind: 'dated' | 'created' | 'updated'; path: string }
  | { kind: 'pending' | 'done'; task: Task }
  | { kind: 'event' | 'mood' | 'idea'; entry: Task }

// 与第二期 a 的事件/心情/想法配色一致（日历 DOM 用 hue 值）
export const ENTRY_STYLE: Record<'event' | 'mood' | 'idea', { hue: string; sig: string }> = {
  event: { hue: '#4aa3ff', sig: '-' },
  mood:  { hue: '#56c596', sig: '=' },
  idea:  { hue: '#9d8dff', sig: '~' },
}

type DayData = ReturnType<typeof buildDayData>

/** 某天的全部条目（不截断）。月视图自行 slice，周视图列内滚动。 */
export function buildCellItems(
  dayStr: string,
  f: FilterState,
  data: { dayData: DayData; taskDayData: Record<string, Task[]>; entryDayData: Record<string, Task[]> },
): CellItem[] {
  const d = data.dayData
  const td = data.taskDayData
  const entries = data.entryDayData[dayStr] ?? []
  return [
    ...(f.dated ? (d.dated[dayStr] ?? []).map((path): CellItem => ({ kind: 'dated', path })) : []),
    ...(f.created ? (d.created[dayStr] ?? []).map((path): CellItem => ({ kind: 'created', path })) : []),
    ...(f.updated ? (d.updated[dayStr] ?? []).map((path): CellItem => ({ kind: 'updated', path })) : []),
    ...(f.pending ? (td[dayStr] ?? []).filter(t => !t.checked).map((task): CellItem => ({ kind: 'pending', task })) : []),
    ...(f.done ? (td[dayStr] ?? []).filter(t => t.checked).map((task): CellItem => ({ kind: 'done', task })) : []),
    ...(f.event ? entries.filter(e => e.signifier === '-').map((entry): CellItem => ({ kind: 'event', entry })) : []),
    ...(f.mood ? entries.filter(e => e.signifier === '=').map((entry): CellItem => ({ kind: 'mood', entry })) : []),
    ...(f.idea ? entries.filter(e => e.signifier === '~').map((entry): CellItem => ({ kind: 'idea', entry })) : []),
  ]
}

const fileStem = (p: string) => p.split('/').pop()?.replace(/\.md$/, '')

/** 渲染单个 cell 条目（月视图格 / 周视图列共用）。 */
export function CellItemButton(props: { item: CellItem; onOpenFile: (p: string) => void }): JSX.Element {
  const item = props.item
  if (item.kind === 'dated') return (
    <button
      class="shrink-0 text-left text-[10px] leading-snug px-1.5 py-0.5 rounded bg-(--bg-hover) text-[var(--text-2)] truncate w-full cursor-pointer hover:bg-[var(--text-4)] hover:text-[var(--text)] transition-colors"
      onClick={() => props.onOpenFile(item.path)} title={item.path}
    >{fileStem(item.path)}</button>
  )
  if (item.kind === 'created') return (
    <button
      class="shrink-0 text-left text-[10px] leading-snug px-1.5 py-0.5 rounded bg-(--accent-bg) text-(--accent) truncate w-full cursor-pointer hover:bg-(--accent) hover:text-white transition-colors"
      onClick={() => props.onOpenFile(item.path)} title={item.path}
    >{fileStem(item.path)}</button>
  )
  if (item.kind === 'updated') return (
    <button
      class="shrink-0 text-left text-[10px] leading-snug px-1.5 py-0.5 rounded bg-(--bg-hover) text-[var(--link-2)] truncate w-full cursor-pointer hover:bg-[var(--link-2)] hover:text-white transition-colors"
      onClick={() => props.onOpenFile(item.path)} title={item.path}
    >{fileStem(item.path)}</button>
  )
  if (item.kind === 'pending') return (
    <button
      class="shrink-0 text-left text-[10px] leading-snug px-1.5 py-0.5 rounded w-full cursor-pointer transition-colors truncate text-[var(--tag)] hover:opacity-80"
      style={{ 'background-color': 'color-mix(in srgb, var(--tag) 18%, transparent)' }}
      onClick={() => props.onOpenFile(item.task.path)} title={item.task.path}
    >☐ {item.task.visual}</button>
  )
  if (item.kind === 'done') return (
    <button
      class="shrink-0 text-left text-[10px] leading-snug px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-3)] hover:text-[var(--text-2)] line-through w-full cursor-pointer transition-colors truncate"
      onClick={() => props.onOpenFile(item.task.path)} title={item.task.path}
    >☑ {item.task.visual}</button>
  )
  const st = ENTRY_STYLE[item.kind]
  return (
    <button
      class="shrink-0 text-left text-[10px] leading-snug px-1.5 py-0.5 rounded w-full cursor-pointer transition-colors truncate hover:opacity-80"
      style={{ color: st.hue, 'background-color': `color-mix(in srgb, ${st.hue} 16%, transparent)` }}
      onClick={() => props.onOpenFile(item.entry.path)} title={item.entry.path}
    >{st.sig} {item.entry.visual}</button>
  )
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/plugins/calendar/__tests__/calendarCell.test.ts`
Expected: PASS

- [ ] **Step 5: 让 CalendarViewer 复用 CalendarCell**

在 `src/plugins/calendar/CalendarViewer.tsx`：

(a) 删除本文件内的 `FILTER_DEFAULTS`、`type FilterKey`、`type CellItem`、`ENTRY_STYLE`（第 25–49 行那几块），改为 import（放在 calendarUtils import 之后）：

```ts
import {
  FILTER_DEFAULTS,
  buildCellItems,
  CellItemButton,
  type FilterKey,
} from './CalendarCell'
```

保留 `const MAX_CELL_ITEMS = 5`。

(b) `WeekRowComp` 的 `cellData()`（第 115–133 行）整体替换为：

```ts
          const cellData = () => {
            const all = buildCellItems(dayStr, props.filter(), {
              dayData: props.dayData(),
              taskDayData: props.taskDayData(),
              entryDayData: props.entryDayData(),
            })
            if (all.length <= MAX_CELL_ITEMS) return { items: all, more: 0 }
            return { items: all.slice(0, MAX_CELL_ITEMS - 1), more: all.length - (MAX_CELL_ITEMS - 1) }
          }
```

(c) `WeekRowComp` 里 `<For each={cellData().items}>` 的回调（第 146–207 行那一大坨 if 分支）替换为：

```tsx
                <For each={cellData().items}>
                  {(item) => <CellItemButton item={item} onOpenFile={props.onOpenFile} />}
                </For>
```

`props.filter()` 的类型 `typeof FILTER_DEFAULTS` 现在指向 import 的同名常量，保持不变。

- [ ] **Step 6: 类型检查 + 测试 + 构建**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: 全绿（月视图渲染逻辑等价，仅来源换成共享组件）。

- [ ] **Step 7: 提交**

```bash
git add src/plugins/calendar/CalendarCell.tsx src/plugins/calendar/__tests__/calendarCell.test.ts src/plugins/calendar/CalendarViewer.tsx
git commit -m "refactor(calendar): extract shared buildCellItems and CellItemButton"
```

---

## Task 3: WeeklyNoteEditor（第 8 列内联编辑器）

**Files:**
- Create: `src/plugins/calendar/WeeklyNoteEditor.tsx`

- [ ] **Step 1: 新建文件**

```tsx
import { createEffect, createResource, onCleanup, Show } from 'solid-js'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { GFM } from '@lezer/markdown'
import { darkHighlightStyle, darkTheme } from '../../lib/cm6/cmTheme'
import { embedPreviewPlugin, embedTheme } from '../../lib/cm6/embedExtension'
import { livePreviewExtension } from '../../lib/cm6/livePreviewExtension'
import { hideFrontmatterExtension } from '../../lib/cm6/hideFrontmatterExtension'
import { readFile, fileActions, vaultStore } from '../../vault'

export function WeeklyNoteEditor(props: { path: string; label: string }) {
  let editorHost!: HTMLDivElement
  let cmView: EditorView | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  const fileExists = () => !!vaultStore.files[props.path]

  const [content] = createResource(
    () => (vaultStore.files[props.path] ? props.path : null),
    async (path) => {
      try {
        return await readFile(path)
      } catch {
        return null
      }
    },
  )

  async function doSave() {
    if (!cmView) return
    await fileActions.saveFile(props.path, cmView.state.doc.toString())
  }

  function scheduleSave() {
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void doSave()
    }, 500)
  }

  createEffect(() => {
    const text = content()
    if (text === undefined) return
    if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
    cmView?.destroy()
    cmView = null
    if (text === null) return
    const state = EditorState.create({
      doc: text,
      extensions: [
        markdown({ codeLanguages: languages, extensions: [GFM] }),
        syntaxHighlighting(darkHighlightStyle),
        darkTheme,
        embedTheme,
        embedPreviewPlugin,
        livePreviewExtension,
        hideFrontmatterExtension,
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => { if (u.docChanged) scheduleSave() }),
        EditorView.domEventHandlers({
          keydown(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
              e.preventDefault()
              if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
              void doSave()
            }
          },
        }),
      ],
    })
    cmView = new EditorView({ state, parent: editorHost })
  })

  onCleanup(() => {
    if (saveTimer !== null) clearTimeout(saveTimer)
    cmView?.destroy()
    cmView = null
  })

  return (
    <div class="flex flex-col h-full min-h-0 overflow-hidden">
      <div class="px-3 py-1.5 shrink-0 border-b border-(--border) text-[10px] text-(--accent) font-bold tracking-widest uppercase">
        {props.label}
      </div>
      <div class="flex-1 min-h-0 relative">
        <Show when={!content.loading && !fileExists()}>
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-(--text-4)">
            <span class="text-[11px] italic">本周还没有周记</span>
            <button
              class="text-[11px] px-2 py-1 rounded border border-(--border) hover:border-(--accent) hover:text-(--accent) transition-colors"
              onClick={() => void fileActions.createFile(props.path)}
            >
              新建 {props.path.split('/').pop()}
            </button>
          </div>
        </Show>
        <div ref={editorHost} class="h-full overflow-auto" />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误（未挂载，仅编译）。

- [ ] **Step 3: 提交**

```bash
git add src/plugins/calendar/WeeklyNoteEditor.tsx
git commit -m "feat(calendar): add WeeklyNoteEditor for the week summary column"
```

---

## Task 4: WeekView（8 列周视图）

**Files:**
- Create: `src/plugins/calendar/WeekView.tsx`

- [ ] **Step 1: 新建文件**

```tsx
import { createDeferred, For } from 'solid-js'
import { vaultStore } from '../../vault'
import {
  buildDayData,
  buildTaskDayData,
  buildEntryDayData,
  getISOWeekDates,
  getISOWeekString,
  weekFilePath,
  parseISODate,
  WEEKDAYS_LONG,
} from './calendarUtils'
import { buildCellItems, CellItemButton, type FilterState } from './CalendarCell'
import { WeeklyNoteEditor } from './WeeklyNoteEditor'

export function WeekView(props: {
  weekAnchor: () => string
  filter: () => FilterState
  weeklyFolder: () => string
  todayStr: string
  onOpenFile: (p: string) => void
  onPrevWeek: () => void
  onNextWeek: () => void
  onToday: () => void
}) {
  const anchorDate = () => parseISODate(props.weekAnchor())
  const weekDates = () => getISOWeekDates(anchorDate())
  const weekLabel = () => getISOWeekString(anchorDate())
  const notePath = () => weekFilePath(props.weeklyFolder(), anchorDate())

  const dayData = createDeferred(() => buildDayData(vaultStore.files))
  const taskDayData = createDeferred(() => buildTaskDayData(vaultStore.taskMap, vaultStore.files))
  const entryDayData = createDeferred(() => buildEntryDayData(vaultStore.files))

  return (
    <div class="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Week nav */}
      <div class="flex items-center gap-2 px-4 py-1.5 border-b border-(--border) shrink-0">
        <button class="px-2 py-0.5 text-[12px] text-(--text-3) hover:text-(--text) hover:bg-(--bg-hover) rounded" onClick={props.onPrevWeek}>‹</button>
        <span class="text-[12px] font-medium text-(--text-2) min-w-[88px] text-center">{weekLabel()}</span>
        <button class="px-2 py-0.5 text-[12px] text-(--text-3) hover:text-(--text) hover:bg-(--bg-hover) rounded" onClick={props.onNextWeek}>›</button>
        <button class="ml-1 px-2 py-0.5 text-[11px] text-(--text-3) hover:text-(--text) hover:bg-(--bg-hover) rounded border border-(--border)" onClick={props.onToday}>今天</button>
      </div>

      {/* 8-column grid */}
      <div
        class="flex-1 min-h-0 grid"
        style={{ 'grid-template-columns': 'repeat(7, minmax(0, 1fr)) 1.6fr' }}
      >
        <For each={weekDates()}>
          {(day, i) => {
            const isToday = day === props.todayStr
            const items = () => buildCellItems(day, props.filter(), {
              dayData: dayData(),
              taskDayData: taskDayData(),
              entryDayData: entryDayData(),
            })
            return (
              <div class={`flex flex-col min-h-0 border-r border-(--border)${isToday ? ' bg-(--accent-bg)' : ''}`}>
                <div class={`shrink-0 px-1.5 py-1 text-center select-none border-b border-(--border)${i() >= 5 ? ' text-(--accent)' : ' text-(--text-3)'}`}>
                  <div class="text-[10px]">{WEEKDAYS_LONG[i()]}</div>
                  <div class={`text-[13px] font-semibold${isToday ? ' text-(--accent)' : ' text-(--text-2)'}`}>{day.slice(8)}</div>
                </div>
                <div class="flex-1 min-h-0 overflow-y-auto p-1 flex flex-col gap-0.5">
                  <For each={items()}>
                    {(item) => <CellItemButton item={item} onOpenFile={props.onOpenFile} />}
                  </For>
                </div>
              </div>
            )
          }}
        </For>

        {/* 8th column: weekly summary & reflection */}
        <div class="min-h-0 overflow-hidden">
          <WeeklyNoteEditor path={notePath()} label="本周总结与反思" />
        </div>
      </div>
    </div>
  )
}
```


- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add src/plugins/calendar/WeekView.tsx
git commit -m "feat(calendar): add 8-column WeekView with daily entries"
```

---

## Task 5: CalendarViewer 壳（viewState + 模式切换）+ 设置

**Files:**
- Modify: `src/plugins/calendar/CalendarViewer.tsx`
- Modify: `src/plugins/calendar/index.tsx`

- [ ] **Step 1: import 与 viewState 信号**

`CalendarViewer.tsx` 顶部 import 增补：`createSignal` 已在；加 `WeekView`、`parseISODate`/`toIsoDate`：

```ts
import { WeekView } from './WeekView'
```

并在现有 `calendarUtils` import 里补 `toIsoDate`（若未导入）：确认 `toIsoDate` 在该 import 列表中（它是导出的）。

在主组件 `CalendarViewer` 顶部（`todayStr` 之后）加模式/周状态：

```ts
  const initMode: 'week' | 'month' = props.viewState.mode === 'week' ? 'week' : 'month'
  const initAnchor = typeof props.viewState.weekAnchor === 'string' ? props.viewState.weekAnchor : todayStr
  const [mode, setMode] = createSignal<'week' | 'month'>(initMode)
  const [weekAnchor, setWeekAnchor] = createSignal(initAnchor)

  function applyState(nextMode: 'week' | 'month', nextAnchor: string) {
    setMode(nextMode)
    setWeekAnchor(nextAnchor)
    workspaceActions.setLeafViewState(props.leafId, {
      type: 'calendar',
      state: { mode: nextMode, weekAnchor: nextAnchor },
    })
  }

  function shiftWeek(days: number) {
    const d = parseISODate(weekAnchor())
    d.setDate(d.getDate() + days)
    applyState('week', toIsoDate(d.getFullYear(), d.getMonth(), d.getDate()))
  }

  const weeklyFolder = () => String(props.getConfig({ weeklyFolder: 'weekly' }).weeklyFolder)
```

（`parseISODate` 通过 `calendarUtils` import 引入——在该 import 列表加入 `parseISODate`。）

- [ ] **Step 2: 工具栏加 [月][周] 切换**

在工具栏"今天"按钮（约第 292–297 行的 scrollToToday 按钮）之后、过滤 chips `<div class="flex items-center gap-3 flex-wrap">` 之前，插入模式切换：

```tsx
        <div class="flex items-center rounded border border-(--border) overflow-hidden">
          <button
            class={`px-2 py-0.5 text-[11px] transition-colors${mode() === 'month' ? ' bg-(--accent) text-white' : ' text-(--text-3) hover:bg-(--bg-hover)'}`}
            onClick={() => applyState('month', weekAnchor())}
          >月</button>
          <button
            class={`px-2 py-0.5 text-[11px] transition-colors${mode() === 'week' ? ' bg-(--accent) text-white' : ' text-(--text-3) hover:bg-(--bg-hover)'}`}
            onClick={() => applyState('week', weekAnchor())}
          >周</button>
        </div>
```

- [ ] **Step 3: 主体按 mode 切换**

把"周几表头 + 虚拟滚动容器"两块（约第 332–391 行：从 `{/* Weekday header ... */}` 的 `<div class="grid grid-cols-7 ...">` 到滚动容器 `</div>` 结束）整体包进 `<Show>`，周模式渲染 `WeekView`：

```tsx
      <Show
        when={mode() === 'month'}
        fallback={
          <WeekView
            weekAnchor={weekAnchor}
            filter={filter}
            weeklyFolder={weeklyFolder}
            todayStr={todayStr}
            onOpenFile={workspaceActions.openFile}
            onPrevWeek={() => shiftWeek(-7)}
            onNextWeek={() => shiftWeek(7)}
            onToday={() => applyState('week', todayStr)}
          />
        }
      >
        {/* 原有：周几表头 + 虚拟滚动容器，保持不变 */}
      </Show>
```

即：原来那两块 JSX 原样放入 `<Show ...>` 与 `</Show>` 之间（作为 month 分支内容）。

- [ ] **Step 4: index.tsx 加 weeklyFolder 设置**

`src/plugins/calendar/index.tsx` 的 `CalendarSettings` 里，`config()` 默认值加 `weeklyFolder: 'weekly'`，并加一项文本输入。把 `config()` 改为：

```tsx
  const config = () => props.getConfig({
    weekStartsMonday: true,
    showLunar: false,
    weeklyFolder: 'weekly',
  })
```

在 `<div class="flex flex-col gap-5">` 内、农历 ToggleRow 之后加：

```tsx
      <label class="flex flex-col gap-1">
        <span class="text-[13px] t-base font-medium">周记文件夹</span>
        <span class="text-[11px] t-3">周视图"本周总结与反思"保存到该文件夹（ISO 周号命名，如 2026-W24.md）</span>
        <input
          class="mt-1 px-2 py-1 text-[12px] rounded border border-(--border) bg-(--bg-base) text-(--text) outline-none focus:border-(--accent)"
          value={String(config().weeklyFolder)}
          onChange={(e) => props.setConfig({ weeklyFolder: e.currentTarget.value.trim() })}
        />
      </label>
```

- [ ] **Step 5: 类型检查 + 测试 + 构建**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc 无错误；测试全绿；构建成功。

- [ ] **Step 6: 手动验证**

Run: `npm run dev`，打开 vault（含日记 `journal/2026-06-10.md`，内有任务/事件/心情/想法）。开"日历大图"：
Expected：
- 工具栏出现 `[月][周]` 切换。默认月视图（无限滚动，行为如旧）。
- 点"周"→ 切到 8 列周视图：7 个日列显示当天条目（任务/事件/心情/想法，列内可滚动），第 8 列"本周总结与反思"可编辑（输入自动保存到 `weekly/2026-W24.md`，不存在时显示"新建"）。
- `‹ / ›` 切换上下周（W 号变化），"今天"回到本周。
- 关掉 tab 再开日历，模式与所在周**保持**（viewState 持久化）。
- 切到月视图，b-① 的条目与过滤仍正常。

- [ ] **Step 7: 提交**

```bash
git add src/plugins/calendar/CalendarViewer.tsx src/plugins/calendar/index.tsx
git commit -m "feat(calendar): week/month mode in viewState with 8-column week view"
```

---

## 完成标准

- 日历可在月/周视图间切换；`[月][周]` 切换、所在周（anchor）持久化进 `viewState`，重开恢复。
- 周视图 8 列：7 日列复用条目渲染（列内滚动）、第 8 列内联编辑 `weekly/YYYY-Www.md`（防抖保存 / 可新建）。
- `weeklyFolder` 可在日历设置里改。
- 月视图与 b-① 行为不变（渲染走共享 `CellItemButton`）。
- ISO 周辅助与 `buildCellItems` 有单测；`tsc`/`vitest`/`build` 全绿。
