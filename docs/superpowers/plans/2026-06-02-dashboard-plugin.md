# Dashboard Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `dashboard` plugin that opens as a full-page view showing the current week's task grid, today's daily note preview, a weekly plan file preview, and a monthly plan file preview.

**Architecture:** Three new files: `dashboardUtils.ts` (pure ISO date/path functions, fully tested), `DashboardViewer.tsx` (page component with `ReadOnlyPlan` and `WeekTaskGrid` sub-components), and `index.tsx` (plugin registration + settings UI). The viewer reads daily-note config from localStorage via `loadFromStorage`, reads dashboard folder settings via `ctx.settings.getConfig` (passed as a prop through a wrapper closure in `index.tsx`), and pulls task data from `vaultStore.taskMap`. Plan sections use CM6 in read-only mode, reusing `livePreviewExtension`, `darkTheme`, and `embedPreviewPlugin`.

**Tech Stack:** SolidJS (`createMemo`, `createResource`, `createEffect`, `onCleanup`), CodeMirror 6, `@codemirror/lang-markdown`, `@lezer/markdown` (GFM), Tailwind CSS utility classes, Vitest for utility tests.

---

### Task 1: dashboardUtils.ts — ISO week/month path utilities

**Files:**
- Create: `src/plugins/dashboard/dashboardUtils.ts`
- Create: `src/plugins/dashboard/__tests__/dashboardUtils.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/plugins/dashboard/__tests__/dashboardUtils.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  getISOWeek,
  getISOWeekString,
  getISOWeekDates,
  getMonthString,
  weekFilePath,
  monthFilePath,
} from '../dashboardUtils'

describe('getISOWeek', () => {
  it('returns correct week for mid-year Tuesday', () => {
    // 2026-06-02 is Tuesday → ISO week 23
    expect(getISOWeek(new Date(2026, 5, 2))).toEqual({ year: 2026, week: 23 })
  })

  it('Jan 1 in last week of previous ISO year', () => {
    // 2021-01-01 is Friday → belongs to ISO week 53 of 2020
    expect(getISOWeek(new Date(2021, 0, 1))).toEqual({ year: 2020, week: 53 })
  })

  it('Dec 31 in first week of next ISO year', () => {
    // 2019-12-31 is Tuesday → belongs to ISO week 1 of 2020
    expect(getISOWeek(new Date(2019, 11, 31))).toEqual({ year: 2020, week: 1 })
  })
})

describe('getISOWeekString', () => {
  it('pads single-digit week with leading zero', () => {
    // 2026-01-05 is Monday → week 2
    expect(getISOWeekString(new Date(2026, 0, 5))).toBe('2026-W02')
  })

  it('formats double-digit week correctly', () => {
    expect(getISOWeekString(new Date(2026, 5, 2))).toBe('2026-W23')
  })
})

describe('getISOWeekDates', () => {
  it('returns 7 strings starting from Monday of the week', () => {
    // 2026-06-02 is Tuesday → week starts 2026-06-01 (Mon), ends 2026-06-07 (Sun)
    const dates = getISOWeekDates(new Date(2026, 5, 2))
    expect(dates).toHaveLength(7)
    expect(dates[0]).toBe('2026-06-01')
    expect(dates[6]).toBe('2026-06-07')
  })

  it('returns same week when given Monday', () => {
    const dates = getISOWeekDates(new Date(2026, 5, 1))
    expect(dates[0]).toBe('2026-06-01')
    expect(dates[6]).toBe('2026-06-07')
  })

  it('returns same week when given Sunday', () => {
    const dates = getISOWeekDates(new Date(2026, 5, 7))
    expect(dates[0]).toBe('2026-06-01')
    expect(dates[6]).toBe('2026-06-07')
  })
})

describe('getMonthString', () => {
  it('pads single-digit month with leading zero', () => {
    expect(getMonthString(new Date(2026, 0, 15))).toBe('2026-01')
  })

  it('formats double-digit month', () => {
    expect(getMonthString(new Date(2026, 11, 1))).toBe('2026-12')
  })
})

describe('weekFilePath', () => {
  it('prepends folder with slash', () => {
    expect(weekFilePath('weekly', new Date(2026, 5, 2))).toBe('weekly/2026-W23.md')
  })

  it('omits prefix when folder is empty string', () => {
    expect(weekFilePath('', new Date(2026, 5, 2))).toBe('2026-W23.md')
  })
})

describe('monthFilePath', () => {
  it('prepends folder with slash', () => {
    expect(monthFilePath('monthly', new Date(2026, 5, 2))).toBe('monthly/2026-06.md')
  })

  it('omits prefix when folder is empty string', () => {
    expect(monthFilePath('', new Date(2026, 5, 2))).toBe('2026-06.md')
  })
})
```

- [ ] **Step 2: Run tests — expect failure (module not found)**

```bash
npx vitest run src/plugins/dashboard/__tests__/dashboardUtils.test.ts
```

Expected: FAIL — "Cannot find module '../dashboardUtils'"

- [ ] **Step 3: Implement dashboardUtils.ts**

Create `src/plugins/dashboard/dashboardUtils.ts`:

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

export function getMonthString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function weekFilePath(folder: string, date: Date): string {
  const name = `${getISOWeekString(date)}.md`
  return folder ? `${folder}/${name}` : name
}

export function monthFilePath(folder: string, date: Date): string {
  const name = `${getMonthString(date)}.md`
  return folder ? `${folder}/${name}` : name
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
npx vitest run src/plugins/dashboard/__tests__/dashboardUtils.test.ts
```

Expected: 13 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/dashboard/dashboardUtils.ts src/plugins/dashboard/__tests__/dashboardUtils.test.ts
git commit -m "feat: add dashboardUtils ISO week/month path utilities"
```

---

### Task 2: DashboardViewer.tsx — all view components

**Files:**
- Create: `src/plugins/dashboard/DashboardViewer.tsx`

Depends on Task 1 (imports `dashboardUtils.ts`).

- [ ] **Step 1: Create DashboardViewer.tsx**

Create `src/plugins/dashboard/DashboardViewer.tsx`:

```tsx
import {
  createEffect,
  createMemo,
  createResource,
  For,
  onCleanup,
  Show,
} from 'solid-js'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { GFM } from '@lezer/markdown'
import { darkHighlightStyle, darkTheme } from '../../lib/cmTheme'
import { livePreviewExtension } from '../../lib/livePreviewExtension'
import { embedPreviewPlugin, embedTheme } from '../../lib/embedExtension'
import { loadFromStorage } from '../../lib/localStorage'
import { readFile } from '../../services/fileIO'
import { fileActions } from '../../stores/runtimeStore'
import { vaultStore } from '../../stores/vaultStore'
import { workspaceActions } from '../../stores/workspaceStore'
import type { ViewComponentProps } from '../../stores/types'
import { buildTaskDayData } from '../calendar/calendarUtils'
import type { Task } from '../calendar/calendarUtils'
import { todayPath } from '../daily-note/formatDate'
import {
  getISOWeekDates,
  getISOWeekString,
  monthFilePath,
  weekFilePath,
} from './dashboardUtils'

// ── Read-only CM6 theme for plan preview panels ───────────────────────────────

const planReadOnlyTheme = EditorView.theme({
  '&': { background: 'transparent', height: '100%' },
  '.cm-scroller': { padding: '4px 8px', boxSizing: 'border-box' },
  '.cm-cursor, .cm-selectionBackground, .cm-focused .cm-selectionBackground': {
    display: 'none !important',
  },
  '.cm-content': { caretColor: 'transparent' },
})

// ── ReadOnlyPlan ──────────────────────────────────────────────────────────────

function ReadOnlyPlan(props: {
  path: string
  label: string
  onOpen: () => void
  onCreate?: () => void
}) {
  let editorHost!: HTMLDivElement
  let cmView: EditorView | null = null

  const fileExists = () => !!vaultStore.files[props.path]

  const [content] = createResource(
    () => props.path,
    async (path) => {
      if (!vaultStore.files[path]) return null
      try {
        return await readFile(path)
      } catch {
        return null
      }
    },
  )

  createEffect(() => {
    const text = content()
    if (text === undefined) return

    cmView?.destroy()
    cmView = null

    if (!text) return

    const state = EditorState.create({
      doc: text,
      extensions: [
        markdown({ codeLanguages: languages, extensions: [GFM] }),
        syntaxHighlighting(darkHighlightStyle),
        darkTheme,
        planReadOnlyTheme,
        embedTheme,
        embedPreviewPlugin,
        livePreviewExtension,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.lineWrapping,
      ],
    })
    cmView = new EditorView({ state, parent: editorHost })
  })

  onCleanup(() => {
    cmView?.destroy()
    cmView = null
  })

  return (
    <div class="flex flex-col h-full overflow-hidden">
      <div class="flex items-center gap-1 px-3 py-1 border-b border-(--border) shrink-0">
        <span class="flex-1 text-[10px] text-(--accent) font-bold tracking-widest uppercase">
          {props.label}
        </span>
        <Show when={props.onCreate && !fileExists()}>
          <button
            class="text-[10px] px-1.5 py-0.5 rounded text-(--text-3) hover:text-(--text) hover:bg-(--bg-hover) transition-colors"
            onClick={props.onCreate}
          >
            新建
          </button>
        </Show>
        <Show when={fileExists()}>
          <button
            class="text-[10px] px-1.5 py-0.5 rounded text-(--text-3) hover:text-(--accent) hover:bg-(--bg-hover) transition-colors"
            onClick={props.onOpen}
            title="在编辑器中打开"
          >
            ↗
          </button>
        </Show>
      </div>
      <div class="flex-1 overflow-y-auto min-h-0 relative">
        <Show when={content.loading}>
          <div class="px-3 py-3 text-[11px] text-(--text-4) italic">加载中…</div>
        </Show>
        <Show when={!content.loading && !fileExists()}>
          <div class="flex flex-col items-center justify-center py-8 gap-2 text-(--text-4)">
            <span class="text-[11px] italic">文件不存在</span>
            <Show when={props.onCreate}>
              <button
                class="text-[11px] px-2 py-1 rounded border border-(--border) hover:border-(--accent) hover:text-(--accent) transition-colors"
                onClick={props.onCreate}
              >
                新建 {props.path.split('/').pop()}
              </button>
            </Show>
          </div>
        </Show>
        <div ref={editorHost} />
      </div>
    </div>
  )
}

// ── WeekTaskGrid ──────────────────────────────────────────────────────────────

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function WeekTaskGrid(props: {
  weekDates: string[]
  today: string
  onTaskClick: (path: string) => void
}) {
  const taskDayData = () => buildTaskDayData(vaultStore.taskMap)

  return (
    <div class="grid grid-cols-7 gap-px bg-(--border) rounded overflow-hidden border border-(--border)">
      <For each={props.weekDates}>
        {(date, i) => {
          const isToday = () => date === props.today
          const tasks = () => taskDayData()[date] ?? []
          const dayNum = () => date.slice(8)

          return (
            <div
              class={`flex flex-col min-h-[80px] p-1.5 gap-0.5 ${
                isToday() ? 'bg-(--accent-bg)' : 'bg-(--bg-base)'
              }`}
            >
              <div
                class={`text-[9px] font-medium mb-0.5 select-none ${
                  isToday() ? 'text-(--accent)' : 'text-(--text-4)'
                }`}
              >
                {WEEKDAY_LABELS[i()]}
                <span
                  class={`ml-1 text-[10px] font-bold ${
                    isToday() ? 'text-(--accent)' : 'text-(--text-2)'
                  }`}
                >
                  {dayNum()}
                </span>
              </div>
              <For each={tasks()}>
                {(task: Task) => (
                  <button
                    class={`text-left text-[10px] leading-snug truncate px-0.5 rounded transition-colors hover:bg-(--bg-hover) ${
                      task.checked ? 'line-through text-(--text-4)' : 'text-(--text-2)'
                    }`}
                    onClick={() => props.onTaskClick(task.path)}
                    title={task.cleanText}
                  >
                    <span class="mr-0.5 text-[9px] opacity-60">
                      {task.checked ? '✓' : '○'}
                    </span>
                    {task.cleanText}
                  </button>
                )}
              </For>
            </div>
          )
        }}
      </For>
    </div>
  )
}

// ── DashboardViewer ───────────────────────────────────────────────────────────

const DAILY_DEFAULTS = { folder: 'journal', dateFormat: 'YYYY-MM-DD', autoCreate: false }
const DASHBOARD_DEFAULTS = { weeklyFolder: 'weekly', monthlyFolder: 'monthly' }

export function DashboardViewer(
  props: ViewComponentProps & {
    getConfig: <T extends Record<string, unknown>>(defaults: T) => T
  },
) {
  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)

  const weekDates = createMemo(() => getISOWeekDates(now))
  const weekLabel = createMemo(() => getISOWeekString(now))

  const dailyConfig = () => loadFromStorage('sn-plugin-daily-note', DAILY_DEFAULTS)
  const todayFilePath = createMemo(() =>
    todayPath(dailyConfig().folder as string, dailyConfig().dateFormat as string, now),
  )

  const config = () => props.getConfig(DASHBOARD_DEFAULTS)
  const weeklyPath = createMemo(() => weekFilePath(config().weeklyFolder as string, now))
  const monthlyPath = createMemo(() => monthFilePath(config().monthlyFolder as string, now))

  async function createAndOpen(path: string) {
    const created = await fileActions.createFile(path)
    if (created) workspaceActions.openFile(created)
  }

  return (
    <div class="flex flex-col h-full overflow-hidden bg-(--bg-base)">
      {/* Toolbar */}
      <div class="flex items-center gap-3 px-4 py-2 border-b border-(--border) shrink-0">
        <span class="flex-1 text-[10px] text-(--accent) font-bold tracking-widest uppercase">
          仪表盘
        </span>
        <span class="text-[11px] text-(--text-3) font-medium">{weekLabel()}</span>
        <span class="text-[11px] text-(--text-4)">{todayStr}</span>
      </div>

      {/* Week task grid */}
      <div class="px-4 py-3 border-b border-(--border) shrink-0">
        <div class="text-[9px] text-(--text-4) uppercase tracking-widest mb-2 select-none">
          本周任务
        </div>
        <WeekTaskGrid
          weekDates={weekDates()}
          today={todayStr}
          onTaskClick={(path) => workspaceActions.openFile(path)}
        />
      </div>

      {/* Today + Weekly plans — equal-width columns */}
      <div class="flex flex-1 min-h-0 border-b border-(--border) overflow-hidden">
        <div class="flex-1 border-r border-(--border) min-w-0 overflow-hidden">
          <ReadOnlyPlan
            path={todayFilePath()}
            label="今日计划"
            onOpen={() => workspaceActions.openFile(todayFilePath())}
          />
        </div>
        <div class="flex-1 min-w-0 overflow-hidden">
          <ReadOnlyPlan
            path={weeklyPath()}
            label="本周计划"
            onOpen={() => workspaceActions.openFile(weeklyPath())}
            onCreate={() => void createAndOpen(weeklyPath())}
          />
        </div>
      </div>

      {/* Monthly plan */}
      <div class="flex-1 min-h-0 overflow-hidden">
        <ReadOnlyPlan
          path={monthlyPath()}
          label="月度计划"
          onOpen={() => workspaceActions.openFile(monthlyPath())}
          onCreate={() => void createAndOpen(monthlyPath())}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/plugins/dashboard/DashboardViewer.tsx
git commit -m "feat: add DashboardViewer with ReadOnlyPlan and WeekTaskGrid components"
```

---

### Task 3: Plugin registration — index.tsx

**Files:**
- Create: `src/plugins/dashboard/index.tsx`

Depends on Task 2.

- [ ] **Step 1: Create index.tsx**

Create `src/plugins/dashboard/index.tsx`:

```tsx
import { LayoutDashboard } from 'lucide-solid'
import { definePlugin } from '../../lib/pluginRegistry'
import type { SettingsTabProps } from '../../lib/pluginRegistry'
import type { ViewComponentProps } from '../../stores/types'
import { DashboardViewer } from './DashboardViewer'

const DEFAULTS = { weeklyFolder: 'weekly', monthlyFolder: 'monthly' }

function TextRow(props: {
  label: string
  description?: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div class="flex flex-col gap-1">
      <div class="text-[13px] t-base font-medium">{props.label}</div>
      {props.description && (
        <div class="text-[11px] t-3 leading-relaxed">{props.description}</div>
      )}
      <input
        type="text"
        class="mt-1 px-2 py-1 text-[13px] rounded border border-(--border) bg-(--bg-base) text-(--text) focus:outline-none focus:border-(--accent)"
        value={props.value}
        onInput={(e) => props.onChange(e.currentTarget.value)}
      />
    </div>
  )
}

function DashboardSettings(props: SettingsTabProps) {
  const config = () => props.getConfig(DEFAULTS)
  return (
    <div class="flex flex-col gap-5">
      <TextRow
        label="周计划文件夹"
        description="存放 YYYY-Www.md 周计划文件的文件夹，留空则存于根目录"
        value={config().weeklyFolder as string}
        onChange={(v) => props.setConfig({ weeklyFolder: v })}
      />
      <TextRow
        label="月计划文件夹"
        description="存放 YYYY-MM.md 月计划文件的文件夹，留空则存于根目录"
        value={config().monthlyFolder as string}
        onChange={(v) => props.setConfig({ monthlyFolder: v })}
      />
    </div>
  )
}

export const DashboardPlugin = definePlugin({
  id: 'dashboard',
  name: '仪表盘',
  description: '周任务概览 + 今日/本周/月度计划预览',
  defaultEnabled: true,
  setup(ctx) {
    ctx.view({
      kind: 'page',
      type: 'dashboard',
      getDisplayText: () => '仪表盘',
      getIcon: () => <LayoutDashboard size={11} />,
      component: (viewProps: ViewComponentProps) => (
        <DashboardViewer
          {...viewProps}
          getConfig={(defaults) => ctx.settings.getConfig(defaults)}
        />
      ),
    })

    ctx.ribbon({
      id: 'dashboard',
      title: '仪表盘',
      getIcon: () => <LayoutDashboard size={18} />,
      onClick: () => ctx.workspace.openPage('dashboard'),
      isActive: () => {
        const id = ctx.workspace.activeLeafId()
        return id ? ctx.workspace.getLeafsByType('dashboard').includes(id) : false
      },
    })

    ctx.settings.tab({
      name: '仪表盘',
      component: DashboardSettings,
    })
  },
})
```

- [ ] **Step 2: Commit**

```bash
git add src/plugins/dashboard/index.tsx
git commit -m "feat: add DashboardPlugin registration with ribbon and settings"
```

---

### Task 4: Wire up in App.tsx

**Files:**
- Modify: `src/App.tsx` — add two lines

Depends on Task 3.

- [ ] **Step 1: Add import to App.tsx**

In `src/App.tsx`, after the existing plugin import block (after the `DailyNotePlugin` import line), add:

```tsx
import { DashboardPlugin } from './plugins/dashboard'
```

- [ ] **Step 2: Register the plugin**

In `src/App.tsx`, after `registerPlugin(DailyNotePlugin)` (before `startPlugins()`), add:

```tsx
registerPlugin(DashboardPlugin)
```

- [ ] **Step 3: Run the dev server and verify**

```bash
npm run dev
```

Open the app. Verify:
1. A grid/chart icon appears in the ribbon — clicking it opens the dashboard page.
2. The toolbar shows "仪表盘", the ISO week string (e.g. `2026-W23`), and today's date.
3. The 7-day task grid shows columns for Mon–Sun of the current week; today's column is highlighted with the accent background.
4. Tasks with `dueDate` matching this week appear in their respective columns with ✓/○ prefix.
5. "今日计划" panel shows the daily note if it exists, or "文件不存在" with no create button.
6. "本周计划" and "月度计划" panels show "新建" button + empty state when the file doesn't exist; clicking "新建" creates the file (`weekly/YYYY-Www.md` / `monthly/YYYY-MM.md`) and opens it.
7. "↗" button appears when a plan file exists and opens it in the editor.
8. Settings → 仪表盘 tab shows the two folder config inputs.
9. Changing folder config updates file paths immediately (reactive).

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: register DashboardPlugin in App"
```
