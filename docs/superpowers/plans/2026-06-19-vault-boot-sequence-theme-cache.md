# Vault 启动时序重构 + 主题防闪烁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 loading 遮罩保持到「读 `.symbol-notes/` 配置 + hydrate workspace/settings」完成后再揭开，并用 IndexedDB 缓存完整主题使首帧（含遮罩）即正确着色，消除布局重排与明↔暗闪烁。

**Architecture:** 把 `scanAndIndex` 拆成 reveal 前的 `scanPhase1`（同步串行：扫描 + 填 store + 建树）与 reveal 后的 `parseAndIndex`（后台解析 + 建索引）。reveal 控制权交给 `restoreVault`/`openVault`，经 `connectVaultConfig` 按 vault 配置状态决定揭开时机。新增 `src/lib/themeCache.ts`：启动前 `await getCachedTheme()` → `applyTheme`；一个受 `themeHydrated` gate 约束的 effect 在 hydrate 后接管「应用 + 写缓存」，避免默认值回灌。

**Tech Stack:** SolidJS、TypeScript、`idb-keyval`、Vitest（node 环境）。

## Global Constraints

- 代码注释 / commit message / UI 文案用中文；变量与类型名用英文。
- 测试环境为 `node`（`vite.config.ts` 的 `test.environment`）；只测纯逻辑，不依赖浏览器 API。`idb-keyval` 在测试中必须 mock（参考 `src/vault/__tests__/indexStorage.test.ts`）。
- 应用本体是 SolidJS：用 `createSignal` / `createEffect` / `createRoot`，不要写 React。
- 所有文件写操作经 `fileActions`；本计划不新增文件写路径。配置 IO 仍走 `vaultConfig.ts`（绕开 io.ts），不改其逻辑。
- 提交前：`npm run build`（含 `tsc`）与 `npx vitest run` 均通过。
- 复用既有类型 `ThemeSpec`（`src/lib/theme.ts`）：`{ kind:'preset'; id: string } | { kind:'custom'; mode: 'light'|'dark'; vars: Record<string,string> }`。
- 复用既有函数：`resolveTheme(themeId, customThemes)`、`applyTheme(spec)`（`src/lib/theme.ts`）。

---

### Task 1: themeCache 模块（读/写缓存 + hydrated 闸门）

**Files:**
- Create: `src/lib/themeCache.ts`
- Test: `src/lib/__tests__/themeCache.test.ts`

**Interfaces:**
- Consumes: `ThemeSpec`、`ThemeMode` from `src/lib/theme.ts`；`get`/`set` from `idb-keyval`；`createSignal` from `solid-js`。
- Produces:
  - `getCachedTheme(): Promise<ThemeSpec | null>` — 读 IDB 缓存，形状非法/缺失返回 `null`。
  - `writeCachedTheme(spec: ThemeSpec): Promise<void>` — 写 IDB（fire-and-forget 调用）。
  - `isThemeSpec(v: unknown): v is ThemeSpec` — 纯校验。
  - `themeHydrated(): boolean` — 响应式 accessor，初值 `false`。
  - `setThemeHydrated(v: boolean): void` — setter。
  - 常量 key：模块内部 `const CACHE_KEY = 'sn-theme-cache'`。

- [ ] **Step 1: 写失败测试**

`src/lib/__tests__/themeCache.test.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGet = vi.fn()
const mockSet = vi.fn()

vi.mock('idb-keyval', () => ({
  get: mockGet,
  set: mockSet,
}))

const { getCachedTheme, writeCachedTheme, isThemeSpec } = await import('../themeCache')

describe('themeCache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('isThemeSpec 接受合法 preset', () => {
    expect(isThemeSpec({ kind: 'preset', id: 'nord' })).toBe(true)
  })

  it('isThemeSpec 接受合法 custom', () => {
    expect(isThemeSpec({ kind: 'custom', mode: 'light', vars: { '--bg-base': '#fff' } })).toBe(true)
  })

  it('isThemeSpec 拒绝非法值', () => {
    expect(isThemeSpec(null)).toBe(false)
    expect(isThemeSpec({ kind: 'preset' })).toBe(false)
    expect(isThemeSpec({ kind: 'custom', mode: 'sunset', vars: {} })).toBe(false)
    expect(isThemeSpec({ kind: 'other', id: 'x' })).toBe(false)
  })

  it('getCachedTheme 返回 null 当 IDB 为空', async () => {
    mockGet.mockResolvedValueOnce(undefined)
    expect(await getCachedTheme()).toBeNull()
  })

  it('getCachedTheme 返回 null 当缓存形状非法', async () => {
    mockGet.mockResolvedValueOnce({ kind: 'custom', mode: 'nope' })
    expect(await getCachedTheme()).toBeNull()
  })

  it('getCachedTheme 返回合法缓存', async () => {
    const spec = { kind: 'preset', id: 'light' }
    mockGet.mockResolvedValueOnce(spec)
    expect(await getCachedTheme()).toEqual(spec)
  })

  it('writeCachedTheme 写入 idb-keyval', async () => {
    const spec = { kind: 'preset', id: 'dark' } as const
    await writeCachedTheme(spec)
    expect(mockSet).toHaveBeenCalledWith('sn-theme-cache', spec)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/lib/__tests__/themeCache.test.ts`
Expected: FAIL（`Cannot find module '../themeCache'`）。

- [ ] **Step 3: 写实现**

`src/lib/themeCache.ts`：

```ts
// 职责：把当前生效的 ThemeSpec 镜像到 IndexedDB，并在启动时读回，
// 使首帧（含 loading 遮罩）即正确着色。themeHydrated 闸门见 App 的应用 effect。
import { createSignal } from 'solid-js'
import { get, set } from 'idb-keyval'
import type { ThemeSpec } from './theme'

const CACHE_KEY = 'sn-theme-cache'

/** ThemeSpec 形状校验（缓存可能被外部写脏，读回时必须校验）。 */
export function isThemeSpec(v: unknown): v is ThemeSpec {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (o.kind === 'preset') return typeof o.id === 'string'
  if (o.kind === 'custom') {
    return (
      (o.mode === 'light' || o.mode === 'dark') &&
      typeof o.vars === 'object' &&
      o.vars !== null &&
      !Array.isArray(o.vars)
    )
  }
  return false
}

/** 启动路径：读回缓存主题；缺失或形状非法返回 null。 */
export async function getCachedTheme(): Promise<ThemeSpec | null> {
  try {
    const v = await get<unknown>(CACHE_KEY)
    return isThemeSpec(v) ? v : null
  } catch {
    return null
  }
}

/** 主题变化时镜像到 IDB（调用方 fire-and-forget）。 */
export async function writeCachedTheme(spec: ThemeSpec): Promise<void> {
  try {
    await set(CACHE_KEY, spec)
  } catch {
    /* 缓存写失败不影响主流程 */
  }
}

// themeHydrated：vault 配置流程是否已完成（settings 已反映真实/默认值）。
// 在它为 true 之前，App 的应用 effect 不接管，由 index.tsx 应用的缓存主题兜底，
// 避免默认 settings 把缓存主题回灌成深色。
const [_hydrated, _setHydrated] = createSignal(false)
export const themeHydrated = _hydrated
export function setThemeHydrated(v: boolean): void {
  _setHydrated(v)
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/lib/__tests__/themeCache.test.ts`
Expected: PASS（7 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/themeCache.ts src/lib/__tests__/themeCache.test.ts
git commit -m "feat(theme): themeCache 模块（IDB 主题缓存 + hydrated 闸门）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 启动前应用缓存主题（index.tsx）

**Files:**
- Modify: `src/index.tsx`

**Interfaces:**
- Consumes: `getCachedTheme` from `src/lib/themeCache`；`applyTheme` from `src/lib/theme`。
- Produces: 无（纯启动副作用）。

> 本任务无独立单测（涉及 DOM render 与 IDB，属 node 测试不覆盖范围），靠 `tsc` + 手动验证把关。

- [ ] **Step 1: 改写 index.tsx 在 render 前应用缓存主题**

`src/index.tsx` 全文替换为：

```tsx
import { render } from 'solid-js/web'
import App from './App'
import { getCachedTheme } from './lib/themeCache'
import { applyTheme } from './lib/theme'
import './index.css'

// 首帧防闪烁：渲染前先读回上次生效主题并应用，使遮罩与背景首帧即正确着色。
// IDB 读取为个位数毫秒，期间 root 为空，无可见内容。
async function boot(): Promise<void> {
  const cached = await getCachedTheme()
  if (cached) applyTheme(cached)
  render(() => <App />, document.getElementById('root')!)
}

void boot()
```

- [ ] **Step 2: 类型检查通过**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add src/index.tsx
git commit -m "feat(theme): 启动前读回缓存主题应用，首帧防闪烁

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: App 主题 effect 加 hydrated 闸门 + 写缓存

**Files:**
- Modify: `src/App.tsx:69-76`（`App()` 内的两个 `createEffect`）

**Interfaces:**
- Consumes: `themeHydrated`、`writeCachedTheme` from `src/lib/themeCache`；既有 `applyTheme`、`resolveTheme`、`settingsStore`。
- Produces: 无新导出。副作用：仅当 `themeHydrated()` 为 `true` 时 `applyTheme` 并 `writeCachedTheme`。

> 闸门为 false 期间（hydrate 未完成），由 Task 2 在 index.tsx 应用的缓存主题兜底；
> 同时也禁止写缓存，避免默认 `theme:'dark'` 把磁盘缓存回灌成深色。

- [ ] **Step 1: 加 import**

在 `src/App.tsx` 顶部 import 区，`import { applyTheme, resolveTheme } from './lib/theme'` 之后新增：

```tsx
import { themeHydrated, writeCachedTheme } from './lib/themeCache'
```

- [ ] **Step 2: 改主题 effect 加闸门 + 写缓存**

把 `App()` 内现有：

```tsx
  createEffect(() => {
    applyTheme(resolveTheme(settingsStore.theme, settingsStore.customThemes))
  })
```

替换为：

```tsx
  createEffect(() => {
    // hydrate 完成前不接管：由 index.tsx 应用的缓存主题兜底（防默认值回灌）。
    if (!themeHydrated()) return
    const spec = resolveTheme(settingsStore.theme, settingsStore.customThemes)
    applyTheme(spec)
    void writeCachedTheme(spec) // 镜像最近一次生效主题，供下次启动
  })
```

（其下方 `customCSS` 的 effect 保持不变。）

- [ ] **Step 3: 类型检查通过**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: 提交**

```bash
git add src/App.tsx
git commit -m "feat(theme): 主题 effect 加 hydrated 闸门并镜像缓存

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 拆分 scanAndIndex → scanPhase1 + parseAndIndex

**Files:**
- Modify: `src/vault/index.ts:210-314`（`Session`/`scanAndIndex` 区块）

**Interfaces:**
- Consumes: 既有 `buildScan`、`loadAllFileStats`、`parseAll`、`buildBacklinks/Tags/Tasks/Calendar`、`beginLoadProgress`、`endScanOverlay`、`endLoadProgress`、`setIsIndexing`、`showToast` 等。
- Produces:
  - `interface ScanMid { session: Session; mdUnchanged: string[]; mdChanged: string[]; activePaths: string[] }`
  - `async function scanPhase1(): Promise<ScanMid | null>` — 设 `currentSession`、`beginLoadProgress`、`setIsIndexing(true)`、扫描 + 填 store + 建树；**不** `endScanOverlay`。未就绪/取消返回 `null`。
  - `async function parseAndIndex(mid: ScanMid): Promise<void>` — 阶段2/3，`finally` 内 `endLoadProgress` + `setIsIndexing(false)`。
  - `async function scanAndIndex(): Promise<void>`（保留导出，back-compat 包装：scanPhase1 → endScanOverlay → parseAndIndex）。

> 本任务是纯重构，行为对既有 `scanAndIndex` 调用方等价；无新单测，靠 `tsc` + 既有测试 + 手动验证把关。reveal 时机的改变在 Task 5 接入。

- [ ] **Step 1: 替换 scanAndIndex 区块为拆分版**

把 `src/vault/index.ts` 中从 `interface Session {` 到 `scanAndIndex` 函数结束（约 212-314 行）整体替换为：

```ts
interface Session {
  cancelled: boolean
}
let currentSession: Session | null = null

export interface ScanMid {
  session: Session
  mdUnchanged: string[]
  mdChanged: string[]
  activePaths: string[]
}

/** Phase1（reveal 前，串行）：扫描 → 填仅含 stat 的 FileMeta → 建树。不撤遮罩。 */
export async function scanPhase1(): Promise<ScanMid | null> {
  if (currentSession) currentSession.cancelled = true
  const session: Session = { cancelled: false }
  currentSession = session

  if (!isReady()) return null
  setIsIndexing(true)
  beginLoadProgress(session)

  const [{ files, activePaths, tree }, idbStats] = await Promise.all([
    buildScan(incDetected),
    loadAllFileStats(),
  ])

  if (session.cancelled) return null

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

  // 阶段 1：仅 stat 的 FileMeta 入 store + 建树（撤遮挡交给调用方，在 hydrate 后）
  setVaultStore('files', files)
  setFileTree(tree)
  return { session, mdUnchanged, mdChanged, activePaths }
}

/** Phase2/3（reveal 后，后台）：解析 → 合并完整 FileMeta → 建跨文件索引。 */
export async function parseAndIndex(mid: ScanMid): Promise<void> {
  const { session, mdUnchanged, mdChanged, activePaths } = mid
  try {
    const total = mdUnchanged.length + mdChanged.length
    const toastId =
      total > 0
        ? showToast(`解析 0 / ${total}（双链/任务暂不完整）`, { requireClick: true })
        : -1
    let done = 0
    const activeHashes = new Set<string>()
    const results = await parseAll(
      session,
      mdUnchanged,
      mdChanged,
      activeHashes,
      () => {
        done++
        if (toastId >= 0 && (done === total || done % 20 === 0)) {
          updateToast(toastId, `解析 ${done} / ${total}（双链/任务暂不完整）`)
        }
      },
    )

    if (session.cancelled) {
      if (toastId >= 0) dismissToast(toastId)
      return
    }

    setVaultStore(
      'files',
      produce((fs: Record<string, FileMeta>) => {
        for (const [path, fields] of results) {
          const f = fs[path]
          if (f) Object.assign(f, fields)
        }
      }),
    )

    const mdFiles = Object.fromEntries(
      Object.entries(vaultStore.files).filter(([p]) => p.endsWith('.md')),
    )
    buildBacklinks(mdFiles)
    buildTags(mdFiles)
    buildTasks(mdFiles)
    buildCalendar(vaultStore.files)
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
}

/** Back-compat 包装：扫描后立即撤遮罩再后台解析（无配置编排）。 */
export async function scanAndIndex(): Promise<void> {
  const mid = await scanPhase1()
  if (!mid) return
  endScanOverlay(mid.session)
  await parseAndIndex(mid)
}
```

- [ ] **Step 2: 类型检查通过**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: 既有相关测试通过**

Run: `npx vitest run src/vault`
Expected: PASS（scan/loadProgress/calendarIndex 等既有用例不受影响）。

- [ ] **Step 4: 提交**

```bash
git add src/vault/index.ts
git commit -m "refactor(vault): scanAndIndex 拆为 scanPhase1 + parseAndIndex（reveal 解耦）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: reveal 时机接入 connectVaultConfig + 重排 restore/openVault

**Files:**
- Modify: `src/vault/index.ts:109-208`（`openVault`/`restoreVault`/`connectVaultConfig`）

**Interfaces:**
- Consumes: `scanPhase1`、`parseAndIndex`、`endScanOverlay`（已 import）；`setThemeHydrated` from `src/lib/themeCache`。
- Produces: `connectVaultConfig(session: Session)` 改为带 `session` 参数；每条路径都 `endScanOverlay(session)` + `setThemeHydrated(true)`。

> reveal 规则（spec §2.3）：有配置可读（active / unknown+exists）→ 先 hydrate 再 reveal；
> 无配置可 hydrate（declined / unknown 无配置）→ 先 reveal 再走原逻辑（不卡在弹窗前）。
> 每条路径末尾置 `setThemeHydrated(true)`——这是 themeHydrated 的**唯一**可靠置位点
> （覆盖 spec §4 提到的「hydrateSettings 末尾置位」，集中到此处避免 settings 缺失分支漏置）。

- [ ] **Step 1: 加 import**

在 `src/vault/index.ts` 顶部，`import { showModal, closeModal } from '../stores/modalStore'` 之后新增：

```ts
import { setThemeHydrated } from '../lib/themeCache'
```

- [ ] **Step 2: 重排 openVault / restoreVault**

把现有 `openVault` 与 `restoreVault` 两函数替换为：

```ts
export async function openVault(): Promise<void> {
  clearEmbedUrlCache()
  const adapter = await LocalAdapter.open()
  initFileIO(adapter)
  setVaultFs(adapter)
  vaultConfig.setAdapter(adapter)
  await vaultConfig.resetMeta() // 新 vault → unknown + 默认路径
  const { workspaceActions } = await import('../stores/workspaceStore')
  workspaceActions.clearAllLeaves()
  const mid = await scanPhase1()
  if (!mid) return
  await connectVaultConfig(mid.session) // 读配置 + hydrate，并按状态揭开遮罩
  await parseAndIndex(mid)
}

export async function restoreVault(): Promise<void> {
  const adapter = await LocalAdapter.restore()
  if (!adapter) return
  initFileIO(adapter)
  setVaultFs(adapter)
  vaultConfig.setAdapter(adapter)
  await vaultConfig.loadMeta()
  const mid = await scanPhase1()
  if (!mid) return
  await connectVaultConfig(mid.session)
  await parseAndIndex(mid)
}
```

- [ ] **Step 3: 改 connectVaultConfig 接入 reveal + themeHydrated**

把现有 `connectVaultConfig` 函数替换为：

```ts
/** 扫描后接入配置并决定揭开遮罩的时机：
 *  active / unknown+exists → 先 hydrate 再 reveal；
 *  declined / unknown 无配置 → 先 reveal 再走原逻辑（不卡在弹窗前）。
 *  每条路径末尾置 themeHydrated（settings 已反映真实/默认值）。 */
async function connectVaultConfig(session: Session): Promise<void> {
  const status = vaultConfig.metaStatus()
  if (status === 'declined') {
    endScanOverlay(session)
    setThemeHydrated(true)
    return
  }
  if (status === 'active') {
    await hydrateVaultConfig()
    endScanOverlay(session)
    setThemeHydrated(true)
    return
  }
  // unknown
  if (await vaultConfig.configFolderExists()) {
    await vaultConfig.markActive()
    await hydrateVaultConfig()
    endScanOverlay(session)
    setThemeHydrated(true)
    return
  }
  endScanOverlay(session)
  setThemeHydrated(true)
  promptCreateVaultConfig()
}
```

- [ ] **Step 4: 类型检查通过**

Run: `npx tsc --noEmit`
Expected: 无错误（`connectVaultConfig` 现需 `Session` 实参；`Session` 类型已在同文件定义）。

- [ ] **Step 5: 全量测试通过**

Run: `npx vitest run`
Expected: PASS（全部既有用例 + Task 1 新增用例）。

- [ ] **Step 6: 提交**

```bash
git add src/vault/index.ts
git commit -m "feat(vault): 遮罩保持到配置 hydrate 后再揭开 + themeHydrated 置位

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: 构建校验 + 手动回归

**Files:**
- 无代码改动（验证任务）。

**Interfaces:**
- Consumes: 前 5 个任务的成果。
- Produces: 验证记录（无产物）。

> 本任务把 spec §6 的手动验证清单走一遍，确认时序与防闪烁达标，并回归 workspace 落盘（spec §5，既有功能）。

- [ ] **Step 1: 生产构建 + 全量测试**

Run: `npm run build && npx vitest run`
Expected: 两者均无错误（`tsc` 通过、vite 构建成功、全部用例 PASS）。

- [ ] **Step 2: 手动验证启动时序与防闪烁**（`npm run dev`，逐条勾选）

- [ ] 深色主题用户刷新：首帧深色，无闪烁，布局一次到位（无可见重排）。
- [ ] 浅色 / nord / 自定义主题用户刷新：首帧即对应主题，无明↔暗或跳色。
- [ ] 首次打开某 vault（无 `.symbol-notes/`）：扫描后揭开遮罩 → 弹「是否创建配置」框，遮罩不卡在弹窗前。
- [ ] `declined` 状态 vault：扫描后正常揭开，不读配置、不弹框。
- [ ] 切换主题（含切到 nord/自定义）后刷新页面：新主题在首帧即生效（验证写缓存生效）。

- [ ] **Step 3: 回归 workspace 落盘（spec §5）**

- [ ] 在已激活配置的 vault 内开关标签 / 调整分屏 → 约 800ms 后 `.symbol-notes/workspace.json` 内容更新。
- [ ] 配置未激活（declined）时编辑布局 → `workspace.json` 不被写入。

- [ ] **Step 4: 提交验证记录（如有文档更新）**

若验证过程未改动任何文件，本步跳过；若调整了文档或修了回归暴露的小问题，单独提交：

```bash
git add -A
git commit -m "test(vault): 启动时序 + 主题防闪烁手动回归通过

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
