# 启动分阶段加载 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把启动重构成"并发扫描（全屏遮挡）→ 露出文件树 → 后台解析（toast 进度）→ 一次性合并 → 建索引"，扫描完即可交互、解析不卡 UI。

**Architecture:** 有界并发 `scanTree` 取代串行 `listAll`；`scanAndIndex` 分阶段编排，阶段1 撤遮挡，阶段2 `parseAll` 后台解析（不写 store、结果攒 Map），阶段2.5 用 `produce` 一次性合并，阶段3 建索引；进度复用 `toastStore`（右上角）。

**Tech Stack:** TypeScript、SolidJS、Vitest、File System Access API。

参考 spec：`docs/superpowers/specs/2026-06-10-startup-phased-loading-design.md`

**注意：** FS 扫描与编排涉及真实 vault + DOM，单测覆盖纯函数（`mapWithConcurrency`、`toastStore` 扩展）；`scanTree`/`parseAll`/编排靠 `tsc`/`build` + 手动浏览器验证。

---

## 文件结构

- Create: `src/vault/fs/concurrency.ts` — `mapWithConcurrency`
- Create: `src/vault/fs/__tests__/concurrency.test.ts`
- Modify: `src/stores/toastStore.ts` — `showToast` 返回 id + `updateToast`
- Modify: `src/stores/__tests__/`（新建 `toastStore.test.ts`）
- Modify: `src/vault/fs/types.ts`、`src/vault/fs/LocalAdapter.ts`、`src/vault/io.ts` — `scanTree`
- Modify: `src/vault/scan.ts` — `buildScan` 用 `scanTree`；`runPhase1`→`parseAll`（返回 Map、不写 store）
- Modify: `src/vault/loadProgress.ts` — `endScanOverlay`
- Modify: `src/components/LoadingOverlay.tsx` — 仅扫描信息
- Modify: `src/vault/index.ts` — `scanAndIndex` 编排

---

## Task 1: mapWithConcurrency 有界并发

**Files:**
- Create: `src/vault/fs/concurrency.ts`
- Create: `src/vault/fs/__tests__/concurrency.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { mapWithConcurrency } from '../concurrency'

describe('mapWithConcurrency', () => {
  it('preserves order of results', async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => n * 10)
    expect(out).toEqual([10, 20, 30, 40])
  })

  it('never exceeds the concurrency limit', async () => {
    let active = 0, peak = 0
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      active++; peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
    })
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('handles empty input', async () => {
    expect(await mapWithConcurrency([], 4, async (x) => x)).toEqual([])
  })

  it('propagates errors', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => { if (n === 2) throw new Error('boom'); return n }),
    ).rejects.toThrow('boom')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/vault/fs/__tests__/concurrency.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/vault/fs/concurrency.ts`**

```ts
/** 有界并发 map：最多 limit 个 fn 同时执行，结果按输入顺序返回。 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  const n = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: n }, () => worker()))
  return results
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/vault/fs/__tests__/concurrency.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/vault/fs/concurrency.ts src/vault/fs/__tests__/concurrency.test.ts
git commit -m "feat(vault): add mapWithConcurrency helper"
```

---

## Task 2: toastStore 支持可更新进度

**Files:**
- Modify: `src/stores/toastStore.ts`
- Create: `src/stores/__tests__/toastStore.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { showToast, updateToast, dismissToast, toastStore } from '../toastStore'

describe('toastStore', () => {
  it('showToast returns an incrementing id and adds the item', () => {
    const id1 = showToast('a', { requireClick: true })
    const id2 = showToast('b', { requireClick: true })
    expect(typeof id1).toBe('number')
    expect(id2).toBeGreaterThan(id1)
    expect(toastStore.items.find((t) => t.id === id1)?.msg).toBe('a')
    dismissToast(id1); dismissToast(id2)
  })

  it('updateToast changes the message of an existing toast', () => {
    const id = showToast('parsing 0', { requireClick: true })
    updateToast(id, 'parsing 5')
    expect(toastStore.items.find((t) => t.id === id)?.msg).toBe('parsing 5')
    dismissToast(id)
  })

  it('updateToast is a no-op for an unknown id', () => {
    expect(() => updateToast(99999, 'x')).not.toThrow()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/stores/__tests__/toastStore.test.ts`
Expected: FAIL（`showToast` 返回 void、无 `updateToast`）

- [ ] **Step 3: 改 `src/stores/toastStore.ts`**

把 `showToast` 改为返回 `id`，并加 `updateToast`：

```ts
export function showToast(
  msg: string,
  opts?: { level?: ToastLevel; requireClick?: boolean; duration?: number },
): number {
  const id = _id++
  const item: Toast = {
    id,
    msg,
    level: opts?.level ?? 'info',
    requireClick: opts?.requireClick ?? false,
    duration: opts?.duration ?? 3000,
  }
  setToastStore('items', (prev) => [...prev, item])
  if (!item.requireClick) {
    setTimeout(() => dismissToast(id), item.duration)
  }
  return id
}

export function updateToast(id: number, msg: string): void {
  setToastStore('items', (t) => t.id === id, 'msg', msg)
}
```

（`showError`/`showWarn` 仍调用 `showToast`，现返回 number——它们本身返回 void，不受影响。）

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/stores/__tests__/toastStore.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/stores/toastStore.ts src/stores/__tests__/toastStore.test.ts
git commit -m "feat(toast): showToast returns id, add updateToast for live progress"
```

---

## Task 3: scanTree 有界并发扫描

**Files:**
- Modify: `src/vault/fs/types.ts`
- Modify: `src/vault/fs/LocalAdapter.ts`
- Modify: `src/vault/io.ts`
- Modify: `src/vault/scan.ts`（`buildScan`）

- [ ] **Step 1: 接口加 `scanTree` `src/vault/fs/types.ts`**

`FileSystemAdapter` 接口里 `listAll` 之后加：

```ts
  scanTree(concurrency?: number, onStat?: () => void): Promise<DirEntry[]>
```

- [ ] **Step 2: 实现 `LocalAdapter.scanTree` `src/vault/fs/LocalAdapter.ts`**

顶部加 import：

```ts
import { mapWithConcurrency } from './concurrency'
```

在 `listAll` 方法之后（class 内）加：

```ts
  async scanTree(concurrency = 32, onStat?: () => void): Promise<DirEntry[]> {
    const dirs: DirEntry[] = []
    const fileStubs: { name: string; path: string; parent: string | null; handle: FileSystemFileHandle }[] = []
    const walk = async (parentPath: string | null, dir: FileSystemDirectoryHandle): Promise<void> => {
      for await (const [name, entry] of dir.entries()) {
        if (name.startsWith('.')) continue
        const path = parentPath ? `${parentPath}/${name}` : name
        if (entry.kind === 'directory') {
          dirs.push({ name, path, kind: 'directory', parent: parentPath, size: 0, mtime: 0 })
          await walk(path, entry as FileSystemDirectoryHandle)
        } else {
          fileStubs.push({ name, path, parent: parentPath, handle: entry as FileSystemFileHandle })
        }
      }
    }
    await walk(null, this.rootHandle)
    const files = await mapWithConcurrency(fileStubs, concurrency, async (s): Promise<DirEntry> => {
      const f = await s.handle.getFile()
      onStat?.()
      return { name: s.name, path: s.path, kind: 'file', parent: s.parent, size: f.size, mtime: f.lastModified }
    })
    return [...dirs, ...files]
  }
```

- [ ] **Step 3: io 暴露 `scanTree` `src/vault/io.ts`**

在 `listAll` 导出之后加：

```ts
export async function scanTree(
  concurrency?: number,
  onStat?: () => void,
): Promise<import('./fs/types').DirEntry[]> {
  if (!_adapter) return []
  return _adapter.scanTree(concurrency, onStat)
}
```

- [ ] **Step 4: `buildScan` 用 `scanTree` `src/vault/scan.ts`**

第 14 行 import 把 `listAll` 换成 `scanTree`（已确认 `scan.ts` 内 `listAll` 仅 `buildScan` 用，`rescanTree` 走 `buildScan`，故 `listAll` 不再被引用）：

```ts
import { scanTree, readFile } from './io'
```

`buildScan` 改为先并发扫描再构造 `files`：

```ts
export async function buildScan(onDetected?: () => void): Promise<ScanResult> {
  const result: ScanResult = { files: {}, activePaths: new Set() }
  const epoch = new Date(0).toISOString().slice(0, 10)
  const entries = await scanTree(32, onDetected)
  for (const entry of entries) {
    const { name, path, kind, parent, size, mtime } = entry
    if (kind === 'directory') {
      result.files[path] = {
        name, path, kind: 'directory', parent,
        size: 0, mtime: 0, hash: '', ...EMPTY_CONTENT,
        created: epoch, dated: extractDateFromName(name) ?? epoch,
      }
    } else {
      const mtimeStr = new Date(mtime).toISOString().slice(0, 10)
      result.files[path] = {
        name, path, kind: 'file', parent,
        size, mtime, hash: '', ...EMPTY_CONTENT,
        created: mtimeStr, dated: extractDateFromName(name) ?? mtimeStr,
      }
      result.activePaths.add(path)
    }
  }
  return result
}
```

（`onDetected` 现传给 `scanTree` 的 `onStat`，每个文件 stat 完成时递增；不再在循环里调用。）

- [ ] **Step 5: 类型检查 + 构建**

Run: `npx tsc --noEmit && npm run build`
Expected: 无错误，构建成功。

- [ ] **Step 6: 提交**

```bash
git add src/vault/fs/types.ts src/vault/fs/LocalAdapter.ts src/vault/io.ts src/vault/scan.ts
git commit -m "feat(vault): bounded-concurrency scanTree replaces serial listAll in buildScan"
```

---

## Task 4: parseAll —— 后台解析不写 store，返回结果 Map

**Files:**
- Modify: `src/vault/scan.ts`（`runPhase1` → `parseAll`）

- [ ] **Step 1: 重写 `runPhase1` 为 `parseAll`**

把 `runPhase1`（第 151–244 行）整体替换为下面 `parseAll`：不再 `setVaultStore`，每个文件结果存进 `results` Map 并返回。**保留 `import { setVaultStore, vaultStore } from './index'` 不变**——`rescanTree`（同文件）仍用 `setVaultStore`，`parseAll` 用 `vaultStore` 读取。

```ts
export type ParsedFields = Partial<FileMeta>

export async function parseAll(
  session: { cancelled: boolean },
  unchanged: string[],
  changed: string[],
  activeHashes: Set<string>,
  onParsed?: () => void,
): Promise<Map<string, ParsedFields>> {
  const results = new Map<string, ParsedFields>()
  const parser = createMarkdownParser()
  const hashes = unchanged.map((p) => vaultStore.files[p]?.hash ?? '')
  hashes.forEach((h) => { if (h) activeHashes.add(h) })

  const metas = await getManyMeta(hashes)
  const stillChanged: string[] = [...changed]
  for (let i = 0; i < unchanged.length; i++) {
    if (session.cancelled) return results
    if (i > 0 && i % UNCHANGED_YIELD_EVERY === 0) {
      await yieldToMain()
      if (session.cancelled) return results
    }
    const path = unchanged[i]
    const hash = hashes[i]
    if (!hash) continue
    const meta = metas[i]
    if (meta && Array.isArray(meta.lists)) {
      results.set(path, { hash, ...meta })
      onParsed?.()
    } else {
      stillChanged.push(path)
    }
  }

  for (let ci = 0; ci < stillChanged.length; ci++) {
    const path = stillChanged[ci]
    if (session.cancelled) return results
    if (ci > 0 && ci % CHANGED_YIELD_EVERY === 0) {
      await yieldToMain()
      if (session.cancelled) return results
    }
    try {
      const content = await readFile(path)
      const hash = hashContent(content)
      activeHashes.add(hash)
      const entry = vaultStore.files[path]
      if (entry)
        await setFileStatEntry(path, { size: entry.size, mtime: entry.mtime, hash })
      const cachedMeta = await getCachedMeta(hash)
      if (cachedMeta && Array.isArray(cachedMeta.lists)) {
        results.set(path, { hash, ...cachedMeta })
      } else {
        const { frontmatter } = parseFrontmatter(content)
        const { outLinks, inlineTags, lists } = parser.parse(content)
        const created =
          extractDateString(frontmatter.created) ??
          new Date(entry.mtime).toISOString().slice(0, 10)
        const updated = extractDateString(frontmatter.updated) ?? null
        const dated = extractDateString(frontmatter.dated) ?? created
        const fmTags = extractTags(frontmatter.tags)
        const parsed = {
          frontmatter,
          outLinks,
          etags: [...new Set([...fmTags, ...inlineTags])],
          tags: mergeTagsWithBody(fmTags, inlineTags),
          aliases: extractAliases(frontmatter.aliases),
          created,
          updated,
          dated,
          lists,
        }
        await setCachedMeta(hash, parsed)
        results.set(path, { hash, ...parsed })
      }
    } catch {
      /* individual file errors are non-fatal */
    } finally {
      onParsed?.()
    }
  }
  return results
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit 2>&1 | head`
Expected: 仅 `index.ts` 因仍调用 `runPhase1` 报错（下一任务修）；`scan.ts` 本身无错。若 `scan.ts` 报 `setVaultStore` 未使用以外的错，修正。

（本任务不单独提交；与 Task 5 一起验证后提交，避免中间 tsc 红。或先提交 scan.ts，index.ts 在 Task 5 修复——按执行者偏好。这里选择与 Task 5 合并提交。）

---

## Task 5: scanAndIndex 编排 + 遮挡只管扫描 + toast 进度

**Files:**
- Modify: `src/vault/loadProgress.ts`
- Modify: `src/components/LoadingOverlay.tsx`
- Modify: `src/vault/index.ts`

- [ ] **Step 1: `loadProgress.ts` 加 `endScanOverlay`**

在 `endLoadProgress` 之前加：

```ts
/** 扫描完成：撤掉全屏遮挡（解析进度改走 toast）。 */
export function endScanOverlay(session: object): void {
  if (currentSession !== session) return
  stopTimers()
  setSnapshot((s) => ({ ...s, visible: false }))
}
```

- [ ] **Step 2: `LoadingOverlay.tsx` 简化为只显示扫描**

整体替换为：

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
          <div class="text-[14px] font-semibold text-(--text)">正在读取本地文件夹…</div>
          <div class="relative h-1.5 w-full overflow-hidden rounded-full bg-(--bg-active)">
            <div class="loading-overlay-bar absolute inset-y-0 left-0 w-1/3 rounded-full bg-(--accent)" />
          </div>
          <div class="text-[12px] text-(--text-2)">检测到 {p().detected} 个文件</div>
        </div>
      </div>
    </Show>
  )
}
```

- [ ] **Step 3: `index.ts` 编排重构**

改 import：
- `loadProgress` 这行：`import { beginLoadProgress, endLoadProgress, endScanOverlay, incDetected } from './loadProgress'`（去掉 `setLoadPhase`/`setParseTotal`/`incParsed`）。
- 加 toast：`import { showToast, updateToast, dismissToast } from '../stores/toastStore'`。
- `scan` 这行把 `runPhase1` 换成 `parseAll`：`import { buildScan, extractAliases, extractDateString, extractTags, mergeTagsWithBody, parseAll } from './scan'`。
- `produce` 已 import。

把 `scanAndIndex` 的 try 块（第 127–173 行）替换为：

```ts
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

    // 阶段 1：仅 stat 的 FileMeta 入 store，撤遮挡，露出工作区/文件树
    setVaultStore('files', files)
    endScanOverlay(session)

    // 阶段 2：后台解析（不写 store），右上角 toast 进度
    const total = mdUnchanged.length + mdChanged.length
    const toastId = total > 0
      ? showToast(`解析 0 / ${total}（双链/任务暂不完整）`, { requireClick: true })
      : -1
    let done = 0
    const activeHashes = new Set<string>()
    const results = await parseAll(session, mdUnchanged, mdChanged, activeHashes, () => {
      done++
      if (toastId >= 0 && (done === total || done % 20 === 0)) {
        updateToast(toastId, `解析 ${done} / ${total}（双链/任务暂不完整）`)
      }
    })

    if (session.cancelled) {
      if (toastId >= 0) dismissToast(toastId)
      return
    }

    // 阶段 2.5：一次性就地合并完整 FileMeta（单次响应式更新）
    setVaultStore('files', produce((fs: Record<string, FileMeta>) => {
      for (const [path, fields] of results) {
        const f = fs[path]
        if (f) Object.assign(f, fields)
      }
    }))

    // 阶段 3：构建跨文件索引
    const mdFiles = Object.fromEntries(
      Object.entries(vaultStore.files).filter(([p]) => p.endsWith('.md')),
    )
    buildBacklinks(mdFiles)
    buildTags(mdFiles)
    buildTasks(mdFiles)
    pruneFileStatCache(activePaths).catch(() => {})
    pruneCache(activeHashes).catch(() => {})

    if (toastId >= 0) {
      dismissToast(toastId)
      showToast('解析完成', { duration: 2000 })
    }
  } finally {
    if (currentSession === session) {
      setIsIndexing(false)
      endLoadProgress(session)
    }
  }
```

- [ ] **Step 4: 类型检查 + 测试 + 构建**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc 无错误；测试全绿；构建成功。

- [ ] **Step 5: 手动验证**

Run: `npm run dev`，打开一个较大的 vault。
Expected：
- 启动先全屏遮挡显示"读取本地文件夹…检测到 N 个文件"，**比之前快**（并发 stat）。
- 扫描完**立刻**露出工作区 + 文件树，可点击/导航（此时打开文件能编辑）。
- 右上角出现 `解析 X / N` toast，期间 UI 可点不卡；双链/task 视图在解析完成前可能不全。
- 解析完成后 toast 变"解析完成"2 秒消失，双链/task 就绪。
- 小库下扫描 < 300ms 时遮挡可能一闪而过或不显示（符合预期）。

- [ ] **Step 6: 提交（含 Task 4 的 scan.ts 改动）**

```bash
git add src/vault/scan.ts src/vault/loadProgress.ts src/components/LoadingOverlay.tsx src/vault/index.ts
git commit -m "feat(vault): phased startup — reveal tree after scan, background parse with toast"
```

---

## 完成标准

- 启动：并发扫描（遮挡）→ 扫描完撤遮挡露出文件树并可交互 → 后台解析（toast 进度，UI 不卡）→ 一次性合并 → 建索引 → toast 完成。
- 解析期间零 per-file 响应式写入（`produce` 一次合并）；并发 stat 上限 32。
- `mapWithConcurrency` / `toastStore`（id + updateToast）有单测；`tsc`/`vitest`/`build` 全绿。
- 一致性：扫描即当前 FS 快照，无陈旧数据。
