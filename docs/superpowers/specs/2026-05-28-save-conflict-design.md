# Save Conflict Detection Design

**Date:** 2026-05-28
**Status:** Approved

## Overview

When the user presses Ctrl+S to save a file, check whether the on-disk file has been externally modified since the last scan. If so, show a modal prompt with three options: overwrite, reload, or cancel.

## Architecture

Four touch points, minimal surface area:

1. **`fileCacheService.ts`** — new `getFileMtime(path)` export
2. **`src/stores/modalStore.ts`** — new global modal store
3. **`src/components/ConfirmModal.tsx`** — new global modal component
4. **`src/components/viewer/EditorViewer.tsx`** — conflict check in `saveFile()`

## fileCacheService Changes

Add one export. No new state.

```ts
export async function getFileMtime(path: string): Promise<number> {
  const handle = await resolveFileHandle(path)
  return (await handle.getFile()).lastModified
}
```

`writeFile` is unchanged. The caller (`saveFile`) updates `cacheStore.files[path].mtime` after a successful write.

## modalStore

New file `src/stores/modalStore.ts`, symmetric with `toastStore`:

```ts
interface ModalButton {
  label: string
  variant?: 'primary' | 'danger' | 'ghost'
  onClick: () => void
}

interface ModalState {
  open: boolean
  title: string
  message: string
  buttons: ModalButton[]
}

export function showModal(opts: Omit<ModalState, 'open'>): void
export function closeModal(): void
export { modalStore }
```

## ConfirmModal Component

New file `src/components/ConfirmModal.tsx`. Reads from `modalStore`. Renders when `modalStore.open` is true.

Layout: full-screen semi-transparent overlay (z-index > 9999) + centered card using existing CSS variables (`--bg-elevated`, `--border-2`, `--text`, `--accent`).

Button variants:
- `danger` — red border/text (destructive action)
- `primary` — accent color
- `ghost` — plain text

Registered in `App.tsx` alongside `<ToastContainer />`.

## EditorViewer Changes

`saveFile()` is split into three functions:

### saveFile() — entry point
```
1. Get knownMtime = cacheStore.files[p]?.mtime
2. If knownMtime > 0:
   a. currentMtime = await getFileMtime(p)
   b. If currentMtime > knownMtime → showModal(...) and return
3. await doSave(p)
```

### doSave(p) — write and update baseline
```
1. Apply autoTimestamps logic (unchanged)
2. await writeFile(p, content)
3. newMtime = await getFileMtime(p)
4. setCacheStore('files', p, 'mtime', newMtime)   ← update baseline
5. localDirty = false, setLeafRuntime({ isDirty: false })
6. await cacheActions.reindexFile(...)
```

### doReload(p) — discard editor changes, load disk version
```
1. invalidateFile(p)          ← clear contentCache
2. newContent = await loadFileContent(p)
3. view.setState(buildEditorState(newContent, ...))
4. view.scrollDOM.scrollTop = 0
5. localDirty = false, setLeafRuntime({ isDirty: false, outLinks, headings })
```

### Modal prompt (conflict case)
```
title:   "文件已被外部修改"
message: `"${filename}" 在磁盘上已被其他程序修改，如何处理？`
buttons:
  - 覆盖保存  (danger)  → closeModal + doSave(p)
  - 重新加载  (primary) → closeModal + doReload(p)
  - 取消      (ghost)   → closeModal
```

## Conflict Baseline: Why cacheStore.files[path].mtime

`cacheStore.files[path].mtime` is set from `file.lastModified` during `indexService.buildScan()`. It represents the file's state at last scan, which is also the baseline for what the editor loaded. After each successful save, `doSave` updates this field so the next save has the correct baseline.

Edge case: if `mtime === 0` (directory entries, newly created files before first scan), conflict check is skipped.

## Files Changed

| File | Change |
|------|--------|
| `src/services/fileCacheService.ts` | Add `getFileMtime` export |
| `src/stores/modalStore.ts` | New file |
| `src/components/ConfirmModal.tsx` | New file |
| `src/App.tsx` | Register `<ConfirmModal />` |
| `src/components/viewer/EditorViewer.tsx` | Split `saveFile` into `saveFile`/`doSave`/`doReload`, add conflict check |
