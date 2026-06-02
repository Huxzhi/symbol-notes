# Dashboard Plugin Design

**Date:** 2026-06-02  
**Status:** Approved

## Overview

A new `dashboard` plugin that provides a full-page view (main area, opened from ribbon) displaying:
- Top: this week's 7-day task grid (from `vaultStore.taskMap`)
- Middle left: today's plan (from daily note file)
- Middle right: weekly plan (from ISO 8601 week file)
- Bottom: monthly plan (from ISO 8601 month file)

Plan sections are read-only CM6 previews; clicking opens the file in the editor.

## File Structure

```
src/plugins/dashboard/
  index.tsx           — plugin registration + settings UI
  DashboardViewer.tsx — main page component + ReadOnlyPlan sub-component
  dashboardUtils.ts   — pure date/path utilities
```

## New MD File Formats (ISO 8601)

| Type    | Naming format | Example       | Default folder |
|---------|--------------|---------------|---------------|
| Weekly  | `YYYY-Www.md` | `2026-W23.md` | `weekly/`     |
| Monthly | `YYYY-MM.md`  | `2026-06.md`  | `monthly/`    |

Both folders are configurable in the plugin settings tab.

## Layout

```
┌──────────────────────────────────────────────────────────┐
│  仪表盘   2026-W23   [今天]                               │  toolbar
├──────────────────────────────────────────────────────────┤
│  本周任务                                                 │
│  ┌──────┬──────┬──────┬──────┬──────┬──────┬──────┐     │
│  │ 周一 │ 周二 │ 周三 │ 周四 │ 周五 │ 周六 │ 周日 │     │
│  │  2   │  3   │ [4]  │  5   │  6   │  7   │  8   │     │
│  │ ✓ 写 │ 复习 │      │      │      │      │      │     │
│  └──────┴──────┴──────┴──────┴──────┴──────┴──────┘     │
├─────────────────────┬────────────────────────────────────┤
│  今日计划  [↗]       │  本周计划  [新建/↗]                │
│  (YYYY-MM-DD.md)    │  (YYYY-Www.md)                     │
│  read-only CM6      │  read-only CM6                     │
├─────────────────────┴────────────────────────────────────┤
│  月度计划  [新建/↗]                                       │
│  (YYYY-MM.md)                                            │
│  read-only CM6                                           │
└──────────────────────────────────────────────────────────┘
```

## Data Flow

### Weekly Task Grid

```
vaultStore.taskMap
  → buildTaskDayData()        (reuse from calendarUtils.ts)
  → filter to ISO week dates  (getISOWeekDates(today))
  → group tasks by day
  → render 7 columns (Mon–Sun), highlight today
```

Tasks displayed as a compact list inside each day cell. Checked tasks shown with strikethrough.

### Today's Plan

```
loadFromStorage('sn-plugin-daily-note', DAILY_DEFAULTS)
  → extract { folder, dateFormat }
  → compute path: todayPath(folder, dateFormat)  (reuse from daily-note/formatDate.ts)
  → readFile(path) via fileIO
  → mount CM6 read-only editor with markdown extensions
```

If file doesn't exist: show "今日日记尚未创建" (no create button — defer to daily-note plugin).

### Weekly / Monthly Plan

```
dashboard config → { weeklyFolder, monthlyFolder }
  → weekFilePath(weeklyFolder, date)  = "{folder}/2026-W23.md"
  → monthFilePath(monthlyFolder, date) = "{folder}/2026-06.md"
  → readFile(path)
  → mount CM6 read-only editor
```

If file doesn't exist: show "[新建]" button that calls `fileActions.createFile(path)` then opens it.

## Utilities (dashboardUtils.ts)

```ts
getISOWeekDates(date: Date): string[]   // 7 YYYY-MM-DD strings, Mon–Sun
getISOWeekString(date: Date): string    // "YYYY-Www" e.g. "2026-W23"
getMonthString(date: Date): string      // "YYYY-MM" e.g. "2026-06"
weekFilePath(folder: string, date: Date): string
monthFilePath(folder: string, date: Date): string
```

ISO week number follows ISO 8601: week 1 is the week containing the first Thursday.

## ReadOnlyPlan Component

A reusable SolidJS component used for all three plan sections:

```
Props: { path: string; label: string; onOpen: () => void; onCreate?: () => void }
```

- `createResource` to load content via `readFile(path)`
- Mounts `EditorView` with `EditorState.readOnly.of(true)`, `EditorView.editable.of(false)`, markdown + GFM extensions, `livePreviewExtension`, CM6 theme
- Cleans up `EditorView` on component unmount
- When `path` changes: destroy old view, create new one
- File not found: show empty state with optional `[新建]` button

## Plugin Registration (index.tsx)

```ts
definePlugin({
  id: 'dashboard',
  name: '仪表盘',
  setup(ctx) {
    ctx.view({ kind: 'page', type: 'dashboard', ... component: DashboardViewer })
    ctx.ribbon({ id: 'dashboard', ... onClick: () => ctx.workspace.openPage('dashboard') })
    ctx.settings.tab({ name: '仪表盘', component: DashboardSettings })
  }
})
```

Settings tab exposes:
- `weeklyFolder` (default: `"weekly"`)
- `monthlyFolder` (default: `"monthly"`)

## Error Handling

- `readFile` failure (filesystem unavailable): show "加载失败" with retry affordance
- `vaultStore` not indexed yet: show empty task cells (no skeleton needed)
- File not found: handled per-section (see above)

## Integration Points

- `src/App.tsx`: add `import { DashboardPlugin } from './plugins/dashboard'` + `registerPlugin(DashboardPlugin)`
- `calendarUtils.ts`: reuse `buildTaskDayData` (no changes needed)
- `daily-note/formatDate.ts`: reuse `todayPath` (no changes needed)
- `fileIO.ts`: use `readFile` (no changes needed)
- `fileActions` from `runtimeStore`: use `createFile` for [新建] buttons

## Out of Scope

- Inline editing within the dashboard
- Navigation to previous/next weeks
- Task creation from the dashboard
- Mobile / narrow layout handling
