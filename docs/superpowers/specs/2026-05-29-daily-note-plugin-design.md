# Daily Note Plugin Design

**Date:** 2026-05-29  
**Status:** Approved

## Overview

A `DailyNotePlugin` that adds a ribbon button to open (or create) today's markdown journal file. Settings allow configuring the storage folder, date format, and whether to prompt before creating a new file.

## Plugin File

`src/plugins/daily-note/index.tsx` — single file, settings component inline, no external date library.

## Settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `folder` | string | `"journal"` | Subdirectory relative to vault root. Empty string = vault root. |
| `dateFormat` | string | `"YYYY-MM-DD"` | Filename date pattern. Supported tokens: `YYYY`, `MM`, `DD`. |
| `autoCreate` | boolean | `false` | `false` = show confirm modal before creating; `true` = create silently. |

## Ribbon Button Behavior

```
onClick
├── build today's path:  folder + "/" + formatDate(today, dateFormat) + ".md"
│   (if folder is empty: just formatDate(today, dateFormat) + ".md")
├── cacheStore.files[path] exists?
│   └── yes → ctx.workspace.openFile(path)
└── no (file does not exist)
    ├── autoCreate = true  → fileActions.createFile(path) → ctx.workspace.openFile(path)
    └── autoCreate = false → modalStore.confirm("创建今日日记？")
        ├── confirmed → fileActions.createFile(path) → ctx.workspace.openFile(path)
        └── cancelled → no-op
```

`isActive` on the ribbon: returns `true` when the active leaf's file path equals today's computed path.

## Date Formatting

No external library. Pure string replacement:

```ts
function formatDate(date: Date, fmt: string): string {
  const y = date.getFullYear().toString()
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  const d = date.getDate().toString().padStart(2, '0')
  return fmt.replace('YYYY', y).replace('MM', m).replace('DD', d)
}
```

## Settings UI

Two text inputs (folder, dateFormat) and one toggle (autoCreate), using the same ToggleRow pattern as CalendarPlugin.

```
┌──────────────────────────────────────┐
│ 日记文件夹                            │
│ [journal                           ] │
│ 相对 vault 根目录，留空则存于根目录     │
│                                      │
│ 日期格式                              │
│ [YYYY-MM-DD                        ] │
│ 支持 YYYY、MM、DD                     │
│                                      │
│ 自动创建（不弹确认框）  [toggle]       │
└──────────────────────────────────────┘
```

## API Usage

- `ctx.workspace.openFile(path)` — open the daily note (existing or newly created)
- `ctx.workspace.activeFilePath()` — used in ribbon `isActive` check
- `ctx.settings.getConfig / setConfig` — persist folder, dateFormat, autoCreate
- `cacheStore.files[path]` — check if today's file already exists
- `fileActions.createFile(path)` — create the file (imported directly, not via ctx)
- `modalStore.confirm(message)` — prompt before creating when autoCreate = false

## Notes

- `fileActions.createFile` adds `.md` suffix if absent — pass the path **without** `.md` to avoid double extension, or pass with `.md` and rely on the function's suffix check (it only appends if not already present).
- The plugin is `defaultEnabled: true`, not `core: true` (it can be disabled by the user).
