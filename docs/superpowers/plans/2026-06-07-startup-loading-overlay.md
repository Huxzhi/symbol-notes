# 启动加载进度遮罩 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** vault 加载（启动恢复 + 手动打开）期间显示全屏阻塞遮罩，含不确定进度条与"检测到的文件数 / 已解析文件数"两个计数，每 0.5s 刷新，加载 < 300ms 则不显示。

**Architecture:** 新增 `src/vault/loadProgress.ts` 用裸计数器 + Solid 信号 + 300ms 延迟显示 + 500ms 采样定时器管理进度状态；`buildScan`/`runPhase1` 加进度回调；`scanAndIndex` 连线 begin/end 并补 try/finally；新增 `LoadingOverlay` 组件挂到 `App`。

**Tech Stack:** SolidJS、Vitest（`vi.useFakeTimers`）、TypeScript、Tailwind。

**测试约定：** `npx vitest run <path>`；类型检查 `npx tsc --noEmit`。

---

## 文件结构

新增：
- `src/vault/loadProgress.ts` — 进度状态模块（裸计数器、信号、定时器、session 守卫）
- `src/vault/__tests__/loadProgress.test.ts` — 单测
- `src/components/LoadingOverlay.tsx` — 全屏遮罩组件

修改：
- `src/vault/scan.ts` — `buildScan` 加 `onDetected`、`runPhase1` 加 `onParsed`
- `src/vault/index.ts` — `scanAndIndex` 连线 begin/end + try/finally
- `src/App.tsx` — 挂载 `<LoadingOverlay />`

---

## Task 1: loadProgress 进度状态模块

**Files:**
- Create: `src/vault/loadProgress.ts`
- Create: `src/vault/__tests__/loadProgress.test.ts`

- [ ] **Step 1: 写失败测试**

Create `src/vault/__tests__/loadProgress.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  loadProgress,
  beginLoadProgress,
  endLoadProgress,
  setLoadPhase,
  incDetected,
  incParsed,
} from '../loadProgress'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('loadProgress', () => {
  it('starts hidden in scanning phase', () => {
    const s = {}
    beginLoadProgress(s)
    expect(loadProgress().visible).toBe(false)
    expect(loadProgress().phase).toBe('scanning')
    endLoadProgress(s)
  })

  it('becomes visible after 300ms', () => {
    const s = {}
    beginLoadProgress(s)
    vi.advanceTimersByTime(299)
    expect(loadProgress().visible).toBe(false)
    vi.advanceTimersByTime(1)
    expect(loadProgress().visible).toBe(true)
    endLoadProgress(s)
  })

  it('never shows when ended before the 300ms delay', () => {
    const s = {}
    beginLoadProgress(s)
    vi.advanceTimersByTime(100)
    endLoadProgress(s)
    vi.advanceTimersByTime(1000)
    expect(loadProgress().visible).toBe(false)
  })

  it('samples raw counters into the snapshot every 500ms', () => {
    const s = {}
    beginLoadProgress(s)
    incDetected()
    incDetected()
    incParsed()
    expect(loadProgress().detected).toBe(0) // not yet sampled
    vi.advanceTimersByTime(500)
    expect(loadProgress().detected).toBe(2)
    expect(loadProgress().parsed).toBe(1)
    endLoadProgress(s)
  })

  it('does a final sample and hides on end', () => {
    const s = {}
    beginLoadProgress(s)
    incDetected()
    endLoadProgress(s)
    expect(loadProgress().detected).toBe(1)
    expect(loadProgress().visible).toBe(false)
    expect(loadProgress().phase).toBe('done')
  })

  it('updates phase only for the current session', () => {
    const s1 = {}
    beginLoadProgress(s1)
    setLoadPhase(s1, 'parsing')
    expect(loadProgress().phase).toBe('parsing')
    endLoadProgress(s1)
  })

  it('ignores end / phase from a superseded session', () => {
    const s1 = {}
    const s2 = {}
    beginLoadProgress(s1)
    beginLoadProgress(s2) // s2 now current
    vi.advanceTimersByTime(300)
    expect(loadProgress().visible).toBe(true)
    endLoadProgress(s1) // stale → ignored
    expect(loadProgress().visible).toBe(true)
    setLoadPhase(s1, 'done') // stale → ignored
    expect(loadProgress().phase).toBe('scanning')
    endLoadProgress(s2)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/vault/__tests__/loadProgress.test.ts`
Expected: FAIL（Cannot find module '../loadProgress'）

- [ ] **Step 3: 实现**

Create `src/vault/loadProgress.ts`:

```ts
import { createSignal } from 'solid-js'

export type LoadPhase = 'idle' | 'scanning' | 'parsing' | 'done'

export interface LoadSnapshot {
  visible: boolean
  phase: LoadPhase
  detected: number
  parsed: number
}

const SHOW_DELAY_MS = 300
const SAMPLE_MS = 500

let detectedRaw = 0
let parsedRaw = 0
let currentSession: object | null = null
let showTimer: ReturnType<typeof setTimeout> | null = null
let sampleTimer: ReturnType<typeof setInterval> | null = null

const [snapshot, setSnapshot] = createSignal<LoadSnapshot>({
  visible: false,
  phase: 'idle',
  detected: 0,
  parsed: 0,
})

/** Reactive accessor for the current load progress snapshot. */
export const loadProgress = snapshot

export function incDetected(): void {
  detectedRaw++
}

export function incParsed(): void {
  parsedRaw++
}

function sample(): void {
  setSnapshot((s) => ({ ...s, detected: detectedRaw, parsed: parsedRaw }))
}

function clearTimers(): void {
  if (showTimer !== null) {
    clearTimeout(showTimer)
    showTimer = null
  }
  if (sampleTimer !== null) {
    clearInterval(sampleTimer)
    sampleTimer = null
  }
}

export function beginLoadProgress(session: object): void {
  currentSession = session
  detectedRaw = 0
  parsedRaw = 0
  clearTimers()
  setSnapshot({ visible: false, phase: 'scanning', detected: 0, parsed: 0 })
  showTimer = setTimeout(() => {
    if (currentSession !== session) return
    setSnapshot((s) => ({ ...s, visible: true }))
  }, SHOW_DELAY_MS)
  sampleTimer = setInterval(sample, SAMPLE_MS)
}

export function setLoadPhase(session: object, phase: LoadPhase): void {
  if (currentSession !== session) return
  setSnapshot((s) => ({ ...s, phase }))
}

export function endLoadProgress(session: object): void {
  if (currentSession !== session) return
  clearTimers()
  setSnapshot({
    visible: false,
    phase: 'done',
    detected: detectedRaw,
    parsed: parsedRaw,
  })
  currentSession = null
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/vault/__tests__/loadProgress.test.ts`
Expected: PASS（7 个用例）

- [ ] **Step 5: Commit**

```bash
git add src/vault/loadProgress.ts src/vault/__tests__/loadProgress.test.ts
git commit -m "feat(vault): add load progress state module"
```

---

## Task 2: scan.ts 进度回调

给 `buildScan` 和 `runPhase1` 加可选回调，每检测/解析一个文件触发一次。回调可选 → 不影响现有调用与测试。

**Files:**
- Modify: `src/vault/scan.ts`（`buildScan` 约 `:88`、`runPhase1` 约 `:128`）

- [ ] **Step 1: buildScan 加 onDetected**

In `src/vault/scan.ts`, change the `buildScan` signature and increment per file. Replace:

```ts
export async function buildScan(): Promise<ScanResult> {
  const result: ScanResult = { files: {}, activePaths: new Set() }
  const epoch = new Date(0).toISOString().slice(0, 10)
  for await (const entry of listAll()) {
    const { name, path, kind, parent, size, mtime } = entry
```

with:

```ts
export async function buildScan(
  onDetected?: () => void,
): Promise<ScanResult> {
  const result: ScanResult = { files: {}, activePaths: new Set() }
  const epoch = new Date(0).toISOString().slice(0, 10)
  for await (const entry of listAll()) {
    const { name, path, kind, parent, size, mtime } = entry
```

Then, in the same loop, find the file branch where `result.activePaths.add(path)` is the last line before the closing brace of the `else`:

```ts
      result.activePaths.add(path)
    }
  }
  return result
}
```

replace it with:

```ts
      result.activePaths.add(path)
      onDetected?.()
    }
  }
  return result
}
```

- [ ] **Step 2: runPhase1 加 onParsed**

In `src/vault/scan.ts`, change the `runPhase1` signature. Replace:

```ts
export async function runPhase1(
  session: { cancelled: boolean },
  unchanged: string[],
  changed: string[],
  activeHashes: Set<string>,
): Promise<void> {
```

with:

```ts
export async function runPhase1(
  session: { cancelled: boolean },
  unchanged: string[],
  changed: string[],
  activeHashes: Set<string>,
  onParsed?: () => void,
): Promise<void> {
```

- [ ] **Step 3: 在 unchanged 命中缓存处计数**

In the unchanged loop, replace:

```ts
    const meta = metas[i]
    if (meta) {
      setVaultStore('files', path, (f: FileMeta) => ({ ...f, hash, ...meta }))
    } else {
      changed.push(path)
    }
```

with:

```ts
    const meta = metas[i]
    if (meta) {
      setVaultStore('files', path, (f: FileMeta) => ({ ...f, hash, ...meta }))
      onParsed?.()
    } else {
      changed.push(path)
    }
```

- [ ] **Step 4: 在 changed 循环每文件计数（一次）**

In the changed loop, the body currently uses `if (cachedMeta) { ...; continue }` then falls through to parse, wrapped in `try { ... } catch { ... }`. Replace the cached-meta early-continue and rely on a `finally` so each processed path counts exactly once. Replace:

```ts
      const cachedMeta = await getCachedMeta(hash)
      if (cachedMeta) {
        setVaultStore('files', path, (f: FileMeta) => ({
          ...f,
          hash,
          ...cachedMeta,
        }))
        continue
      }
      const { frontmatter } = parseFrontmatter(content)
```

with:

```ts
      const cachedMeta = await getCachedMeta(hash)
      if (cachedMeta) {
        setVaultStore('files', path, (f: FileMeta) => ({
          ...f,
          hash,
          ...cachedMeta,
        }))
      } else {
      const { frontmatter } = parseFrontmatter(content)
```

Then find the end of the parse block (the `setVaultStore` after `setCachedMeta`) followed by the `catch`:

```ts
      await setCachedMeta(hash, parsed)
      setVaultStore('files', path, (f: FileMeta) => ({ ...f, hash, ...parsed }))
    } catch {
      /* individual file errors are non-fatal */
    }
  }
}
```

replace it with (close the new `else`, add `finally` calling `onParsed`):

```ts
      await setCachedMeta(hash, parsed)
      setVaultStore('files', path, (f: FileMeta) => ({ ...f, hash, ...parsed }))
      }
    } catch {
      /* individual file errors are non-fatal */
    } finally {
      onParsed?.()
    }
  }
}
```

- [ ] **Step 5: 类型检查 + 既有测试无回归**

Run: `npx tsc --noEmit`
Expected: 无新增错误

Run: `npx vitest run src/vault/__tests__/scan.test.ts`
Expected: PASS（既有 scan 测试不回归）

- [ ] **Step 6: Commit**

```bash
git add src/vault/scan.ts
git commit -m "feat(vault): add progress callbacks to buildScan and runPhase1"
```

---

## Task 3: scanAndIndex 连线 begin/end + try/finally

**Files:**
- Modify: `src/vault/index.ts`（`scanAndIndex` 约 `:111-159`）

- [ ] **Step 1: import 进度模块**

In `src/vault/index.ts`, add an import near the other local imports (top of file, with the other `./` imports):

```ts
import {
  beginLoadProgress,
  endLoadProgress,
  setLoadPhase,
  incDetected,
  incParsed,
} from './loadProgress'
```

- [ ] **Step 2: 替换 scanAndIndex 主体**

Replace the entire `scanAndIndex` function body (from `export async function scanAndIndex` through its closing brace) with:

```ts
export async function scanAndIndex(): Promise<void> {
  if (currentSession) currentSession.cancelled = true
  const session: Session = { cancelled: false }
  currentSession = session

  if (!isReady()) return
  setIsIndexing(true)
  beginLoadProgress(session)

  try {
    const [{ files, activePaths }, idbStats] = await Promise.all([
      buildScan(incDetected),
      loadAllFileStats(),
    ])

    if (session.cancelled) return

    const MAX_PARSE_BYTES = 20 * 1024 * 1024
    const mdUnchanged: string[] = []
    const mdChanged: string[] = []

    for (const [path, file] of Object.entries(files)) {
      if (file.kind !== 'file' || !path.endsWith('.md')) continue
      if (file.size > MAX_PARSE_BYTES) continue
      const stat = idbStats.get(path)
      if (stat && stat.size === file.size && stat.mtime === file.mtime) {
        files[path] = { ...file, hash: stat.hash }
        mdUnchanged.push(path)
      } else {
        mdChanged.push(path)
      }
    }

    setVaultStore('files', files)
    setLoadPhase(session, 'parsing')

    const activeHashes = new Set<string>()
    await runPhase1(session, mdUnchanged, mdChanged, activeHashes, incParsed)

    if (!session.cancelled) {
      const mdFiles = Object.fromEntries(
        Object.entries(vaultStore.files).filter(([p]) => p.endsWith('.md')),
      )
      buildBacklinks(mdFiles)
      buildTags(mdFiles)
      buildTasks(mdFiles)
      pruneFileStatCache(activePaths).catch(() => {})
      pruneCache(activeHashes).catch(() => {})
    }
  } finally {
    if (currentSession === session) {
      setIsIndexing(false)
      endLoadProgress(session)
    }
  }
}
```

- [ ] **Step 3: 类型检查 + 测试无回归**

Run: `npx tsc --noEmit`
Expected: 无新增错误

Run: `npx vitest run`
Expected: PASS（全量；含新 loadProgress 测试与既有测试）

- [ ] **Step 4: Commit**

```bash
git add src/vault/index.ts
git commit -m "feat(vault): wire load progress into scanAndIndex with try/finally"
```

---

## Task 4: LoadingOverlay 组件

**Files:**
- Create: `src/components/LoadingOverlay.tsx`

- [ ] **Step 1: 创建组件**

Create `src/components/LoadingOverlay.tsx`:

```tsx
import { Show } from 'solid-js'
import { loadProgress } from '../vault/loadProgress'

export function LoadingOverlay() {
  const p = loadProgress
  return (
    <Show when={p().visible}>
      <div
        class="fixed inset-0 z-[10001] flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.6)' }}
      >
        <div
          class="bg-(--bg-elevated) border border-(--border-2) rounded-lg shadow-xl px-6 py-5 flex flex-col gap-3"
          style={{ 'min-width': '300px' }}
        >
          <div class="text-[14px] font-semibold text-(--text)">
            正在加载笔记库…
          </div>
          <div class="text-[12px] text-(--text-3)">
            {p().phase === 'parsing' ? '解析文件中…' : '检测文件中…'}
          </div>
          <div class="relative h-1.5 w-full overflow-hidden rounded-full bg-(--bg-active)">
            <div class="loading-overlay-bar absolute inset-y-0 w-1/3 rounded-full bg-(--accent)" />
          </div>
          <div class="flex flex-col gap-1 text-[12px] text-(--text-2)">
            <span>检测到 {p().detected} 个文件</span>
            <span>已解析 {p().parsed} 个文件</span>
          </div>
        </div>
      </div>
    </Show>
  )
}
```

- [ ] **Step 2: 加滚动动画样式**

The indeterminate bar needs a keyframe animation. Append to `src/index.css`:

```css
@keyframes loading-overlay-slide {
  0% {
    left: -33%;
  }
  100% {
    left: 100%;
  }
}
.loading-overlay-bar {
  animation: loading-overlay-slide 1.1s ease-in-out infinite;
}
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 4: Commit**

```bash
git add src/components/LoadingOverlay.tsx src/index.css
git commit -m "feat(ui): add LoadingOverlay component"
```

---

## Task 5: 挂载到 App

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: import**

In `src/App.tsx`, add near the other component imports (e.g. after the `ConflictModal` / `ContextMenu` import lines):

```ts
import { LoadingOverlay } from './components/LoadingOverlay'
```

- [ ] **Step 2: 渲染遮罩**

In `src/App.tsx`, add `<LoadingOverlay />` as the last child before the closing `</div>` of the root, after `<TemplatePicker />`:

```tsx
      <TemplatePicker />
      <LoadingOverlay />
    </div>
```

- [ ] **Step 3: 类型检查 + 构建**

Run: `npx tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 4: 手动验证**

Run: `npm run dev`，打开一个较大的 vault（或手动 Files 面板选文件夹）：
1. 加载时出现居中遮罩，背景变暗，无法点击操作。
2. 进度条左右滚动；"检测到 N 个文件"在扫描阶段递增；进入解析阶段文字变"解析文件中…"，"已解析 M 个文件"递增。
3. 数字大约每 0.5s 跳一次（不是每文件刷新）。
4. 加载完成遮罩消失。
5. 极小库（或刷新后全缓存命中、<300ms）→ 遮罩不出现（不闪）。

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(ui): mount LoadingOverlay in App"
```

---

## 收尾验证

- [ ] **全量单测**

Run: `npx vitest run`
Expected: 全绿

- [ ] **类型检查 + 构建**

Run: `npx tsc --noEmit && npm run build`
Expected: 成功
