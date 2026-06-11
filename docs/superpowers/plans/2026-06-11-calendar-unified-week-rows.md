# Unified Week-Row Calendar with Weekly/Monthly Plans — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the calendar's month view and week view into one shared virtual-scroll list of week rows whose only difference is row height, with an 8th-column weekly plan on every week row and a monthly plan in every month header.

**Architecture:** `CalendarViewer.tsx` already owns a `@tanstack/solid-virtual` list of `month-header` + `week` rows. We widen week rows to 8 columns (7 days + weekly plan), add a monthly-plan preview to the header, drive row height off a `mode` signal (`'month'`≈140px / `'week'`≈420px day rows), and add a single `editingPath` signal so at most one inline CM6 editor is mounted across the whole list. The standalone `WeekView.tsx` and `WeeklyNoteEditor.tsx` are removed; a new generalized `PlanCellEditor.tsx` and read-only `PlanPreview.tsx` replace them.

**Tech Stack:** SolidJS, `@tanstack/solid-virtual`, CodeMirror 6, Tailwind (CSS-var theme), Vitest.

**Reference spec:** `docs/superpowers/specs/2026-06-11-calendar-unified-week-rows-design.md`

**Commands:**
- Unit tests: `npx vitest run src/plugins/calendar/__tests__/calendarUtils.test.ts`
- Typecheck: `npx tsc --noEmit`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/plugins/calendar/calendarUtils.ts` | pure date/path helpers + row model | add `getMonthString`, `monthFilePath`, `weekRowFilePath` |
| `src/plugins/calendar/__tests__/calendarUtils.test.ts` | unit tests for helpers | add cases |
| `src/plugins/calendar/PlanPreview.tsx` | read-only plan preview from `FileMeta.lists` | **new** |
| `src/plugins/calendar/PlanCellEditor.tsx` | single inline CM6 editor for a plan note | **new** (from `WeeklyNoteEditor`) |
| `src/plugins/calendar/CalendarViewer.tsx` | unified 8-col list, header plan, density, `editingPath` | rewrite rows + main body |
| `src/plugins/calendar/index.tsx` | settings | add `monthlyFolder` |
| `src/plugins/calendar/WeekView.tsx` | (old single-week view) | **delete** |
| `src/plugins/calendar/WeeklyNoteEditor.tsx` | (old weekly editor) | **delete** |
| `src/plugins/calendar/CalendarCell.tsx` | day-cell item buttons | unchanged |

---

## Task 1: Date/path helpers in `calendarUtils.ts`

**Files:**
- Modify: `src/plugins/calendar/calendarUtils.ts`
- Test: `src/plugins/calendar/__tests__/calendarUtils.test.ts`

- [ ] **Step 1: Write the failing tests**

Add this block to the END of `src/plugins/calendar/__tests__/calendarUtils.test.ts`, and add `getMonthString`, `monthFilePath`, `weekRowFilePath` to the existing import from `'../calendarUtils'` at the top of the file:

```ts
describe('month helpers', () => {
  it('getMonthString pads month and is local (not UTC)', () => {
    expect(getMonthString(new Date(2026, 5, 10))).toBe('2026-06')  // June
    expect(getMonthString(new Date(2026, 0, 1))).toBe('2026-01')   // January
    expect(getMonthString(new Date(2026, 11, 31))).toBe('2026-12') // December
  })

  it('monthFilePath joins folder and YYYY-MM name', () => {
    expect(monthFilePath('monthly', 2026, 5)).toBe('monthly/2026-06.md')
    expect(monthFilePath('', 2026, 5)).toBe('2026-06.md')
  })
})

describe('weekRowFilePath', () => {
  it('derives the weekly file from the row first non-null day', () => {
    const row = buildMonthRows(2026, 5).slice(1)[1] as WeekRow // 2nd week of June 2026
    const first = row.cells.find(c => c !== null)!
    expect(weekRowFilePath('weekly', row)).toBe(weekFilePath('weekly', parseISODate(first.dayStr)))
  })

  it('uses the first non-null cell when the row starts with null padding', () => {
    // A month whose 1st is not Monday: leading nulls in the first week row.
    const firstWeek = buildMonthRows(2026, 6).slice(1)[0] as WeekRow // July 2026 starts Wed
    expect(firstWeek.cells[0]).toBeNull()
    const first = firstWeek.cells.find(c => c !== null)!
    expect(weekRowFilePath('weekly', firstWeek)).toBe(weekFilePath('weekly', parseISODate(first.dayStr)))
  })

  it('returns null for an all-null row', () => {
    expect(weekRowFilePath('weekly', { type: 'week', cells: [null, null, null, null, null, null, null] })).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/plugins/calendar/__tests__/calendarUtils.test.ts`
Expected: FAIL — `getMonthString is not a function` (and the other two new helpers undefined).

- [ ] **Step 3: Implement the helpers**

In `src/plugins/calendar/calendarUtils.ts`, immediately AFTER the existing `weekFilePath` function (around line 188), add:

```ts
export function getMonthString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function monthFilePath(folder: string, year: number, month: number): string {
  const name = `${year}-${String(month + 1).padStart(2, '0')}.md`
  return folder ? `${folder}/${name}` : name
}
```

Then, AFTER the `WeekRow` interface is in scope (it is module-level) — add at the very end of the file (it depends on `weekFilePath` + `parseISODate`, both above it):

```ts
/** 由某周行的首个非空日推导该 ISO 周的周记路径；全空行返回 null。 */
export function weekRowFilePath(folder: string, row: WeekRow): string | null {
  const first = row.cells.find((c) => c !== null)
  if (!first) return null
  return weekFilePath(folder, parseISODate(first.dayStr))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/plugins/calendar/__tests__/calendarUtils.test.ts`
Expected: PASS (all prior + new tests).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/calendar/calendarUtils.ts src/plugins/calendar/__tests__/calendarUtils.test.ts
git commit -m "feat(calendar): getMonthString, monthFilePath, weekRowFilePath helpers"
```

---

## Task 2: `monthlyFolder` setting

**Files:**
- Modify: `src/plugins/calendar/index.tsx`

- [ ] **Step 1: Add the config default**

In `src/plugins/calendar/index.tsx`, in `CalendarSettings`, extend the `config` defaults:

```tsx
  const config = () => props.getConfig({
    weekStartsMonday: true,
    showLunar: false,
    weeklyFolder: 'weekly',
    monthlyFolder: 'monthly',
  })
```

- [ ] **Step 2: Add the input field**

In the same component, immediately AFTER the existing `周记文件夹` `<label>…</label>` block, add:

```tsx
      <label class="flex flex-col gap-1">
        <span class="text-[13px] t-base font-medium">月记文件夹</span>
        <span class="text-[11px] t-3">月视图表头“月计划”保存到该文件夹（YYYY-MM 命名，如 2026-06.md）</span>
        <input
          class="mt-1 px-2 py-1 text-[12px] rounded border border-(--border) bg-(--bg-base) text-(--text) outline-none focus:border-(--accent)"
          value={String(config().monthlyFolder)}
          onChange={(e) => props.setConfig({ monthlyFolder: e.currentTarget.value.trim() })}
        />
      </label>
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add src/plugins/calendar/index.tsx
git commit -m "feat(calendar): monthlyFolder setting"
```

---

## Task 3: `PlanPreview` component

A read-only preview of a plan note built reactively from `vaultStore.files[path].lists` (no file I/O). Shows a "新建" affordance when the file is missing, a list excerpt when it has list items, or a generic "点击编辑" hint for prose-only notes. Clicking anywhere calls `onEdit`.

**Files:**
- Create: `src/plugins/calendar/PlanPreview.tsx`

- [ ] **Step 1: Create the component**

Create `src/plugins/calendar/PlanPreview.tsx`:

```tsx
import { For, Show } from 'solid-js'
import { vaultStore, fileActions } from '../../vault'

const MAX_PREVIEW_ITEMS = 6

export function PlanPreview(props: {
  path: string
  label: string
  /** compact: single-line label+excerpt for the month header; default = column card */
  compact?: boolean
  onEdit: () => void
}) {
  const meta = () => vaultStore.files[props.path]
  const exists = () => !!meta()
  const items = () => (meta()?.lists ?? []).map((l) => l.visual).filter((v) => v.trim().length > 0)

  return (
    <div
      class={`flex min-h-0 cursor-text${props.compact ? ' items-center gap-2 overflow-hidden' : ' flex-col h-full overflow-hidden'}`}
      onClick={() => exists() && props.onEdit()}
    >
      <div
        class={`shrink-0 text-[10px] text-(--accent) font-bold tracking-widest uppercase select-none${props.compact ? '' : ' px-3 py-1.5 border-b border-(--border)'}`}
      >
        {props.label}
      </div>

      <Show
        when={exists()}
        fallback={
          <button
            class={`text-[11px] text-(--text-4) italic hover:text-(--accent) transition-colors text-left${props.compact ? '' : ' px-3 py-2'}`}
            onClick={(e) => { e.stopPropagation(); void fileActions.createFile(props.path) }}
          >
            新建 {props.path.split('/').pop()}
          </button>
        }
      >
        <Show
          when={items().length > 0}
          fallback={
            <div class={`text-[11px] text-(--text-4) italic${props.compact ? ' truncate' : ' px-3 py-2'}`}>
              有内容，点击编辑
            </div>
          }
        >
          <div
            class={props.compact
              ? 'flex-1 min-w-0 truncate text-[11px] text-(--text-3)'
              : 'flex-1 min-h-0 overflow-y-auto px-3 py-2 flex flex-col gap-0.5'}
          >
            <Show
              when={!props.compact}
              fallback={<span>{items().join('  ·  ')}</span>}
            >
              <For each={items().slice(0, MAX_PREVIEW_ITEMS)}>
                {(t) => <div class="text-[11px] text-(--text-2) leading-snug truncate">· {t}</div>}
              </For>
              <Show when={items().length > MAX_PREVIEW_ITEMS}>
                <div class="text-[10px] text-(--text-4)">+{items().length - MAX_PREVIEW_ITEMS} more</div>
              </Show>
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (The component is exported but not yet imported anywhere — that is fine; `tsc` does not flag unused exports.)

- [ ] **Step 3: Commit**

```bash
git add src/plugins/calendar/PlanPreview.tsx
git commit -m "feat(calendar): PlanPreview read-only plan cell"
```

---

## Task 4: `PlanCellEditor` component

Generalized from `WeeklyNoteEditor.tsx`: same CM6 extensions, 500ms debounced save, Ctrl/Cmd-S save, create-on-missing. Adds `onClose` plus Esc-to-close and blur-to-close (focus leaving the editor host), and autofocuses on mount. `onClose` is responsible only for clearing the parent's `editingPath`; this component always flushes a save before calling it.

**Files:**
- Create: `src/plugins/calendar/PlanCellEditor.tsx`

- [ ] **Step 1: Create the component**

Create `src/plugins/calendar/PlanCellEditor.tsx`:

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
import { editorKeymap } from '../../lib/cm6/markdownShortcuts'
import { readFile, fileActions, vaultStore } from '../../vault'

export function PlanCellEditor(props: { path: string; label: string; onClose: () => void }) {
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

  function flushSave() {
    if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
    void doSave()
  }

  function scheduleSave() {
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => { saveTimer = null; void doSave() }, 500)
  }

  function closeNow() {
    flushSave()
    props.onClose()
  }

  createEffect(() => {
    const exists = fileExists()
    const text = content()
    if (exists && content.loading) return
    if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
    cmView?.destroy()
    cmView = null
    if (!exists || text == null) return
    const state = EditorState.create({
      doc: text,
      extensions: [
        markdown({ codeLanguages: languages, extensions: [GFM] }),
        editorKeymap,
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
              flushSave()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              closeNow()
            }
          },
        }),
      ],
    })
    cmView = new EditorView({ state, parent: editorHost })
    cmView.focus()
  })

  // Blur-to-close: when focus leaves the editor host entirely, save & close.
  function onFocusOut(e: FocusEvent) {
    const next = e.relatedTarget as Node | null
    if (next && editorHost.contains(next)) return
    closeNow()
  }

  onCleanup(() => {
    flushSave()
    cmView?.destroy()
    cmView = null
  })

  return (
    <div class="flex flex-col h-full min-h-0 overflow-hidden">
      <div class="px-3 py-1.5 shrink-0 border-b border-(--border) flex items-center justify-between">
        <span class="text-[10px] text-(--accent) font-bold tracking-widest uppercase">{props.label}</span>
        <button
          class="text-[11px] text-(--text-4) hover:text-(--text-2) px-1"
          title="收起（保存）"
          onClick={closeNow}
        >✕</button>
      </div>
      <div class="flex-1 min-h-0 relative">
        <Show when={!content.loading && !fileExists()}>
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-(--text-4)">
            <span class="text-[11px] italic">还没有这个计划</span>
            <button
              class="text-[11px] px-2 py-1 rounded border border-(--border) hover:border-(--accent) hover:text-(--accent) transition-colors"
              onClick={() => void fileActions.createFile(props.path)}
            >
              新建 {props.path.split('/').pop()}
            </button>
          </div>
        </Show>
        <div ref={editorHost} class="h-full overflow-auto" onFocusOut={onFocusOut} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (exported, not yet used — fine).

- [ ] **Step 3: Commit**

```bash
git add src/plugins/calendar/PlanCellEditor.tsx
git commit -m "feat(calendar): PlanCellEditor single inline plan editor"
```

---

## Task 5: Widen week rows to 8 columns with the weekly-plan cell

Rewrite `WeekRowComp` and the main component so each week row is an 8-column grid (7 days + weekly plan), driven by `mode` for height/cap, with the plan cell toggling between `PlanPreview` and `PlanCellEditor` via a shared `editingPath` signal. The old `WeekView` is still mounted for `mode==='week'` after this task — it is removed in Task 7 — so the app stays working throughout.

**Files:**
- Modify: `src/plugins/calendar/CalendarViewer.tsx`

- [ ] **Step 1: Update imports**

In `src/plugins/calendar/CalendarViewer.tsx`, change the import from `'./calendarUtils'` to also bring in `weekRowFilePath`, and add imports for the two new components. Replace the existing import block (lines ~6-23) so it includes:

```tsx
import {
  buildDayData,
  buildTaskDayData,
  buildEntryDayData,
  buildCellItems,
  buildRangeRows,
  toIsoDate,
  parseISODate,
  weekRowFilePath,
  FILTER_DEFAULTS,
  WEEKDAYS_LONG,
  type CalRow,
  type MonthHeaderRow,
  type WeekRow,
  type Task,
  type FilterKey,
} from './calendarUtils'
import { CellItemButton } from './CalendarCell'
import { WeekView } from './WeekView'
import { PlanPreview } from './PlanPreview'
import { PlanCellEditor } from './PlanCellEditor'
```

- [ ] **Step 2: Add a shared row-height helper**

Replace the existing `estimateRowsHeight` helper (lines ~41-43) with a mode-aware pair:

```tsx
const HEADER_H = 40
const WEEK_ROW_H = { month: 140, week: 420 } as const

function rowHeight(row: CalRow, mode: 'week' | 'month'): number {
  return row.type === 'month-header' ? HEADER_H : WEEK_ROW_H[mode]
}

function estimateRowsHeight(rows: CalRow[], mode: 'week' | 'month'): number {
  return rows.reduce((acc, r) => acc + rowHeight(r, mode), 0)
}
```

- [ ] **Step 3: Rewrite `WeekRowComp`**

Replace the entire `WeekRowComp` function (lines ~75-133) with:

```tsx
function WeekRowComp(props: {
  row: WeekRow
  mode: () => 'week' | 'month'
  weeklyFolder: () => string
  editingPath: () => string | null
  setEditingPath: (p: string | null) => void
  dayData: () => ReturnType<typeof buildDayData>
  taskDayData: () => Record<string, Task[]>
  entryDayData: () => Record<string, Task[]>
  filter: () => typeof FILTER_DEFAULTS
  todayStr: string
  onOpenFile: (path: string) => void
}) {
  const planPath = () => weekRowFilePath(props.weeklyFolder(), props.row)
  return (
    <div
      class="grid border-b border-(--border)"
      style={{
        'grid-template-columns': 'repeat(7, minmax(0, 1fr)) 1.6fr',
        'min-height': `${WEEK_ROW_H[props.mode()]}px`,
      }}
    >
      <For each={props.row.cells}>
        {(cell, i) => {
          if (cell === null) {
            return <div class="bg-[var(--bg-surface)] border-r border-(--border)" />
          }
          const { dayStr, day } = cell
          const isToday = dayStr === props.todayStr
          const week = () => props.mode() === 'week'

          const cellData = () => {
            const all = buildCellItems(dayStr, props.filter(), {
              dayData: props.dayData(),
              taskDayData: props.taskDayData(),
              entryDayData: props.entryDayData(),
            })
            if (week() || all.length <= MAX_CELL_ITEMS) return { items: all, more: 0 }
            return { items: all.slice(0, MAX_CELL_ITEMS - 1), more: all.length - (MAX_CELL_ITEMS - 1) }
          }

          return (
            <div
              class={`p-1.5 flex flex-col min-h-0 overflow-hidden border-r border-(--border)${isToday ? ' bg-(--accent-bg)' : ' bg-[var(--bg-base)]'}`}
            >
              <div
                class={`shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-[12px] font-semibold mb-1 select-none${isToday ? ' bg-(--accent) text-white' : ' text-[var(--text-3)]'}`}
              >
                {day}
              </div>
              <div class="flex flex-col gap-0.5 min-h-0 overflow-y-auto">
                <For each={cellData().items}>
                  {(item) => <CellItemButton item={item} onOpenFile={props.onOpenFile} wrap={week()} />}
                </For>
                <Show when={cellData().more > 0}>
                  <div class="shrink-0 text-[10px] text-[var(--text-4)] px-1.5 py-0.5 select-none">
                    +{cellData().more} more
                  </div>
                </Show>
              </div>
            </div>
          )
        }}
      </For>

      {/* 8th column: weekly plan */}
      <div class="flex flex-col min-h-0 overflow-hidden bg-[var(--bg-surface)]">
        <Show
          when={planPath()}
          fallback={<div class="flex-1" />}
        >
          {(path) => (
            <Show
              when={props.editingPath() === path()}
              fallback={<PlanPreview path={path()} label="周计划" onEdit={() => props.setEditingPath(path())} />}
            >
              <PlanCellEditor path={path()} label="周计划" onClose={() => props.setEditingPath(null)} />
            </Show>
          )}
        </Show>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add the `editingPath` signal and pass props through**

In `CalendarViewer`, after the `weekAnchor` signal declarations (~line 145), add:

```tsx
  const [editingPath, setEditingPath] = createSignal<string | null>(null)
```

Then, in the `<For each={virtualizer.getVirtualItems()}>` body, update the `WeekRowComp` usage (the `else` branch of the `row().type === 'month-header'` ternary, ~lines 382-390) to pass the new props:

```tsx
                    <WeekRowComp
                      row={row() as WeekRow}
                      mode={mode}
                      weeklyFolder={weeklyFolder}
                      editingPath={editingPath}
                      setEditingPath={setEditingPath}
                      dayData={dayData}
                      taskDayData={taskDayData}
                      entryDayData={entryDayData}
                      filter={filter}
                      todayStr={todayStr}
                      onOpenFile={workspaceActions.openFile}
                    />
```

- [ ] **Step 5: Add the 8th weekday-header cell**

The fixed weekday header (~lines 338-348) is a `grid grid-cols-7`. Replace its container and add the plan header cell:

```tsx
      <div
        class="grid border-b border-(--border) bg-[var(--bg-surface)] shrink-0"
        style={{ 'grid-template-columns': 'repeat(7, minmax(0, 1fr)) 1.6fr' }}
      >
        <For each={WEEKDAYS_LONG}>
          {(d, i) => (
            <div
              class={`py-2 text-center text-[11px] select-none border-r border-(--border)${i() >= 5 ? ' text-(--accent)' : ' text-[var(--text-3)]'}`}
            >
              {d}
            </div>
          )}
        </For>
        <div class="py-2 text-center text-[11px] select-none text-(--text-3)">周计划</div>
      </div>
```

- [ ] **Step 6: Fix the two `estimateRowsHeight` callers**

`prependMonths` calls `estimateRowsHeight(newRows)` (~line 218) — change to `estimateRowsHeight(newRows, mode())`.

The `initialScrollOffset` (~lines 188-190) and `estimateSize` (~line 201) still use literal `32`/`140`. Replace the `initialScrollOffset` reduce with:

```tsx
  const initialScrollOffset = initialRows
    .slice(0, Math.max(0, todayMonthIdx))
    .reduce((acc, r) => acc + rowHeight(r, initMode), 0)
```

And replace the virtualizer's `estimateSize` (~line 201) with:

```tsx
    estimateSize: (i) => {
      const r = rows()[i]
      return r ? rowHeight(r, mode()) : WEEK_ROW_H.month
    },
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/plugins/calendar/CalendarViewer.tsx
git commit -m "feat(calendar): 8-column week rows with inline weekly-plan cell"
```

---

## Task 6: Monthly-plan preview in the month header

Make the header show its month's monthly-plan note: a compact `PlanPreview` next to the title that expands into a `PlanCellEditor` via the same `editingPath`.

**Files:**
- Modify: `src/plugins/calendar/CalendarViewer.tsx`

- [ ] **Step 1: Add `monthFilePath` + `getMonthString` are not needed here — derive path inline**

Add `monthFilePath` to the `'./calendarUtils'` import list (alongside `weekRowFilePath`):

```tsx
  monthFilePath,
```

- [ ] **Step 2: Add a `monthlyFolder` accessor**

Next to the existing `weeklyFolder` accessor (~line 162), add:

```tsx
  const monthlyFolder = () => String(props.getConfig({ monthlyFolder: 'monthly' }).monthlyFolder)
```

- [ ] **Step 3: Rewrite `MonthHeader`**

Replace the `MonthHeader` function (~lines 67-73) with one that takes the plan path + editing state:

```tsx
function MonthHeader(props: {
  year: number
  month: number
  monthlyFolder: () => string
  editingPath: () => string | null
  setEditingPath: (p: string | null) => void
}) {
  const path = () => monthFilePath(props.monthlyFolder(), props.year, props.month)
  return (
    <Show
      when={props.editingPath() === path()}
      fallback={
        <div class="flex items-stretch gap-3 px-4 bg-[var(--bg-surface)] border-b border-(--border)">
          <span class="shrink-0 py-1.5 text-[13px] font-semibold text-[var(--text)] self-center">
            {props.year}年{props.month + 1}月
          </span>
          <div class="flex-1 min-w-0 self-center">
            <PlanPreview path={path()} label="月计划" compact onEdit={() => props.setEditingPath(path())} />
          </div>
        </div>
      }
    >
      <div class="border-b border-(--border) bg-[var(--bg-surface)]" style={{ height: '320px' }}>
        <PlanCellEditor path={path()} label={`${props.year}年${props.month + 1}月 · 月计划`} onClose={() => props.setEditingPath(null)} />
      </div>
    </Show>
  )
}
```

- [ ] **Step 4: Pass the new props at the `MonthHeader` call site**

In the virtual-item body, update the `month-header` branch (~lines 376-380):

```tsx
                  {row().type === 'month-header' ? (
                    <MonthHeader
                      year={(row() as MonthHeaderRow).year}
                      month={(row() as MonthHeaderRow).month}
                      monthlyFolder={monthlyFolder}
                      editingPath={editingPath}
                      setEditingPath={setEditingPath}
                    />
                  ) : (
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

Note: when a header is expanded its DOM height (≈320px) exceeds the `HEADER_H` (40) estimate; the existing `measureElement` ref on each virtual row corrects this automatically — no estimate change needed.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/calendar/CalendarViewer.tsx
git commit -m "feat(calendar): monthly-plan preview/editor in month header"
```

---

## Task 7: Collapse week mode to density-only; remove `WeekView` + `WeeklyNoteEditor`

Make the 月/周 toggle change only row height. Remove the standalone `WeekView` mount, the now-unused `weekAnchor`/`shiftWeek` plumbing, and the two superseded files. Re-measure the virtualizer when `mode` flips so the new heights take effect.

**Files:**
- Modify: `src/plugins/calendar/CalendarViewer.tsx`
- Delete: `src/plugins/calendar/WeekView.tsx`, `src/plugins/calendar/WeeklyNoteEditor.tsx`

- [ ] **Step 1: Re-measure on mode change**

In `CalendarViewer`, immediately AFTER the `virtualizer` is created (after its `createVirtualizer({...})` block, ~line 204), add:

```tsx
  // Row heights depend on mode; reset measurements when it flips.
  createEffect(() => {
    mode()
    virtualizer.measure()
  })
```

Ensure `createEffect` is in the `'solid-js'` import (add it to the existing import on line 1 if absent):

```tsx
import { createDeferred, createEffect, createMemo, createSignal, For, Show, type JSX } from 'solid-js'
```

(`createMemo` may already be unused after edits — if `npx tsc --noEmit` reports it unused, drop it from this import.)

- [ ] **Step 2: Remove the `<Show when={mode()==='week'}>` WeekView block**

Delete the entire trailing block (~lines 400-411):

```tsx
      <Show when={mode() === 'week'}>
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
      </Show>
```

- [ ] **Step 3: Make the month-view container always visible**

The unified list lives inside the `<div … style={{ display: mode() === 'month' ? 'flex' : 'none' }}>` wrapper (~lines 333-335). Change it to always display:

```tsx
      <div class="flex flex-col flex-1 min-h-0">
```

(Remove the `style={{ display: … }}` attribute entirely. The explanatory comment above it about keeping the scroll element mounted no longer needs the display toggle — you may trim it to a one-line note.)

- [ ] **Step 4: Remove dead `weekAnchor`/`shiftWeek` plumbing**

- Delete the `shiftWeek` function (~lines 156-160).
- Simplify `applyState` to only persist `mode`. Replace the `applyState` function and the `weekAnchor` signal/init (~lines 142-154) with:

```tsx
  const initMode: 'week' | 'month' = props.viewState.mode === 'week' ? 'week' : 'month'
  const [mode, setMode] = createSignal<'week' | 'month'>(initMode)

  function applyMode(nextMode: 'week' | 'month') {
    setMode(nextMode)
    workspaceActions.setLeafViewState(props.leafId, {
      type: 'calendar',
      state: { mode: nextMode },
    })
  }
```

- Update the two toolbar toggle buttons (~lines 267-274) to call `applyMode`:

```tsx
          <button
            class={`px-2 py-0.5 text-[11px] transition-colors${mode() === 'month' ? ' bg-(--accent) text-white' : ' text-(--text-3) hover:bg-(--bg-hover)'}`}
            onClick={() => applyMode('month')}
          >月</button>
          <button
            class={`px-2 py-0.5 text-[11px] transition-colors${mode() === 'week' ? ' bg-(--accent) text-white' : ' text-(--text-3) hover:bg-(--bg-hover)'}`}
            onClick={() => applyMode('week')}
          >周</button>
```

- Remove the now-unused `WeekView` import line (`import { WeekView } from './WeekView'`).

- [ ] **Step 5: Delete the superseded files**

```bash
git rm src/plugins/calendar/WeekView.tsx src/plugins/calendar/WeeklyNoteEditor.tsx
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. If it flags `createMemo` (or any other) as unused in `CalendarViewer.tsx`, remove it from the import and re-run.

- [ ] **Step 7: Commit**

```bash
git add src/plugins/calendar/CalendarViewer.tsx
git commit -m "refactor(calendar): mode = row density; remove standalone WeekView"
```

---

## Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `npx vitest run`
Expected: PASS (all suites, including the new `calendarUtils` cases).

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: PASS, zero errors.

- [ ] **Step 3: Production build**

Run: `npx vite build`
Expected: build completes with no errors.

- [ ] **Step 4: Manual smoke test (`npx vite`)**

Open the 日历大图 page and confirm:
1. **Month mode**: compact rows; each week row shows an 8th "周计划" column; each month header shows "月计划" preview beside the title.
2. **周 toggle**: rows grow taller (no remount/blank list); day cells show more items with scroll; headers unchanged.
3. **Edit weekly plan**: click a 周计划 cell → CM6 editor opens inline and focuses; type → autosaves; click another plan cell → first saves & closes, second opens (only one editor at a time).
4. **Edit monthly plan**: click a header 月计划 → header expands into editor; Esc closes & saves.
5. **Blur-to-close**: open an editor, click a day item / outside → editor saves & closes.
6. **Create-on-missing**: a week/month with no note shows "新建 …"; clicking creates `weekly/<ISO>.md` / `monthly/<YYYY-MM>.md` and the editor takes over.
7. **今天** scrolls to the current month.

- [ ] **Step 5: Final commit (if any manual-fix tweaks were needed)**

```bash
git add -A
git commit -m "test(calendar): verify unified week-row views"
```

(Skip if Steps 1-4 required no changes.)

---

## Self-Review Notes

- **Spec coverage:** unified list/density → Tasks 5-7; 8th-col weekly plan → Task 5; monthly plan header → Task 6; preview-from-`lists` + single editor → Tasks 3-6 (`editingPath`); file model + settings → Tasks 1-2; WeekView removal → Task 7. All spec sections mapped.
- **Type consistency:** `editingPath: () => string | null` / `setEditingPath: (p: string | null) => void` used identically in `WeekRowComp` (Task 5) and `MonthHeader` (Task 6); `weekRowFilePath`/`monthFilePath` signatures match Task 1; `rowHeight`/`WEEK_ROW_H`/`HEADER_H` defined in Task 5 and reused in Tasks 5-7.
- **No placeholders:** every code step contains full code; commands have expected outcomes.
