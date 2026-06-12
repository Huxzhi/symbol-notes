# Calendar: Scroll Position Indicator + Re-anchor on Mode Toggle

**Date:** 2026-06-12
**Status:** Approved design

## Problem

In the unified week-row calendar (`CalendarViewer.tsx`):

1. Toggling 月/周 changes row height (140px ↔ 420px) and calls `virtualizer.measure()`,
   but the scroll position (`scrollTop`) stays a fixed pixel value — which now points
   at a *different* date than before the toggle. The view jumps.
2. There is no always-visible indicator of where you are in the infinite scroll. As you
   scroll across months, nothing tells you the current year/month/week.

## Goals

1. **Re-anchor on mode toggle:** the row at the top of the viewport before the toggle
   stays at the top after it, despite the height change.
2. **Position indicator:** a toolbar label showing the current top row's
   `YYYY年M月 · Www` (年月 + ISO week), updating as the user scrolls. Shown in both modes.

## Non-Goals

- No change to day-cell or plan-cell content.
- No per-row sticky month labels inside the grid (just the one toolbar indicator).

## Design

### 1. `calRowLabel(row: CalRow): string` — `calendarUtils.ts`

Pure helper. Returns `YYYY年M月 · Www`:

- **week row:** derive from the first non-null `DayRef` cell — `new Date(cell.year, cell.month, cell.day)`.
- **month-header row:** derive from the 1st of that month — `new Date(row.year, row.month, 1)`.
- ISO week via the existing `getISOWeek`; week is zero-padded to 2 digits (`W04`).
- An all-null week row (cannot occur in practice) returns `''`.

Unit-tested for: a normal week row, a month-header row, and a first-week row that begins
with null padding (label derived from the first real day, not the padding).

### 2. Toolbar position indicator — `CalendarViewer.tsx`

- New signal `const [topLabel, setTopLabel] = createSignal('')`.
- `updateTopLabel()`: reads `virtualizer.getVirtualItems()[0]`; if present, looks up
  `rows()[item.index]` and sets `topLabel(calRowLabel(row))`.
- Called: (a) at the start of the existing `handleScroll` (before its `pendingLoad`
  guard, so it always runs); (b) once after mount via
  `onMount(() => requestAnimationFrame(updateTopLabel))`.
- Rendered in the toolbar immediately after the 月|周 toggle group:
  `<span class="text-[12px] font-medium text-(--text-2) min-w-[128px] tabular-nums">{topLabel()}</span>`.

### 3. Re-anchor on mode toggle — `CalendarViewer.tsx`

Replace the standalone `createEffect(() => { mode(); virtualizer.measure() })` with logic
inside `applyMode`:

```
function applyMode(nextMode) {
  const items = virtualizer.getVirtualItems()
  const topIndex = items.length ? items[0].index : 0
  setMode(nextMode)
  workspaceActions.setLeafViewState(props.leafId, { type: 'calendar', state: { mode: nextMode } })
  virtualizer.measure()                       // recompute with new row heights
  requestAnimationFrame(() => {
    virtualizer.scrollToIndex(topIndex, { align: 'start' })
    updateTopLabel()
  })
}
```

`scrollToIndex` keeps the same row pinned to the top; the trailing `updateTopLabel()`
refreshes the indicator for the new top position.

## Files

| File | Change |
|---|---|
| `calendarUtils.ts` | add `calRowLabel` |
| `__tests__/calendarUtils.test.ts` | add `calRowLabel` cases |
| `CalendarViewer.tsx` | `topLabel` signal + `updateTopLabel`; toolbar span; `applyMode` re-anchor (replaces `createEffect`); import `getISOWeek`, `onMount` |

## Testing

- Unit: `calRowLabel` (week row / header / null-padded first week).
- Manual: scroll month & week modes → toolbar label tracks the top row; toggle 月↔周 →
  the same date stays at the top (no jump) and the label updates accordingly.
