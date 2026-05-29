# Daily Note Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `DailyNotePlugin` with a ribbon button that opens (or creates) today's markdown journal file, with configurable folder, date format, and auto-create behavior.

**Architecture:** A single plugin file at `src/plugins/daily-note/index.tsx` registers a ribbon item and a settings tab via `PluginContext`. Date path logic lives in a sibling `formatDate.ts` so it can be unit-tested independently of the SolidJS plugin.

**Tech Stack:** SolidJS, TypeScript, Vitest, existing `modalStore` / `fileActions` / `cacheStore`

---

## File Map

| Status | Path | Responsibility |
|--------|------|----------------|
| Create | `src/plugins/daily-note/formatDate.ts` | Pure `formatDate` and `todayPath` helpers |
| Create | `src/plugins/daily-note/__tests__/formatDate.test.ts` | Unit tests for date helpers |
| Create | `src/plugins/daily-note/index.tsx` | Plugin definition, settings UI, ribbon logic |
| Modify | `src/App.tsx` | Register `DailyNotePlugin` |

---

## Task 1: `formatDate` and `todayPath` utilities

**Files:**
- Create: `src/plugins/daily-note/formatDate.ts`
- Create: `src/plugins/daily-note/__tests__/formatDate.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/plugins/daily-note/__tests__/formatDate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatDate, todayPath } from '../formatDate'

describe('formatDate', () => {
  it('formats YYYY-MM-DD', () => {
    expect(formatDate(new Date(2026, 4, 29), 'YYYY-MM-DD')).toBe('2026-05-29')
  })
  it('formats YYYY/MM/DD', () => {
    expect(formatDate(new Date(2026, 4, 29), 'YYYY/MM/DD')).toBe('2026/05/29')
  })
  it('pads single-digit month and day', () => {
    expect(formatDate(new Date(2026, 0, 5), 'YYYY-MM-DD')).toBe('2026-01-05')
  })
  it('handles format without separators', () => {
    expect(formatDate(new Date(2026, 4, 29), 'YYYYMMDD')).toBe('20260529')
  })
})

describe('todayPath', () => {
  it('prepends folder when provided', () => {
    expect(todayPath('journal', 'YYYY-MM-DD', new Date(2026, 4, 29))).toBe('journal/2026-05-29.md')
  })
  it('uses vault root when folder is empty', () => {
    expect(todayPath('', 'YYYY-MM-DD', new Date(2026, 4, 29))).toBe('2026-05-29.md')
  })
  it('uses today when no date argument given', () => {
    const result = todayPath('journal', 'YYYY-MM-DD')
    expect(result).toMatch(/^journal\/\d{4}-\d{2}-\d{2}\.md$/)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/plugins/daily-note/__tests__/formatDate.test.ts
```

Expected: FAIL — `formatDate` not found.

- [ ] **Step 3: Implement the helpers**

Create `src/plugins/daily-note/formatDate.ts`:

```ts
export function formatDate(date: Date, fmt: string): string {
  const y = date.getFullYear().toString()
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  const d = date.getDate().toString().padStart(2, '0')
  return fmt.replace('YYYY', y).replace('MM', m).replace('DD', d)
}

export function todayPath(folder: string, dateFormat: string, date = new Date()): string {
  const name = formatDate(date, dateFormat) + '.md'
  return folder ? `${folder}/${name}` : name
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/plugins/daily-note/__tests__/formatDate.test.ts
```

Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/daily-note/
git commit -m "feat: add formatDate and todayPath helpers for daily note plugin"
```

---

## Task 2: DailyNotePlugin

**Files:**
- Create: `src/plugins/daily-note/index.tsx`

The plugin uses:
- `showModal` / `closeModal` from `../../stores/modalStore` — confirm dialog when `autoCreate` is false
- `fileActions.createFile` from `../../stores/runtimeStore` — creates the file, returns the actual path
- `cacheStore` from `../../stores/cacheStore` — checks if today's file already exists
- `ctx.workspace.openFile` — opens the file after creating or when it already exists
- `ctx.workspace.activeFilePath` — used in ribbon `isActive`
- `ctx.settings.getConfig / setConfig` — persists folder, dateFormat, autoCreate

- [ ] **Step 1: Create the plugin file**

Create `src/plugins/daily-note/index.tsx`:

```tsx
import { BookOpen } from 'lucide-solid'
import { definePlugin } from '../../lib/pluginRegistry'
import { fileActions } from '../../stores/runtimeStore'
import { cacheStore } from '../../stores/cacheStore'
import { showModal, closeModal } from '../../stores/modalStore'
import { formatDate, todayPath } from './formatDate'
import type { SettingsTabProps } from '../../lib/settingsTabRegistry'

const DEFAULTS = { folder: 'journal', dateFormat: 'YYYY-MM-DD', autoCreate: false }

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

function ToggleRow(props: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label class="flex items-start gap-3 cursor-pointer select-none">
      <div class="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          class="sr-only"
          checked={props.checked}
          onChange={(e) => props.onChange(e.currentTarget.checked)}
        />
        <div class={`w-9 h-5 rounded-full transition-colors ${props.checked ? 'bg-(--accent)' : 'bg-(--bg-active)'}`} />
        <div class={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${props.checked ? 'translate-x-4' : ''}`} />
      </div>
      <div>
        <div class="text-[13px] t-base font-medium">{props.label}</div>
        {props.description && (
          <div class="text-[11px] t-3 mt-0.5 leading-relaxed">{props.description}</div>
        )}
      </div>
    </label>
  )
}

function DailyNoteSettings(props: SettingsTabProps) {
  const config = () => props.getConfig(DEFAULTS)
  return (
    <div class="flex flex-col gap-5">
      <TextRow
        label="日记文件夹"
        description="相对 vault 根目录，留空则存于根目录"
        value={config().folder as string}
        onChange={(v) => props.setConfig({ folder: v })}
      />
      <TextRow
        label="日期格式"
        description="支持 YYYY、MM、DD（例：YYYY-MM-DD）"
        value={config().dateFormat as string}
        onChange={(v) => props.setConfig({ dateFormat: v })}
      />
      <ToggleRow
        label="自动创建（不弹确认框）"
        description="开启后点击按钮直接创建今日日记，不询问"
        checked={config().autoCreate as boolean}
        onChange={(v) => props.setConfig({ autoCreate: v })}
      />
    </div>
  )
}

export const DailyNotePlugin = definePlugin({
  id: 'daily-note',
  name: '今日日记',
  description: '快速打开或新建今天的日记文件',
  defaultEnabled: true,
  setup(ctx) {
    async function openToday() {
      const { folder, dateFormat, autoCreate } = ctx.settings.getConfig(DEFAULTS)
      const path = todayPath(folder as string, dateFormat as string)

      if (cacheStore.files[path]) {
        ctx.workspace.openFile(path)
        return
      }

      if (autoCreate) {
        const created = await fileActions.createFile(path)
        if (created) ctx.workspace.openFile(created)
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
              void fileActions.createFile(path).then((created) => {
                if (created) ctx.workspace.openFile(created)
              })
            },
          },
        ],
      })
    }

    ctx.ribbon({
      id: 'daily-note',
      title: '今日日记',
      getIcon: () => <BookOpen size={18} />,
      onClick: () => void openToday(),
      isActive: () => {
        const { folder, dateFormat } = ctx.settings.getConfig(DEFAULTS)
        const path = todayPath(folder as string, dateFormat as string)
        return ctx.workspace.activeFilePath() === path
      },
    })

    ctx.settings.tab({
      name: '今日日记',
      component: DailyNoteSettings,
    })
  },
})
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/plugins/daily-note/index.tsx
git commit -m "feat: DailyNotePlugin - ribbon, settings tab, create/open today's note"
```

---

## Task 3: Register plugin in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add import and registerPlugin call**

In `src/App.tsx`, add the import after the existing plugin imports:

```tsx
import { DailyNotePlugin } from './plugins/daily-note'
```

And add the registration before `startPlugins()`:

```tsx
registerPlugin(DailyNotePlugin)
```

The full plugin registration block after the change:

```tsx
registerPlugin(FilesPlugin)
registerPlugin(EditorPlugin)
registerPlugin(LinksPlugin)
registerPlugin(OutlinePlugin)
registerPlugin(TagsPlugin)
registerPlugin(SearchPlugin)
registerPlugin(AppPlugin)
registerPlugin(CalendarPlugin)
registerPlugin(DailyNotePlugin)
startPlugins()
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass (at least 41 — 34 previous + 7 new formatDate tests).

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: register DailyNotePlugin in App"
```

---

## Task 4: Manual smoke test

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Open vault and test ribbon button**

1. Open the app and select a vault folder.
2. A `BookOpen` icon should appear in the ribbon.
3. Click it — a confirm modal appears: "创建 journal/YYYY-MM-DD.md？"
4. Click "创建" — the file is created and opens in the main editor.
5. Click the ribbon button again — the file opens directly (no modal).
6. The ribbon icon should be highlighted (active) while the daily note is the active tab.

- [ ] **Step 3: Test auto-create setting**

1. Open Settings → 今日日记 tab.
2. Verify folder, date format inputs and toggle are visible.
3. Enable "自动创建".
4. Delete today's file from the file tree.
5. Click the ribbon button — file should be created with no modal.

- [ ] **Step 4: Test custom folder and date format**

1. In settings, change folder to `diary` and format to `YYYY/MM/DD`.
2. Click the ribbon button — confirm modal should show `diary/2026/05/29.md` (today's date).
3. Confirm — file should be created under the `diary/` folder.
