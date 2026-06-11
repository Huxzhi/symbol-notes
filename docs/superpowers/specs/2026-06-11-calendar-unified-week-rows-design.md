# Calendar: Unified Week-Row Views with Weekly/Monthly Plans

**Date:** 2026-06-11
**Status:** Approved design

## Problem

The calendar page (`src/plugins/calendar/`) currently renders two structurally
different views:

- **Month view** (`CalendarViewer.tsx`): an infinite virtual-scroll list of
  `month-header` rows + `week` rows. Each week row is a **7-column** grid (days
  only), fixed 140px height. Month headers show just "2026年6月". No plan column.
- **Week view** (`WeekView.tsx`): a separate component showing **one** ISO week
  as an **8-column** grid (7 days + an 8th column holding a CM6 editor for the
  weekly note `weekly/2026-W24.md`, labeled "本周总结与反思"). Full-height
  columns, its own ‹/›/今天 navigation.

There is no monthly-note concept anywhere.

These two views duplicate rendering logic and diverge in capability: the 8th
"plan" column and a plan in the header exist only in week / neither view. We want
them unified so both modes share one week-row model and both surface weekly and
monthly plans.

## Goals

1. Both modes render from **one shared virtual-scroll list** of week rows +
   month headers. The 月/周 toggle changes only **row density** (height).
2. Every week row gains an **8th column** showing that ISO week's **weekly
   plan** (the existing weekly note file).
3. Every month header shows that month's **monthly plan** (a new monthly note
   file).
4. Plan cells show a lightweight **read-only preview** by default; clicking a
   cell expands a **single** inline CM6 editor (at most one mounted globally).

## Non-Goals

- No change to day-cell content (`buildCellItems`, `CalendarCell.tsx` stay as
  is).
- No new prose-rendering / markdown preview engine — previews come from already
  parsed list items.
- Weekly "plan" and weekly "summary/reflection" are **the same file** (the
  existing weekly note); we are not introducing a separate plan file.

## File Model

| Surface | File | Folder setting | Example |
|---|---|---|---|
| 8th column (per ISO week) | weekly note (existing) | `weeklyFolder` (default `weekly`) | `weekly/2026-W24.md` |
| Month header (per month) | monthly note (**new**) | `monthlyFolder` (default `monthly`) | `monthly/2026-06.md` |

The 8th-column weekly plan reuses the existing weekly note file unchanged. The
month-header monthly plan is a new file keyed by `YYYY-MM`.

## Design

### 1. Unified list — mode = row density

`WeekView.tsx` is **removed**. Both modes render the same virtual list in
`CalendarViewer.tsx`. The 月/周 toggle sets a density `mode` that only affects
heights:

- **month mode**: day rows ≈ 140px, header ≈ 36px (today's existing feel, plus
  header preview line).
- **week mode**: day rows ≈ 420px (taller — ~1–2 weeks visible), header ≈ 36px.

`estimateSize` returns the per-mode estimate; the existing `measureElement`
ref on each rendered row corrects actual height, so taller rows and
expanded-editor rows need no special-casing. The old WeekView ‹/›/今天 week
navigation is gone — navigation is scrolling. The toolbar's 今天 button scrolls
to today's month (existing `scrollToToday`). The `weekAnchor`/`shiftWeek` logic
and its `viewState` plumbing are removed; only `mode` is persisted.

### 2. Eight-column grid

Each `WeekRow` renders `grid-template-columns: repeat(7, minmax(0,1fr)) 1.6fr`
(matching the old WeekView). Columns 1–7 are day cells with unchanged content
(`buildCellItems` → `CellItemButton`). Column 8 is the **weekly plan cell** for
that row's ISO week. The fixed weekday header gains an 8th header cell labeled
"周计划".

A week row's ISO week is derived from its first non-null day cell. Boundary
weeks (a week split across two month blocks, e.g. end-of-June / start-of-July)
appear as two partial rows that both reference the **same** weekly file — this
is consistent with how the month grid already splits boundary weeks into two
padded rows.

### 3. Plan cells — preview + single inline editor

**Preview (default):** A `PlanPreview` component renders read-only from
`vaultStore.files[path].lists[].visual` — the first few parsed list items. This
is fully reactive and does no file I/O. If the file does not exist, the cell
shows a muted "新建 {filename}" affordance (mirrors `WeeklyNoteEditor`'s empty
state). Notes that are prose-only (no list items) show a generic
"有内容，点击编辑" indicator.

**Editing:** A single `editingPath: string | null` signal lives in
`CalendarViewer` and is threaded to every plan cell and month header. When
`editingPath === thisCellPath`, the cell swaps its preview for a `PlanCellEditor`
(generalized from `WeeklyNoteEditor.tsx`, keeping its debounced 500ms save,
Ctrl/Cmd-S save, and create-on-missing button). The editing row grows; the
virtualizer re-measures it.

Only one editor is ever mounted. The active editor saves and closes (sets
`editingPath` back to `null`) when:

- another plan cell or header is clicked (`editingPath` changes), or
- the editor loses focus (focusout leaving the editor host), or
- Esc is pressed, or
- the editing row scrolls out of the virtualizer's rendered range (its
  `onCleanup` saves).

`PlanCellEditor` reuses `WeeklyNoteEditor`'s existing teardown effect, which
already destroys the prior CM6 view and flushes pending saves when its `path`
changes — so switching cells is safe.

### 4. Monthly plan in the header

`MonthHeader` renders "2026年6月" plus, to its right, a single-line `PlanPreview`
of `monthFilePath(monthlyFolder, year, month)`. Clicking the header's plan area
sets `editingPath` to the monthly file, expanding the header into the same
`PlanCellEditor` (the header row grows; `measureElement` corrects). Same
single-active-editor rules apply.

### 5. Utils / data (`calendarUtils.ts`)

New helpers:

- `getMonthString(date: Date): string` → `"2026-06"` (local date, not UTC).
- `monthFilePath(folder: string, year: number, month: number): string` →
  `folder ? \`${folder}/${y}-${mm}.md\` : \`${y}-${mm}.md\``.
- A per-row weekly-path derivation: from a `WeekRow`'s first non-null
  `DayRef.dayStr`, build the ISO week via existing `getISOWeekString` +
  `weekFilePath`. Implemented as a small helper
  `weekRowFilePath(folder, row)` (returns `null` for an all-null row, which
  cannot occur in practice but is handled defensively).

Existing `getISOWeek`, `getISOWeekString`, `getISOWeekDates`, `weekFilePath`
are unchanged and reused.

### 6. Settings (`index.tsx`)

Add a `monthlyFolder` config (default `monthly`) with a text input mirroring the
existing `weeklyFolder` field. Description: monthly note named by `YYYY-MM`,
e.g. `2026-06.md`.

## Components / Files

| File | Change |
|---|---|
| `CalendarViewer.tsx` | 8-col week rows; header monthly-plan preview; `editingPath` signal threaded down; `mode` drives only row density; remove `weekAnchor`/`shiftWeek`/WeekView mount. |
| `PlanCellEditor.tsx` | **New** — generalized from `WeeklyNoteEditor.tsx` (debounced save, create-on-missing, Ctrl/Cmd-S). Adds blur/Esc → close callback. |
| `PlanPreview.tsx` | **New** — read-only preview from `FileMeta.lists`; empty-state "新建"; click → set `editingPath`. |
| `calendarUtils.ts` | Add `getMonthString`, `monthFilePath`, `weekRowFilePath`. |
| `index.tsx` | Add `monthlyFolder` setting + input. |
| `WeekView.tsx` | **Removed.** |
| `WeeklyNoteEditor.tsx` | **Removed** (superseded by `PlanCellEditor`). |
| `CalendarCell.tsx` | Unchanged. |

## Testing

- `calendarUtils.test.ts`: add cases for `getMonthString` (incl. month padding /
  year boundaries), `monthFilePath` (with and without folder), and
  `weekRowFilePath` (derives the correct ISO week file from a row whose first
  cells are null padding).
- Manual: toggle 月/周 changes density without unmounting the scroll element;
  clicking a weekly cell and a month header each opens exactly one editor;
  opening a second closes the first (saving); Esc/blur/scroll-away saves and
  closes; create-on-missing writes the correctly-named weekly/monthly file.

## Risks / Notes

- **Multiple editors in a virtual list** is the core risk; mitigated by the
  single-`editingPath` invariant — only the one matching cell mounts CM6.
- **Row-height churn** when an editor expands a row is handled by the existing
  `measureElement` dynamic measurement already used by the virtualizer.
- **Boundary weeks** referencing the same weekly file in two rows is intentional
  and matches current month-grid behavior.
- Previews from `lists` miss prose-only content; acceptable — the indicator
  signals editable content and the editor shows full text.
