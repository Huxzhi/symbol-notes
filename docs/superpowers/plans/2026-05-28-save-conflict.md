# Save Conflict Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user presses Ctrl+S, detect if the file has been externally modified since the last scan and show a modal with Overwrite / Reload / Cancel options.

**Architecture:** Add `getFileMtime` to `fileCacheService`, create a global `modalStore` + `ConfirmModal` (parallel to existing `toastStore` / `ToastContainer`), then wire conflict detection into `EditorViewer.saveFile` which splits into `saveFile` / `doSave` / `doReload`.

**Tech Stack:** SolidJS (createStore, Show, For), File System Access API (`FileSystemFileHandle.getFile().lastModified`), Vitest, TypeScript

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/services/fileCacheService.ts` | Modify | Export `getFileMtime(path)` |
| `src/stores/modalStore.ts` | Create | Global modal open/close state |
| `src/stores/__tests__/modalStore.test.ts` | Create | Unit tests for modalStore |
| `src/components/ConfirmModal.tsx` | Create | Modal UI reading from modalStore |
| `src/App.tsx` | Modify | Register `<ConfirmModal />` |
| `src/components/viewer/EditorViewer.tsx` | Modify | Conflict check + doSave/doReload |

---

### Task 1: Add `getFileMtime` to fileCacheService

**Files:**
- Modify: `src/services/fileCacheService.ts`

`resolveFileHandle` is already defined in this file and is private — the new export calls it directly.

- [ ] **Step 1: Add the export after `writeFile`**

In `src/services/fileCacheService.ts`, insert after the `writeFile` function (after line 126):

```ts
export async function getFileMtime(path: string): Promise<number> {
  const handle = await resolveFileHandle(path)
  return (await handle.getFile()).lastModified
}
```

- [ ] **Step 2: Type-check**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/fileCacheService.ts
git commit -m "feat: export getFileMtime from fileCacheService"
```

---

### Task 2: Create `modalStore`

**Files:**
- Create: `src/stores/modalStore.ts`
- Create: `src/stores/__tests__/modalStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/stores/__tests__/modalStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { showModal, closeModal, modalStore } from '../modalStore'

beforeEach(() => closeModal())

describe('modalStore', () => {
  it('starts closed', () => {
    expect(modalStore.open).toBe(false)
  })

  it('showModal opens with correct fields', () => {
    showModal({ title: '标题', message: '消息', buttons: [] })
    expect(modalStore.open).toBe(true)
    expect(modalStore.title).toBe('标题')
    expect(modalStore.message).toBe('消息')
    expect(modalStore.buttons).toEqual([])
  })

  it('closeModal sets open to false', () => {
    showModal({ title: 'T', message: 'M', buttons: [] })
    closeModal()
    expect(modalStore.open).toBe(false)
  })

  it('showModal replaces previous modal', () => {
    showModal({ title: 'First', message: 'A', buttons: [] })
    showModal({ title: 'Second', message: 'B', buttons: [] })
    expect(modalStore.title).toBe('Second')
    expect(modalStore.open).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run src/stores/__tests__/modalStore.test.ts
```

Expected: FAIL — `Cannot find module '../modalStore'`

- [ ] **Step 3: Implement `modalStore`**

Create `src/stores/modalStore.ts`:

```ts
import { createStore } from 'solid-js/store'

export interface ModalButton {
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

const [modalStore, setModalStore] = createStore<ModalState>({
  open: false,
  title: '',
  message: '',
  buttons: [],
})

export function showModal(opts: Omit<ModalState, 'open'>): void {
  setModalStore({ ...opts, open: true })
}

export function closeModal(): void {
  setModalStore('open', false)
}

export { modalStore }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run src/stores/__tests__/modalStore.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Type-check**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/stores/modalStore.ts src/stores/__tests__/modalStore.test.ts
git commit -m "feat: add modalStore for global modal state"
```

---

### Task 3: Create `ConfirmModal` component

**Files:**
- Create: `src/components/ConfirmModal.tsx`

No unit test — this is a pure rendering component with no logic beyond reading `modalStore`.

- [ ] **Step 1: Create the component**

Create `src/components/ConfirmModal.tsx`:

```tsx
import { Show, For } from 'solid-js'
import { modalStore } from '../stores/modalStore'
import type { ModalButton } from '../stores/modalStore'

const VARIANT: Record<NonNullable<ModalButton['variant']>, string> = {
  primary: 'border-(--accent) text-(--accent) hover:bg-(--accent)/10',
  danger:  'border-[#e05252] text-[#e05252] hover:bg-[#e05252]/10',
  ghost:   'border-(--border-2) text-(--text-3) hover:text-(--text)',
}

export function ConfirmModal() {
  return (
    <Show when={modalStore.open}>
      <div
        class="fixed inset-0 z-[10000] flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.55)' }}
      >
        <div
          class="bg-(--bg-elevated) border border-(--border-2) rounded-lg shadow-xl p-5 flex flex-col gap-4"
          style={{ 'min-width': '300px', 'max-width': '440px' }}
        >
          <div class="flex flex-col gap-1">
            <h2 class="text-[15px] font-semibold text-(--text)">{modalStore.title}</h2>
            <p class="text-[13px] text-(--text-2) leading-relaxed">{modalStore.message}</p>
          </div>
          <div class="flex justify-end gap-2 flex-wrap">
            <For each={modalStore.buttons}>
              {(btn) => (
                <button
                  class={`px-3 py-1.5 text-[13px] rounded border transition-colors ${VARIANT[btn.variant ?? 'ghost']}`}
                  onClick={btn.onClick}
                >
                  {btn.label}
                </button>
              )}
            </For>
          </div>
        </div>
      </div>
    </Show>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ConfirmModal.tsx
git commit -m "feat: add ConfirmModal component"
```

---

### Task 4: Register `ConfirmModal` in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add import and render**

In `src/App.tsx`, add the import alongside `ToastContainer`:

```ts
import { ConfirmModal } from './components/ConfirmModal'
```

In the JSX return, add `<ConfirmModal />` directly after `<ToastContainer />`:

```tsx
      <ContextMenu />
      <ToastContainer />
      <ConfirmModal />
    </div>
```

- [ ] **Step 2: Type-check**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: register ConfirmModal in App"
```

---

### Task 5: Wire conflict detection in EditorViewer

**Files:**
- Modify: `src/components/viewer/EditorViewer.tsx`

Current `saveFile()` at line 150 does: get content → apply timestamps → `writeFile`. This task splits it into `saveFile` (conflict gate) + `doSave` (write path) + `doReload` (reload path).

- [ ] **Step 1: Update imports**

Replace the existing import lines at the top of `EditorViewer.tsx`:

```ts
// Before:
import { readFile, writeFile } from '../../services/fileCacheService'
import { cacheActions } from '../../stores/cacheStore'

// After:
import { readFile, writeFile, getFileMtime, invalidateFile } from '../../services/fileCacheService'
import { cacheActions, cacheStore, setCacheStore } from '../../stores/cacheStore'
import { showModal, closeModal } from '../../stores/modalStore'
```

- [ ] **Step 2: Replace `saveFile` with three functions**

Remove the existing `saveFile` function (lines 150–192) and replace with:

```ts
async function saveFile(): Promise<void> {
  const p = filePath()
  if (!view || !p) return

  const knownMtime = cacheStore.files[p]?.mtime
  if (knownMtime) {
    const currentMtime = await getFileMtime(p)
    if (currentMtime > knownMtime) {
      const filename = p.split('/').pop() ?? p
      showModal({
        title: '文件已被外部修改',
        message: `"${filename}" 在磁盘上已被其他程序修改，如何处理？`,
        buttons: [
          { label: '覆盖保存', variant: 'danger',  onClick: () => { closeModal(); void doSave(p) } },
          { label: '重新加载', variant: 'primary', onClick: () => { closeModal(); void doReload(p) } },
          { label: '取消',     variant: 'ghost',   onClick: closeModal },
        ],
      })
      return
    }
  }
  await doSave(p)
}

async function doSave(p: string): Promise<void> {
  if (!view) return
  let content = view.state.doc.toString()
  if (settingsStore.autoTimestamps) {
    const ts = formatTimestamp(Date.now())
    const withUpdated = setFrontmatterField(content, 'updated', ts)
    if (withUpdated !== content) {
      let from = 0
      while (
        from < content.length &&
        from < withUpdated.length &&
        content[from] === withUpdated[from]
      )
        from++
      let toOld = content.length
      let toNew = withUpdated.length
      while (
        toOld > from &&
        toNew > from &&
        content[toOld - 1] === withUpdated[toNew - 1]
      ) {
        toOld--
        toNew--
      }
      view.dispatch({
        changes: { from, to: toOld, insert: withUpdated.slice(from, toNew) },
        annotations: Transaction.remote.of(true),
      })
      content = withUpdated
    }
  }
  await writeFile(p, content)
  const newMtime = await getFileMtime(p)
  setCacheStore('files', p, 'mtime', newMtime)
  localDirty = false
  if (props.isActive) setLeafRuntime({ isDirty: false })
  const outLinks = view.state
    .field(outLinksField)
    .filter((l) => l.type === 'wiki')
    .map((l) => (l.target.endsWith('.md') ? l.target : `${l.target}.md`))
  const inlineTags = view.state.field(inlineTagsField).map((m) => m.tag)
  const tasks = view.state.field(tasksField)
  await cacheActions.reindexFile(p, content, { outLinks, inlineTags, tasks })
}

async function doReload(p: string): Promise<void> {
  if (!view) return
  invalidateFile(p)
  const newContent = await loadFileContent(p)
  const newState = buildEditorState(newContent, handleDocChange, handleKeyDown)
  view.setState(newState)
  view.scrollDOM.scrollTop = 0
  localDirty = false
  if (props.isActive) {
    setLeafRuntime({
      isDirty: false,
      outLinks: view.state.field(outLinksField),
      headings: view.state.field(headingsField),
    })
  }
}
```

- [ ] **Step 3: Type-check**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run all tests**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/viewer/EditorViewer.tsx
git commit -m "feat: detect external file modification before save"
```
