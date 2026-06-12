# Per-Tab Navigation Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Obsidian-style navigation bar below each main-area tab group's tab bar, with per-tab back/forward history of opened files and a breadcrumb path display.

**Architecture:** Each leaf's file history lives in the in-memory runtime store (`LeafRuntimeState`, never persisted). A pure reducer `pushHistory` manages the stack; `workspaceStore` records navigations at the open-in-place choke points and exposes `navigateBack`/`navigateForward`. A new `WorkspaceNavBar` reads the active leaf's history + path and renders controls, wired into `WorkspaceTabsView` for the main area only.

**Tech Stack:** SolidJS (`createStore`/`produce`), lucide-solid icons, Tailwind (CSS-var theme), Vitest.

**Reference spec:** `docs/superpowers/specs/2026-06-12-tab-navigation-bar-design.md`

**Commands:**
- Unit tests: `npx vitest run <file>`
- Typecheck: `npx tsc --noEmit`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/stores/leafHistory.ts` | pure history reducer | **new** |
| `src/stores/__tests__/leafHistory.test.ts` | reducer tests | **new** |
| `src/components/workspace/breadcrumb.ts` | pure path→breadcrumb splitter | **new** |
| `src/components/workspace/__tests__/breadcrumb.test.ts` | breadcrumb tests | **new** |
| `src/stores/types.ts` | `LeafRuntimeState` += optional `history`/`historyIndex` | modify |
| `src/stores/workspaceStore.ts` | `recordNav`; wire `createLeaf`/`openLeaf`/`renameLeafPath`; `navigateBack`/`navigateForward` | modify |
| `src/components/workspace/WorkspaceNavBar.tsx` | the nav bar | **new** |
| `src/components/workspace/WorkspaceTabsView.tsx` | render nav bar (main area) | modify |

---

## Task 1: `pushHistory` pure reducer

**Files:**
- Create: `src/stores/leafHistory.ts`
- Test: `src/stores/__tests__/leafHistory.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/stores/__tests__/leafHistory.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pushHistory } from '../leafHistory'

describe('pushHistory', () => {
  it('seeds an empty history with prevFile before appending', () => {
    expect(pushHistory([], -1, 'b', 'a')).toEqual({ history: ['a', 'b'], index: 1 })
  })

  it('appends to an empty history with no prevFile', () => {
    expect(pushHistory([], -1, 'a')).toEqual({ history: ['a'], index: 0 })
  })

  it('does not duplicate the current entry', () => {
    expect(pushHistory(['a'], 0, 'a')).toEqual({ history: ['a'], index: 0 })
  })

  it('appends a new entry at the end', () => {
    expect(pushHistory(['a'], 0, 'b')).toEqual({ history: ['a', 'b'], index: 1 })
  })

  it('truncates forward entries when branching from the middle', () => {
    // at index 0 of [a,b,c], opening x discards b,c
    expect(pushHistory(['a', 'b', 'c'], 0, 'x')).toEqual({ history: ['a', 'x'], index: 1 })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/stores/__tests__/leafHistory.test.ts`
Expected: FAIL — `pushHistory is not a function` / cannot find module.

- [ ] **Step 3: Implement the reducer**

Create `src/stores/leafHistory.ts`:

```ts
/**
 * 追加一次导航到 leaf 的文件历史栈。
 * - 历史为空且给了 prevFile 时，先把 prevFile 作为起点种入（让首次导航也能后退）。
 * - file 与当前项相同则不重复入栈。
 * - 否则丢弃当前位置之后的「前进」项，再追加 file。
 */
export function pushHistory(
  history: string[],
  index: number,
  file: string,
  prevFile?: string,
): { history: string[]; index: number } {
  let h = history
  let i = index
  if (h.length === 0 && prevFile != null) {
    h = [prevFile]
    i = 0
  }
  if (h[i] === file) return { history: h, index: i }
  const next = h.slice(0, i + 1)
  next.push(file)
  return { history: next, index: next.length - 1 }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/stores/__tests__/leafHistory.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stores/leafHistory.ts src/stores/__tests__/leafHistory.test.ts
git commit -m "feat(workspace): pushHistory reducer for per-tab navigation"
```

---

## Task 2: `splitBreadcrumb` pure helper

**Files:**
- Create: `src/components/workspace/breadcrumb.ts`
- Test: `src/components/workspace/__tests__/breadcrumb.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/components/workspace/__tests__/breadcrumb.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { splitBreadcrumb } from '../breadcrumb'

describe('splitBreadcrumb', () => {
  it('splits a nested path into cumulative folder segments + filename', () => {
    expect(splitBreadcrumb('journal/2026/note.md')).toEqual({
      folders: [
        { name: 'journal', path: 'journal' },
        { name: '2026', path: 'journal/2026' },
      ],
      file: 'note',
    })
  })

  it('handles a root-level file (no folders)', () => {
    expect(splitBreadcrumb('note.md')).toEqual({ folders: [], file: 'note' })
  })

  it('strips only the trailing .md', () => {
    expect(splitBreadcrumb('a.md/b.md')).toEqual({
      folders: [{ name: 'a.md', path: 'a.md' }],
      file: 'b',
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/workspace/__tests__/breadcrumb.test.ts`
Expected: FAIL — cannot find module / not a function.

- [ ] **Step 3: Implement the helper**

Create `src/components/workspace/breadcrumb.ts`:

```ts
/** 把文件路径拆成「累计路径的文件夹段」+「去掉 .md 的文件名」。 */
export function splitBreadcrumb(path: string): {
  folders: { name: string; path: string }[]
  file: string
} {
  const parts = path.split('/')
  const fileName = parts.pop() ?? ''
  const file = fileName.replace(/\.md$/, '')
  const folders: { name: string; path: string }[] = []
  let acc = ''
  for (const p of parts) {
    acc = acc ? `${acc}/${p}` : p
    folders.push({ name: p, path: acc })
  }
  return { folders, file }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/workspace/__tests__/breadcrumb.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/breadcrumb.ts src/components/workspace/__tests__/breadcrumb.test.ts
git commit -m "feat(workspace): splitBreadcrumb path helper"
```

---

## Task 3: Runtime history fields + recording + navigation actions

**Files:**
- Modify: `src/stores/types.ts`
- Modify: `src/stores/workspaceStore.ts`

- [ ] **Step 1: Add optional history fields to `LeafRuntimeState`**

In `src/stores/types.ts`, the interface (around line 131) becomes:

```ts
export interface LeafRuntimeState {
  cmView: EditorView | null
  isDirty: boolean
  outLinks: OutLink[]
  headings: Heading[]
  history?: string[]      // 内存中的文件历史（不持久化）；oldest→newest
  historyIndex?: number   // 当前在 history 中的位置；空时缺省视为 -1
}
```

- [ ] **Step 2: Add `pushHistory` import and a `recordNav` helper in `workspaceStore.ts`**

In `src/stores/workspaceStore.ts`, add to the imports near the top (after the existing `'../lib/pluginRegistry'` import on line 4):

```ts
import { pushHistory } from './leafHistory'
```

Then, immediately after the `export { leafInstances, setLeafInstances }` line (line 27), add:

```ts
// 确保某 leaf 的运行时项存在（保留编辑器写入的 cmView/isDirty 等）。
function ensureLeafInstance(s: Record<string, LeafRuntimeState>, leafId: string): LeafRuntimeState {
  if (!s[leafId]) s[leafId] = { cmView: null, isDirty: false, outLinks: [], headings: [] }
  return s[leafId]
}

// 记录一次「在该 leaf 内打开了新文件」的导航（newFile 非字符串则跳过）。
function recordNav(leafId: string, prevFile: string | undefined, newFile: unknown): void {
  if (typeof newFile !== 'string') return
  setLeafInstances(produce((s) => {
    const inst = ensureLeafInstance(s, leafId)
    const res = pushHistory(inst.history ?? [], inst.historyIndex ?? -1, newFile, prevFile)
    inst.history = res.history
    inst.historyIndex = res.index
  }))
}
```

Note: `LeafRuntimeState` is already imported in this file's type imports (it's used by the `leafInstances` store on line 26). If `npx tsc --noEmit` reports it missing from the `import type { ... }` block, add `LeafRuntimeState` there.

- [ ] **Step 3: Seed history when a leaf is created with a file**

In `createLeaf` (around lines 190-201), change the body so it seeds history. Replace:

```ts
    setLayout('activeLeafId', leafId)
    return leafId
  },
```

with:

```ts
    setLayout('activeLeafId', leafId)
    const file = viewState.state.file
    if (typeof file === 'string') {
      setLeafInstances(produce((s) => {
        const inst = ensureLeafInstance(s, leafId)
        inst.history = [file]
        inst.historyIndex = 0
      }))
    }
    return leafId
  },
```

- [ ] **Step 4: Record navigation in the `openLeaf` reuse branch**

In `openLeaf`, the active-leaf reuse branch currently reads:

```ts
        if (activeLeaf && !activeLeaf.pinned && activeLeaf.viewState.type !== 'calendar') {
          workspaceActions.setLeafViewState(activeLeafId!, viewState)
          return
        }
```

Replace with:

```ts
        if (activeLeaf && !activeLeaf.pinned && activeLeaf.viewState.type !== 'calendar') {
          const prevFile = activeLeaf.viewState.state.file as string | undefined
          workspaceActions.setLeafViewState(activeLeafId!, viewState)
          recordNav(activeLeafId!, prevFile, viewState.state.file)
          return
        }
```

- [ ] **Step 5: Remap history entries on rename**

In `renameLeafPath` (around lines 384-399), after the closing `})` of the `setRoot('main', ...)` call and before the method's closing `},`, append:

```ts
    setLeafInstances(produce((s) => {
      for (const id in s) {
        const h = s[id].history
        if (h) s[id].history = h.map((p) => (p === oldPath ? newPath : p))
      }
    }))
```

- [ ] **Step 6: Add `navigateBack` / `navigateForward` actions**

In the `workspaceActions` object, add these two methods (place them right after the `activateLeaf` method, around line 272):

```ts
  navigateBack(leafId: string): void {
    const inst = leafInstances[leafId]
    if (!inst?.history || (inst.historyIndex ?? -1) <= 0) return
    const idx = inst.historyIndex! - 1
    const file = inst.history[idx]
    setLeafInstances(leafId, 'historyIndex', idx)
    const def = getFileViewForPath(file)
    workspaceActions.setLeafViewState(leafId, { type: def?.type ?? 'markdown', state: { file } })
  },

  navigateForward(leafId: string): void {
    const inst = leafInstances[leafId]
    if (!inst?.history) return
    if ((inst.historyIndex ?? -1) >= inst.history.length - 1) return
    const idx = inst.historyIndex! + 1
    const file = inst.history[idx]
    setLeafInstances(leafId, 'historyIndex', idx)
    const def = getFileViewForPath(file)
    workspaceActions.setLeafViewState(leafId, { type: def?.type ?? 'markdown', state: { file } })
  },
```

These set the leaf's viewState **directly** (not via `openLeaf`), so the move is not re-recorded into history.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (zero errors).

- [ ] **Step 8: Commit**

```bash
git add src/stores/types.ts src/stores/workspaceStore.ts
git commit -m "feat(workspace): record per-tab file history + back/forward actions"
```

---

## Task 4: `WorkspaceNavBar` component

**Files:**
- Create: `src/components/workspace/WorkspaceNavBar.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/workspace/WorkspaceNavBar.tsx`:

```tsx
import { For, Show } from 'solid-js'
import { ChevronLeft, ChevronRight } from 'lucide-solid'
import { workspaceActions, leafInstances } from '../../stores/workspaceStore'
import { getView } from '../../lib/pluginRegistry'
import { splitBreadcrumb } from './breadcrumb'
import type { WorkspaceTabs, WorkspaceLeaf } from '../../stores/types'

export function WorkspaceNavBar(props: { node: WorkspaceTabs }) {
  const activeLeaf = (): WorkspaceLeaf | undefined =>
    props.node.children.find((l) => l.id === props.node.activeLeafId)
  const leafId = () => activeLeaf()?.id ?? ''
  const inst = () => leafInstances[leafId()]
  const index = () => inst()?.historyIndex ?? -1
  const len = () => inst()?.history?.length ?? 0
  const file = () => activeLeaf()?.viewState.state.file as string | undefined

  const canBack = () => index() > 0
  const canFwd = () => index() < len() - 1

  const pageTitle = () => {
    const def = getView(activeLeaf()?.viewState.type ?? '')
    return def && def.kind !== 'file' ? def.getDisplayText() : ''
  }

  const btn =
    'w-5 h-5 flex items-center justify-center rounded hover:bg-(--bg-hover) disabled:opacity-30 disabled:hover:bg-transparent transition-colors cursor-pointer'

  return (
    <div class="h-7 shrink-0 flex items-center gap-1 px-2 border-b border-(--border) bg-(--bg-base) text-[11px] text-(--text-3)">
      <button class={btn} disabled={!canBack()} title="后退" onClick={() => workspaceActions.navigateBack(leafId())}>
        <ChevronLeft size={14} />
      </button>
      <button class={btn} disabled={!canFwd()} title="前进" onClick={() => workspaceActions.navigateForward(leafId())}>
        <ChevronRight size={14} />
      </button>
      <div class="flex items-center gap-1 min-w-0 overflow-hidden ml-1">
        <Show when={file()} fallback={<span class="truncate text-(--text-3)">{pageTitle()}</span>}>
          {(f) => {
            const parts = () => splitBreadcrumb(f())
            return (
              <>
                <For each={parts().folders}>
                  {(seg) => (
                    <>
                      <button
                        type="button"
                        class="shrink-0 hover:text-(--text) hover:underline truncate max-w-32"
                        title={seg.path}
                      >
                        {seg.name}
                      </button>
                      <span class="shrink-0 text-(--text-4)">/</span>
                    </>
                  )}
                </For>
                <span class="truncate text-(--text-2) font-medium" title={f()}>{parts().file}</span>
              </>
            )
          }}
        </Show>
      </div>
    </div>
  )
}
```

The folder-segment `<button>` has no `onClick` — a reserved no-op for v1 (hover-styled only).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (component exported, not yet imported — fine).

- [ ] **Step 3: Commit**

```bash
git add src/components/workspace/WorkspaceNavBar.tsx
git commit -m "feat(workspace): WorkspaceNavBar back/forward + breadcrumb"
```

---

## Task 5: Wire the nav bar into `WorkspaceTabsView`

**Files:**
- Modify: `src/components/workspace/WorkspaceTabsView.tsx`

- [ ] **Step 1: Import the component**

In `src/components/workspace/WorkspaceTabsView.tsx`, add to the imports (after the `WorkspaceLeafView` import on line 8):

```tsx
import { WorkspaceNavBar } from './WorkspaceNavBar'
```

- [ ] **Step 2: Render it below the tab bar (main area only)**

The tab-bar `<div class="h-8 ...">…</div>` closes (line 220) right before `{/* Leaf area */}` (line 221). Insert the nav bar between them:

```tsx
      </div>
      {/* Per-tab navigation bar — main area only */}
      <Show when={props.area === 'main' && props.node.activeLeafId}>
        <WorkspaceNavBar node={props.node} />
      </Show>
      {/* Leaf area */}
```

(`Show` is already imported on line 2.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/workspace/WorkspaceTabsView.tsx
git commit -m "feat(workspace): show nav bar below main-area tab bar"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `npx vitest run`
Expected: PASS (all suites, including the new `pushHistory` + `splitBreadcrumb` cases).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS, zero errors.

- [ ] **Step 3: Production build**

Run: `npx vite build`
Expected: builds with no errors (the pre-existing chunk-size warning is fine).

- [ ] **Step 4: Manual smoke test (`npx vite`)**

In the main editor area:
1. Open file A, then click a link to file B in the same tab → the nav bar path updates to B; **‹ back** becomes enabled.
2. Click **‹ back** → returns to A; **› forward** becomes enabled; click **› forward** → back to B.
3. From A (after going back), open a different file C → the forward entry (B) is discarded (truncate).
4. Open a second tab on file X; navigate X→Y. Switch between the two tabs → each tab's nav bar shows its **own** history and enabled/disabled arrows.
5. Breadcrumb shows folder segments + filename; hovering a folder segment highlights it (clicking does nothing — reserved).
6. Activate the calendar page tab → nav bar shows "日历" with both arrows disabled.
7. Confirm no nav bar appears in the left/right sidebars.

- [ ] **Step 5: Final commit (only if manual fixes were needed)**

```bash
git add -A
git commit -m "fix(workspace): nav bar manual-test adjustments"
```

(Skip if Steps 1-4 needed no changes.)

---

## Self-Review Notes

- **Spec coverage:** runtime fields → Task 3 §1; pure reducer → Task 1; recording (createLeaf/openLeaf/rename) → Task 3 §3-5; back/forward → Task 3 §6; breadcrumb helper → Task 2; nav bar component → Task 4; main-area wiring → Task 5; tests → Tasks 1,2,6. All spec sections mapped.
- **Type consistency:** `pushHistory(history, index, file, prevFile?) → { history, index }` identical across Task 1 and its use in Task 3 §2; `splitBreadcrumb(path) → { folders: {name,path}[], file }` identical across Task 2 and Task 4; `history?`/`historyIndex?` optional fields read with `?? []`/`?? -1` everywhere (Tasks 3, 4).
- **No placeholders:** every code step is complete; folder no-op is intentional and documented.
