# Calendar Viewer Infinite Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `CalendarViewer` to support bi-directional infinite scroll across months using a virtual list, with five per-type filter checkboxes persisted to plugin config.

**Architecture:** A flat `CalRow[]` signal (month-header rows + week rows) powers `@tanstack/solid-virtual`; prepend/append load 3 more months when the viewport approaches either edge. Filter state lives in the plugin's `getConfig`/`setConfig` (same pattern as `DashboardViewer`), auto-saved to `localStorage`.

**Tech Stack:** SolidJS, `@tanstack/solid-virtual` (already installed v3.13.26), Tailwind CSS, Vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/plugins/calendar/calendarUtils.ts` | Modify | Add `CalRow` types + `buildMonthRows` + `buildRangeRows` |
| `src/plugins/calendar/__tests__/calendarUtils.test.ts` | Create | Tests for new utility functions |
| `src/plugins/calendar/CalendarViewer.tsx` | Rewrite | Virtual-list infinite-scroll view with filter props |
| `src/plugins/calendar/index.tsx` | Modify | Wrap `CalendarViewer` with `getConfig`/`setConfig` |

`CalendarPanel.tsx` (sidebar mini calendar) is **not touched**.

---

## Task 1: Add row types and builder functions to calendarUtils.ts

**Files:**
- Modify: `src/plugins/calendar/calendarUtils.ts`
- Create: `src/plugins/calendar/__tests__/calendarUtils.test.ts`

- [ ] **Step 1.1: Write the failing tests**

Create `src/plugins/calendar/__tests__/calendarUtils.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  buildMonthRows,
  buildRangeRows,
  toIsoDate,
} from '../calendarUtils'
import type { MonthHeaderRow, WeekRow } from '../calendarUtils'

describe('buildMonthRows', () => {
  it('first row is month-header with correct year/month', () => {
    const rows = buildMonthRows(2026, 5)  // June 2026
    expect(rows[0]).toEqual({ type: 'month-header', year: 2026, month: 5 })
  })

  it('remaining rows are week rows', () => {
    const rows = buildMonthRows(2026, 5)
    const weeks = rows.slice(1) as WeekRow[]
    expect(weeks.every(r => r.type === 'week')).toBe(true)
  })

  it('each week row has exactly 7 cells', () => {
    const rows = buildMonthRows(2026, 5)
    const weeks = rows.slice(1) as WeekRow[]
    expect(weeks.every(r => r.cells.length === 7)).toBe(true)
  })

  it('non-null cells have correct dayStr format', () => {
    const rows = buildMonthRows(2026, 5)
    const weeks = rows.slice(1) as WeekRow[]
    const allCells = weeks.flatMap(r => r.cells).filter(c => c !== null)
    expect(allCells.every(c => /^\d{4}-\d{2}-\d{2}$/.test(c!.dayStr))).toBe(true)
  })

  it('June 2026 has 30 days total across all non-null cells', () => {
    const rows = buildMonthRows(2026, 5)
    const weeks = rows.slice(1) as WeekRow[]
    const nonNull = weeks.flatMap(r => r.cells).filter(c => c !== null)
    expect(nonNull.length).toBe(30)
  })

  it('February 2024 (leap year) has 29 days', () => {
    const rows = buildMonthRows(2024, 1)
    const weeks = rows.slice(1) as WeekRow[]
    const nonNull = weeks.flatMap(r => r.cells).filter(c => c !== null)
    expect(nonNull.length).toBe(29)
  })

  it('first non-null cell of June 2026 is Monday (index 0)', () => {
    // June 2026 starts on Monday
    const rows = buildMonthRows(2026, 5)
    const firstWeek = (rows[1] as WeekRow).cells
    expect(firstWeek[0]).not.toBeNull()
    expect(firstWeek[0]!.day).toBe(1)
    expect(firstWeek[0]!.dayStr).toBe('2026-06-01')
  })
})

describe('buildRangeRows', () => {
  it('returns empty array for count 0', () => {
    expect(buildRangeRows(2026, 5, 0)).toEqual([])
  })

  it('count=1 returns same as buildMonthRows', () => {
    expect(buildRangeRows(2026, 5, 1)).toEqual(buildMonthRows(2026, 5))
  })

  it('count=2 concatenates two months', () => {
    const result = buildRangeRows(2026, 5, 2)
    const expected = [...buildMonthRows(2026, 5), ...buildMonthRows(2026, 6)]
    expect(result).toEqual(expected)
  })

  it('wraps month correctly across year boundary', () => {
    const result = buildRangeRows(2025, 11, 2)
    const headers = result.filter(r => r.type === 'month-header') as MonthHeaderRow[]
    expect(headers[0]).toEqual({ type: 'month-header', year: 2025, month: 11 })
    expect(headers[1]).toEqual({ type: 'month-header', year: 2026, month: 0 })
  })

  it('wraps month correctly when startMonth is negative (e.g. going backwards)', () => {
    // Jan 2026 minus 3 months = Oct 2025 (month -3 from Jan = month 9 prev year)
    const result = buildRangeRows(2025, 9, 3)
    const headers = result.filter(r => r.type === 'month-header') as MonthHeaderRow[]
    expect(headers[0]).toEqual({ type: 'month-header', year: 2025, month: 9 })
    expect(headers[1]).toEqual({ type: 'month-header', year: 2025, month: 10 })
    expect(headers[2]).toEqual({ type: 'month-header', year: 2025, month: 11 })
  })
})
```

- [ ] **Step 1.2: Run tests to verify they fail**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run src/plugins/calendar/__tests__/calendarUtils.test.ts
```

Expected: FAIL — `buildMonthRows`, `buildRangeRows`, `MonthHeaderRow`, `WeekRow` not exported yet.

- [ ] **Step 1.3: Add types and functions to calendarUtils.ts**

Add after the existing `WEEKDAYS_LONG` export (before `toIsoDate`):

```ts
// ── Multi-month row model ─────────────────────────────────────────────────────

export interface DayRef {
  year: number
  month: number
  day: number
  dayStr: string
}

export interface MonthHeaderRow {
  type: 'month-header'
  year: number
  month: number
}

export interface WeekRow {
  type: 'week'
  cells: (DayRef | null)[]
}

export type CalRow = MonthHeaderRow | WeekRow
```

Then add after `buildCalendarGrid`:

```ts
export function buildMonthRows(year: number, month: number): CalRow[] {
  const grid = buildCalendarGrid(year, month)
  const header: MonthHeaderRow = { type: 'month-header', year, month }
  const weeks: WeekRow[] = []
  for (let i = 0; i < grid.length; i += 7) {
    const cells: (DayRef | null)[] = []
    for (let j = 0; j < 7; j++) {
      const d = grid[i + j]
      cells.push(d === null ? null : { year, month, day: d, dayStr: toIsoDate(year, month, d) })
    }
    weeks.push({ type: 'week', cells })
  }
  return [header, ...weeks]
}

export function buildRangeRows(startYear: number, startMonth: number, count: number): CalRow[] {
  const rows: CalRow[] = []
  for (let i = 0; i < count; i++) {
    const total = startYear * 12 + startMonth + i
    rows.push(...buildMonthRows(Math.floor(total / 12), total % 12))
  }
  return rows
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run src/plugins/calendar/__tests__/calendarUtils.test.ts
```

Expected: All tests pass.

- [ ] **Step 1.5: Commit**

```bash
git add src/plugins/calendar/calendarUtils.ts src/plugins/calendar/__tests__/calendarUtils.test.ts
git commit -m "feat: add CalRow types and buildMonthRows/buildRangeRows to calendarUtils"
```

---

## Task 2: Update CalendarPlugin to pass config props to CalendarViewer

**Files:**
- Modify: `src/plugins/calendar/index.tsx`

- [ ] **Step 2.1: Update the page view registration**

In `src/plugins/calendar/index.tsx`, replace the `CalendarViewer` view registration inside `setup(ctx)`:

Before:
```ts
ctx.view({
  kind: 'page',
  type: 'calendar',
  getDisplayText: () => '日历',
  getIcon: () => <CalendarRange size={11} />,
  component: CalendarViewer,
})
```

After:
```ts
ctx.view({
  kind: 'page',
  type: 'calendar',
  getDisplayText: () => '日历',
  getIcon: () => <CalendarRange size={11} />,
  component: (viewProps) => (
    <CalendarViewer
      {...viewProps}
      getConfig={(d) => ctx.settings.getConfig(d)}
      setConfig={(p) => ctx.settings.setConfig(p)}
    />
  ),
})
```

- [ ] **Step 2.2: Run full test suite to confirm no regressions**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run
```

Expected: All tests pass.

- [ ] **Step 2.3: Commit**

```bash
git add src/plugins/calendar/index.tsx
git commit -m "feat: pass getConfig/setConfig into CalendarViewer"
```

---

## Task 3: Rewrite CalendarViewer with virtual list + infinite scroll + filters

**Files:**
- Rewrite: `src/plugins/calendar/CalendarViewer.tsx`

- [ ] **Step 3.1: Replace CalendarViewer.tsx with new implementation**

Write the full file:

```tsx
import { createMemo, For, onMount } from 'solid-js'
import { createVirtualizer } from '@tanstack/solid-virtual'
import { vaultStore } from '../../vault'
import { workspaceActions } from '../../stores/workspaceStore'
import type { ViewComponentProps } from '../../stores/types'
import {
  buildDayData,
  buildTaskDayData,
  buildRangeRows,
  WEEKDAYS_LONG,
  type CalRow,
  type WeekRow,
  type Task,
} from './calendarUtils'
import { buildDayData as _bd } from './calendarUtils'

// ── Types ────────────────────────────────────────────────────────────────────

interface CalendarViewerProps extends ViewComponentProps {
  getConfig: <T extends Record<string, unknown>>(defaults: T) => T
  setConfig: (patch: Record<string, unknown>) => void
}

const FILTER_DEFAULTS = {
  dated: true,
  created: true,
  updated: true,
  pending: true,
  done: true,
}
type FilterKey = keyof typeof FILTER_DEFAULTS

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeYM(year: number, month: number) {
  const total = year * 12 + month
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 }
}

function estimateRowsHeight(rows: CalRow[]): number {
  return rows.reduce((acc, r) => acc + (r.type === 'month-header' ? 32 : 80), 0)
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FilterChip(props: {
  label: string
  colorClass: string
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
      <span class={`w-2 h-2 rounded-sm shrink-0 ${props.colorClass}`} />
      <span class="text-[var(--text-3)]">{props.label}</span>
    </button>
  )
}

function MonthHeader(props: { year: number; month: number }) {
  return (
    <div class="px-4 py-1.5 text-[13px] font-semibold text-[var(--text)] bg-[var(--bg-surface)] border-b border-(--border)">
      {props.year}年{props.month + 1}月
    </div>
  )
}

function WeekRowComp(props: {
  row: WeekRow
  dayData: () => ReturnType<typeof buildDayData>
  taskDayData: () => Record<string, Task[]>
  filter: () => typeof FILTER_DEFAULTS
  todayStr: string
  onOpenFile: (path: string) => void
}) {
  return (
    <div class="grid grid-cols-7 border-b border-(--border)">
      <For each={props.row.cells}>
        {(cell, i) => {
          if (cell === null) {
            return (
              <div
                class={`min-h-[80px] bg-[var(--bg-surface)]${i() < 6 ? ' border-r border-(--border)' : ''}`}
              />
            )
          }
          const { dayStr, day } = cell
          const isToday = dayStr === props.todayStr
          const dated = () =>
            props.filter().dated ? (props.dayData().dated[dayStr] ?? []) : []
          const created = () =>
            props.filter().created ? (props.dayData().created[dayStr] ?? []) : []
          const updated = () =>
            props.filter().updated ? (props.dayData().updated[dayStr] ?? []) : []
          const allTasks = () => props.taskDayData()[dayStr] ?? []
          const pending = () =>
            props.filter().pending ? allTasks().filter((t) => !t.checked) : []
          const done = () =>
            props.filter().done ? allTasks().filter((t) => t.checked) : []

          return (
            <div
              class={`p-1.5 flex flex-col min-h-[80px]${i() < 6 ? ' border-r border-(--border)' : ''}${isToday ? ' bg-(--accent-bg)' : ' bg-[var(--bg-base)]'}`}
            >
              <div
                class={`shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-[12px] font-semibold mb-1 select-none${isToday ? ' bg-(--accent) text-white' : ' text-[var(--text-3)]'}`}
              >
                {day}
              </div>
              <div class="flex flex-col gap-0.5">
                <For each={dated()}>
                  {(path) => (
                    <button
                      class="shrink-0 text-left text-[10px] leading-snug px-1.5 py-0.5 rounded bg-(--bg-hover) text-[var(--text-2)] truncate w-full cursor-pointer hover:bg-[var(--text-4)] hover:text-[var(--text)] transition-colors"
                      onClick={() => props.onOpenFile(path)}
                      title={path}
                    >
                      {path.split('/').pop()?.replace(/\.md$/, '')}
                    </button>
                  )}
                </For>
                <For each={created()}>
                  {(path) => (
                    <button
                      class="shrink-0 text-left text-[10px] leading-snug px-1.5 py-0.5 rounded bg-(--accent-bg) text-(--accent) truncate w-full cursor-pointer hover:bg-(--accent) hover:text-white transition-colors"
                      onClick={() => props.onOpenFile(path)}
                      title={path}
                    >
                      {path.split('/').pop()?.replace(/\.md$/, '')}
                    </button>
                  )}
                </For>
                <For each={updated()}>
                  {(path) => (
                    <button
                      class="shrink-0 text-left text-[10px] leading-snug px-1.5 py-0.5 rounded bg-(--bg-hover) text-[var(--link-2)] truncate w-full cursor-pointer hover:bg-[var(--link-2)] hover:text-white transition-colors"
                      onClick={() => props.onOpenFile(path)}
                      title={path}
                    >
                      {path.split('/').pop()?.replace(/\.md$/, '')}
                    </button>
                  )}
                </For>
                <For each={pending()}>
                  {(task) => (
                    <button
                      class="shrink-0 text-left text-[10px] leading-snug px-1.5 py-0.5 rounded w-full cursor-pointer transition-colors truncate text-[var(--tag)] hover:opacity-80"
                      style={{
                        'background-color':
                          'color-mix(in srgb, var(--tag) 18%, transparent)',
                      }}
                      onClick={() => props.onOpenFile(task.path)}
                      title={task.path}
                    >
                      ☐ {task.cleanText}
                    </button>
                  )}
                </For>
                <For each={done()}>
                  {(task) => (
                    <button
                      class="shrink-0 text-left text-[10px] leading-snug px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-3)] hover:text-[var(--text-2)] line-through w-full cursor-pointer transition-colors truncate"
                      onClick={() => props.onOpenFile(task.path)}
                      title={task.path}
                    >
                      ☑ {task.cleanText}
                    </button>
                  )}
                </For>
              </div>
            </div>
          )
        }}
      </For>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function CalendarViewer(props: CalendarViewerProps) {
  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  // Filter state — persisted via plugin config
  const filter = () => {
    const cfg = props.getConfig({ filter: FILTER_DEFAULTS })
    return { ...FILTER_DEFAULTS, ...(cfg.filter as Partial<typeof FILTER_DEFAULTS>) }
  }
  const toggleFilter = (key: FilterKey) =>
    props.setConfig({ filter: { ...filter(), [key]: !filter()[key] } })

  // Vault data
  const dayData = createMemo(() => buildDayData(vaultStore.files))
  const taskDayData = createMemo(() => buildTaskDayData(vaultStore.taskMap))

  // Row list — mutable head/tail month tracking (not reactive, just boundary markers)
  let head = normalizeYM(now.getFullYear(), now.getMonth() - 3)
  let tail = normalizeYM(now.getFullYear(), now.getMonth() + 3)

  const [rows, setRows] = createSignal<CalRow[]>(
    buildRangeRows(head.year, head.month, 7),
  )

  // Virtual list
  let scrollEl!: HTMLDivElement
  let pendingLoad = false

  const virtualizer = createVirtualizer({
    get count() {
      return rows().length
    },
    getScrollElement: () => scrollEl,
    estimateSize: (i) => (rows()[i]?.type === 'month-header' ? 32 : 80),
    overscan: 3,
  })

  // Infinite scroll actions
  const appendMonths = (n: number) => {
    const start = normalizeYM(tail.year, tail.month + 1)
    const newRows = buildRangeRows(start.year, start.month, n)
    tail = normalizeYM(tail.year, tail.month + n)
    setRows((prev) => [...prev, ...newRows])
  }

  const prependMonths = (n: number) => {
    const start = normalizeYM(head.year, head.month - n)
    const newRows = buildRangeRows(start.year, start.month, n)
    head = normalizeYM(head.year, head.month - n)
    const estimatedHeight = estimateRowsHeight(newRows)
    setRows((prev) => [...newRows, ...prev])
    // Compensate scroll after reactive updates flush
    queueMicrotask(() => {
      scrollEl.scrollTop += estimatedHeight
    })
  }

  const handleScroll = () => {
    if (pendingLoad) return
    const items = virtualizer.getVirtualItems()
    if (items.length === 0) return
    if (items[0].index < 5) {
      pendingLoad = true
      prependMonths(3)
      requestAnimationFrame(() => {
        pendingLoad = false
      })
    } else if (items[items.length - 1].index > rows().length - 5) {
      pendingLoad = true
      appendMonths(3)
      requestAnimationFrame(() => {
        pendingLoad = false
      })
    }
  }

  // Scroll to today's month on mount
  const scrollToToday = () => {
    const idx = rows().findIndex(
      (r) =>
        r.type === 'month-header' &&
        r.year === now.getFullYear() &&
        r.month === now.getMonth(),
    )
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'start' })
  }

  onMount(() => scrollToToday())

  return (
    <div class="flex-1 flex flex-col overflow-hidden bg-[var(--bg-base)]">
      {/* Toolbar */}
      <div class="flex items-center gap-3 px-4 py-2 border-b border-(--border) shrink-0 flex-wrap">
        <button
          class="px-2.5 py-1 text-[11px] text-[var(--text-3)] hover:text-[var(--text)] hover:bg-(--bg-hover) rounded transition-colors border border-(--border)"
          onClick={scrollToToday}
        >
          今天
        </button>
        <div class="flex items-center gap-3 flex-wrap">
          <FilterChip
            label="日记"
            colorClass="bg-(--bg-active)"
            active={filter().dated}
            onClick={() => toggleFilter('dated')}
          />
          <FilterChip
            label="新建"
            colorClass="bg-(--accent)"
            active={filter().created}
            onClick={() => toggleFilter('created')}
          />
          <FilterChip
            label="修改"
            colorClass="bg-[var(--link-2)]"
            active={filter().updated}
            onClick={() => toggleFilter('updated')}
          />
          <FilterChip
            label="待办"
            colorClass="bg-[var(--tag)]"
            active={filter().pending}
            onClick={() => toggleFilter('pending')}
          />
          <FilterChip
            label="已完成"
            colorClass="bg-[var(--text-4)]"
            active={filter().done}
            onClick={() => toggleFilter('done')}
          />
        </div>
      </div>

      {/* Weekday header — fixed, outside scroll area */}
      <div class="grid grid-cols-7 border-b border-(--border) bg-[var(--bg-surface)] shrink-0">
        <For each={WEEKDAYS_LONG}>
          {(d, i) => (
            <div
              class={`py-2 text-center text-[11px] select-none${i() < 6 ? ' border-r border-(--border)' : ''}${i() >= 5 ? ' text-(--accent)' : ' text-[var(--text-3)]'}`}
            >
              {d}
            </div>
          )}
        </For>
      </div>

      {/* Virtual scroll container */}
      <div
        ref={scrollEl}
        class="flex-1 min-h-0 overflow-y-auto"
        onScroll={handleScroll}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: 'relative',
          }}
        >
          <For each={virtualizer.getVirtualItems()}>
            {(vItem) => {
              const row = () => rows()[vItem.index]
              return (
                <div
                  style={{
                    position: 'absolute',
                    top: '0',
                    transform: `translateY(${vItem.start}px)`,
                    width: '100%',
                  }}
                  ref={(el) => virtualizer.measureElement(el)}
                  data-index={vItem.index}
                >
                  {row().type === 'month-header' ? (
                    <MonthHeader year={row().year} month={(row() as { month: number }).month} />
                  ) : (
                    <WeekRowComp
                      row={row() as WeekRow}
                      dayData={dayData}
                      taskDayData={taskDayData}
                      filter={filter}
                      todayStr={todayStr}
                      onOpenFile={workspaceActions.openFile}
                    />
                  )}
                </div>
              )
            }}
          </For>
        </div>
      </div>
    </div>
  )
}
```

> **Note:** `createSignal` must be imported. The import line at top needs: `import { createMemo, createSignal, For, onMount } from 'solid-js'`

- [ ] **Step 3.2: Fix the import line**

The import at the top of `CalendarViewer.tsx` must be:

```tsx
import { createMemo, createSignal, For, onMount } from 'solid-js'
import { createVirtualizer } from '@tanstack/solid-virtual'
import { vaultStore } from '../../vault'
import { workspaceActions } from '../../stores/workspaceStore'
import type { ViewComponentProps } from '../../stores/types'
import {
  buildDayData,
  buildTaskDayData,
  buildRangeRows,
  WEEKDAYS_LONG,
  type CalRow,
  type WeekRow,
  type Task,
} from './calendarUtils'
```

Remove the duplicate import of `buildDayData as _bd` that appears in step 3.1's draft — that line is an artifact and should not be present.

- [ ] **Step 3.3: Verify TypeScript compilation**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit
```

Expected: No errors. If errors appear, fix type mismatches (common issue: `row().year` on a `CalRow` union — use type narrowing or cast).

**Common fix if TypeScript complains about `row().year`/`row().month` on `CalRow`:**

Replace the conditional JSX in the `For` loop:

```tsx
{row().type === 'month-header' ? (
  <MonthHeader
    year={(row() as MonthHeaderRow).year}
    month={(row() as MonthHeaderRow).month}
  />
) : (
  <WeekRowComp row={row() as WeekRow} ... />
)}
```

Import `MonthHeaderRow` from `'./calendarUtils'` as well.

- [ ] **Step 3.4: Run all tests**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run
```

Expected: All tests pass (CalendarViewer has no unit tests — that's fine, it's a UI component).

- [ ] **Step 3.5: Commit**

```bash
git add src/plugins/calendar/CalendarViewer.tsx
git commit -m "feat: rewrite CalendarViewer with infinite scroll virtual list and type filters"
```

---

## Task 4: Manual verification

- [ ] **Step 4.1: Start dev server**

```bash
cd /home/huxzhi/4-code/symbol-notes && npm run dev
```

- [ ] **Step 4.2: Open CalendarViewer (日历大图) and verify**

Checklist:
- [ ] Calendar opens showing current month in view
- [ ] Scroll down — future months load continuously without a jump
- [ ] Scroll up past the top — past months prepend without viewport jumping
- [ ] Today's date is highlighted with accent background
- [ ] Weekday header (一 二 三 四 五 六 日) is fixed and doesn't scroll
- [ ] 「今天」button scrolls back to current month
- [ ] Files appear in their day cells under correct categories
- [ ] Clicking a file item opens it in the editor

- [ ] **Step 4.3: Verify filter checkboxes**

Checklist:
- [ ] Each checkbox dims to 35% opacity when inactive
- [ ] Toggling 「新建」hides/shows created-file badges from all day cells
- [ ] Toggling 「修改」hides/shows updated-file badges
- [ ] Toggling 「日记」hides/shows dated-file badges
- [ ] Toggling 「待办」hides pending task items
- [ ] Toggling 「已完成」hides done task items
- [ ] Reload the page — filter state is restored from localStorage (persisted via plugin config)

- [ ] **Step 4.4: Verify CalendarPanel (侧边栏小日历) is unaffected**

Open the left sidebar calendar panel and confirm it still works normally (it shares `calendarUtils` but not `CalendarViewer`).

- [ ] **Step 4.5: Final commit if any cleanup was needed**

```bash
git add -p  # stage only needed fixes
git commit -m "fix: calendar viewer minor adjustments from manual testing"
```
