# 主题独立文件 + 遮罩颜色缓存 + 插件数据落 vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把主题拆到 `.symbol-notes/theme.json`、IDB 只缓存遮罩颜色防闪、每个插件配置落到 `.symbol-notes/plugins/<id>/data.json`（未激活仅内存）。

**Architecture:** IDB 仅存「遮罩 6 色」供首帧给 loading 遮罩着色（遮罩内联取色，与 `applyTheme` 解耦），去掉 `themeHydrated` 闸门；主题三件套与各插件配置作为 vault 文件，扫描后在遮罩内 hydrate。插件配置改由模块级 `pluginData.ts` 按 id 持有响应式内存 store + 防抖落盘。

**Tech Stack:** SolidJS、TypeScript、`idb-keyval`、Vitest（node 环境）。

## Global Constraints

- 代码注释 / commit message / UI 文案用中文；变量与类型名用英文。
- 测试环境 `node`；只测纯逻辑，`idb-keyval` 在测试中 mock（参考 `src/vault/__tests__/indexStorage.test.ts`）。
- 用 SolidJS（`createSignal`/`createStore`/`createEffect`/`createRoot`），不写 React。
- 配置 IO 经 `vaultConfig.ts`（FileSystemAdapter 直读直写，绕开 io.ts）；写文件用 `JSON.stringify(x, null, 2)`。
- 落盘统一 `isConfigActive()` gate + `SAVE_DEBOUNCE_MS`(800) 防抖（沿用 `vaultConfig` 既有常量/模式）。
- 插件 id：`daily-note` / `excalidraw` / `templates`。
- 遮罩 6 色变量：`--bg-elevated`、`--border-2`、`--text`、`--bg-active`、`--accent`、`--text-2`。
- 提交前每个任务：`npx tsc --noEmit` 通过；涉及单测的任务 `npx vitest run` 通过。
- `FileSystemAdapter`：`readText(path):Promise<string>`、`writeText(path,content):Promise<void>`、`createDirectory(path):Promise<void>`。

---

### Task 1: themeCache 重写为遮罩颜色 + 拆除 themeHydrated

**Files:**
- Modify: `src/lib/themeCache.ts`（整文件重写）
- Modify: `src/lib/__tests__/themeCache.test.ts`（整文件重写）
- Modify: `src/index.tsx`
- Modify: `src/App.tsx:36,70-77`
- Modify: `src/vault/index.ts`（删 `setThemeHydrated` import 与 4 处调用）

**Interfaces:**
- Produces:
  - `MASK_VARS: readonly string[]`（6 个变量名）
  - `snapshotMaskColors(): Record<string, string>`（读 computed style，仅浏览器用）
  - `getMaskColors(): Promise<Record<string, string> | null>`
  - `writeMaskColors(colors: Record<string, string>): Promise<void>`
  - `maskColors: () => Record<string, string>`、`setMaskColors(c: Record<string, string>): void`
- 移除：`getCachedTheme` / `writeCachedTheme` / `isThemeSpec` / `themeHydrated` / `setThemeHydrated`

- [ ] **Step 1: 重写 themeCache 测试**

`src/lib/__tests__/themeCache.test.ts` 整文件替换：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGet = vi.fn()
const mockSet = vi.fn()
const mockDel = vi.fn()

vi.mock('idb-keyval', () => ({
  get: mockGet,
  set: mockSet,
  del: mockDel,
}))

const { getMaskColors, writeMaskColors, MASK_VARS } = await import('../themeCache')

describe('themeCache mask colors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('MASK_VARS 含 6 个遮罩变量', () => {
    expect(MASK_VARS).toContain('--bg-elevated')
    expect(MASK_VARS).toContain('--accent')
    expect(MASK_VARS.length).toBe(6)
  })

  it('getMaskColors 返回 null 当 IDB 为空', async () => {
    mockGet.mockResolvedValueOnce(undefined)
    expect(await getMaskColors()).toBeNull()
  })

  it('getMaskColors 返回 null 当非对象', async () => {
    mockGet.mockResolvedValueOnce('nope')
    expect(await getMaskColors()).toBeNull()
  })

  it('getMaskColors 返回合法对象', async () => {
    const colors = { '--accent': '#6c63ff' }
    mockGet.mockResolvedValueOnce(colors)
    expect(await getMaskColors()).toEqual(colors)
  })

  it('writeMaskColors 写入 sn-mask-colors', async () => {
    const colors = { '--text': '#fff' }
    await writeMaskColors(colors)
    expect(mockSet).toHaveBeenCalledWith('sn-mask-colors', colors)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/lib/__tests__/themeCache.test.ts`
Expected: FAIL（旧导出已不匹配 / `getMaskColors` 未定义）。

- [ ] **Step 3: 重写 themeCache 实现**

`src/lib/themeCache.ts` 整文件替换：

```ts
// 职责：把 loading 遮罩用到的几个 CSS 颜色快照到 IndexedDB，供启动首帧给遮罩着色，
// 避免「主题还没从 .symbol-notes/theme.json 读出来」时遮罩闪烁。不是主题的真实来源。
import { createSignal } from 'solid-js'
import { get, set, del } from 'idb-keyval'

const CACHE_KEY = 'sn-mask-colors'

/** LoadingOverlay 实际用到的 CSS 变量。 */
export const MASK_VARS = [
  '--bg-elevated',
  '--border-2',
  '--text',
  '--bg-active',
  '--accent',
  '--text-2',
] as const

// 清掉上一个功能遗留的「整份主题」缓存键（幂等、吞错）。
void del('sn-theme-cache').catch(() => {})

/** 读取 <html> 上当前生效的 6 个遮罩变量值。仅浏览器可用。 */
export function snapshotMaskColors(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement)
  const out: Record<string, string> = {}
  for (const v of MASK_VARS) out[v] = cs.getPropertyValue(v).trim()
  return out
}

/** 启动路径：读回遮罩颜色；缺失或非对象返回 null。 */
export async function getMaskColors(): Promise<Record<string, string> | null> {
  try {
    const v = await get<unknown>(CACHE_KEY)
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      return v as Record<string, string>
    }
    return null
  } catch {
    return null
  }
}

/** 主题变化后镜像遮罩颜色到 IDB（fire-and-forget）。 */
export async function writeMaskColors(colors: Record<string, string>): Promise<void> {
  try {
    await set(CACHE_KEY, colors)
  } catch {
    /* 缓存写失败不影响主流程 */
  }
}

// 启动前由 index.tsx 从 IDB 播种，供 LoadingOverlay 内联取色。
const [_colors, _setColors] = createSignal<Record<string, string>>({})
export const maskColors = _colors
export function setMaskColors(c: Record<string, string>): void {
  _setColors(c)
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/lib/__tests__/themeCache.test.ts`
Expected: PASS（5 个用例）。

- [ ] **Step 5: 改 index.tsx 启动读遮罩颜色**

`src/index.tsx` 整文件替换：

```tsx
import { render } from 'solid-js/web'
import App from './App'
import { getMaskColors, setMaskColors } from './lib/themeCache'
import './index.css'

// 防闪：渲染前读回上次的遮罩颜色，使 loading 遮罩首帧即正确着色。
// 主题本体走 .symbol-notes/theme.json，扫描后才 hydrate。
async function boot(): Promise<void> {
  const mask = await getMaskColors()
  if (mask) setMaskColors(mask)
  render(() => <App />, document.getElementById('root')!)
}

void boot()
```

- [ ] **Step 6: 改 App.tsx 去闸门 + 写遮罩颜色**

在 `src/App.tsx`，把 import 行
`import { themeHydrated, writeCachedTheme } from './lib/themeCache'`
替换为：

```tsx
import { snapshotMaskColors, writeMaskColors } from './lib/themeCache'
```

把主题 effect：

```tsx
  createEffect(() => {
    // hydrate 完成前不接管：由 index.tsx 应用的缓存主题兜底（防默认值回灌）。
    if (!themeHydrated()) return
    const spec = resolveTheme(settingsStore.theme, settingsStore.customThemes)
    applyTheme(spec)
    void writeCachedTheme(spec) // 镜像最近一次生效主题，供下次启动
  })
```

替换为：

```tsx
  createEffect(() => {
    applyTheme(resolveTheme(settingsStore.theme, settingsStore.customThemes))
    void writeMaskColors(snapshotMaskColors()) // 刷新遮罩缓存供下次启动
  })
```

- [ ] **Step 7: 删 vault/index.ts 的 themeHydrated**

在 `src/vault/index.ts`：删除 import 行 `import { setThemeHydrated } from '../lib/themeCache'`；
删除 `connectVaultConfig` 内 4 处 `setThemeHydrated(true)` 语句（每个分支各一处，连同其上方
不再需要的注释「每条路径末尾置 themeHydrated（…）」可一并精简）。保留各分支的
`endScanOverlay(session)` 与既有结构。

- [ ] **Step 8: 类型检查 + 全量测试**

Run: `npx tsc --noEmit`
Expected: 无错误。

Run: `npx vitest run`
Expected: 全部 PASS。

- [ ] **Step 9: 提交**

```bash
git add src/lib/themeCache.ts src/lib/__tests__/themeCache.test.ts src/index.tsx src/App.tsx src/vault/index.ts
git commit -m "refactor(theme): themeCache 改存遮罩颜色 + 去除 themeHydrated 闸门

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: LoadingOverlay 用缓存遮罩颜色内联着色

**Files:**
- Modify: `src/components/LoadingOverlay.tsx`（整文件重写）

**Interfaces:**
- Consumes: `maskColors` from `src/lib/themeCache`。

> 无单测（依赖 DOM）；靠 `tsc` + 手动把关。

- [ ] **Step 1: 重写 LoadingOverlay**

`src/components/LoadingOverlay.tsx` 整文件替换：

```tsx
import { Show } from 'solid-js'
import { loadProgress } from '../vault/loadProgress'
import { maskColors } from '../lib/themeCache'

export function LoadingOverlay() {
  const p = loadProgress
  // 取缓存遮罩颜色；缺失回退到 CSS 变量。与 applyTheme 解耦，互不干扰。
  const c = (name: string) => maskColors()[name] || `var(${name})`
  return (
    <Show when={p().visible}>
      <div
        class="fixed inset-0 z-[10001] flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.6)' }}
      >
        <div
          class="rounded-lg shadow-xl px-6 py-5 flex flex-col gap-3 border"
          style={{
            'min-width': '300px',
            background: c('--bg-elevated'),
            'border-color': c('--border-2'),
          }}
        >
          <div class="text-[14px] font-semibold" style={{ color: c('--text') }}>
            正在读取本地文件夹…
          </div>
          <div
            class="relative h-1.5 w-full overflow-hidden rounded-full"
            style={{ background: c('--bg-active') }}
          >
            <div
              class="loading-overlay-bar absolute inset-y-0 left-0 w-1/3 rounded-full"
              style={{ background: c('--accent') }}
            />
          </div>
          <div class="text-[12px]" style={{ color: c('--text-2') }}>
            检测到 {p().detected} 个文件
          </div>
        </div>
      </div>
    </Show>
  )
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add src/components/LoadingOverlay.tsx
git commit -m "feat(theme): LoadingOverlay 用缓存遮罩颜色内联着色

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: types 别名 + vaultConfig 主题/插件数据 IO

**Files:**
- Modify: `src/stores/types.ts`（SettingsState 之后加两个 Pick 别名）
- Modify: `src/vault/vaultConfig.ts`
- Modify: `src/vault/__tests__/vaultConfig.test.ts`
- Modify: `src/vault/index.ts`（`snapshotStores` 返回 theme；`createConfigFolder`/`migratePath` 调用补参）

**Interfaces:**
- Produces（vaultConfig）：
  - `ThemeSettings` / `VaultSettings`（来自 types.ts，re-export 或直接 import）
  - `parseVaultSettings(v: unknown): Partial<VaultSettings> | null`（原 `parseSettings` 改名）
  - `parseTheme(v: unknown): Partial<ThemeSettings> | null`
  - `readConfigFiles(): Promise<{ workspace: WorkspaceState | null; settings: Partial<VaultSettings> | null; theme: Partial<ThemeSettings> | null }>`
  - `saveTheme(t: ThemeSettings): void`
  - `saveSettings(s: VaultSettings): void`（改窄；写入仅取 3 个非主题字段）
  - `pluginDataPath(id: string): string`
  - `readPluginData(id: string): Promise<Record<string, unknown> | null>`
  - `savePluginData(id: string, data: Record<string, unknown>): void`
  - `createConfigFolder(ws, settings: VaultSettings, theme: ThemeSettings, pluginData?: Record<string, Record<string, unknown>>)`
  - `migratePath(newPath, ws, settings: VaultSettings, theme: ThemeSettings, pluginData?)`

- [ ] **Step 1: types.ts 加别名**

在 `src/stores/types.ts` 的 `SettingsState` 接口之后插入：

```ts
/** 主题三件套：落 .symbol-notes/theme.json（随 vault）。 */
export type ThemeSettings = Pick<SettingsState, 'theme' | 'customThemes' | 'customCSS'>
/** 非主题配置：落 .symbol-notes/settings.json。 */
export type VaultSettings = Pick<SettingsState, 'pluginStates' | 'autoTimestamps' | 'showOtherFiles'>
```

- [ ] **Step 2: 写 vaultConfig 失败测试**

在 `src/vault/__tests__/vaultConfig.test.ts`：把 import 里的 `parseSettings` 改为
`parseVaultSettings`，并新增 `parseTheme`、`pluginDataPath`：

```ts
import {
  joinConfigPath,
  validateWorkspace,
  parseVaultSettings,
  parseTheme,
  pluginDataPath,
} from '../vaultConfig'
```

（同时把文件内原有 `parseSettings(...)` 的用例调用改为 `parseVaultSettings(...)`。）
在文件末尾追加：

```ts
describe('parseTheme', () => {
  it('非数组对象返回自身', () => {
    expect(parseTheme({ theme: 'nord' })).toEqual({ theme: 'nord' })
  })
  it('数组/非对象返回 null', () => {
    expect(parseTheme([])).toBeNull()
    expect(parseTheme('x')).toBeNull()
    expect(parseTheme(null)).toBeNull()
  })
})

describe('pluginDataPath', () => {
  it('拼成 plugins/<id>/data.json（默认 .symbol-notes）', () => {
    expect(pluginDataPath('daily-note')).toBe('.symbol-notes/plugins/daily-note/data.json')
  })
})
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `npx vitest run src/vault/__tests__/vaultConfig.test.ts`
Expected: FAIL（`parseVaultSettings`/`parseTheme`/`pluginDataPath` 未导出）。

- [ ] **Step 4: 改 vaultConfig 实现**

在 `src/vault/vaultConfig.ts`：

1) import 类型补充（顶部 `import type` 行）：

```ts
import type { SettingsState, ThemeSettings, VaultSettings, WorkspaceState } from '../stores/types'
```

2) 文件常量区加：

```ts
const THEME_FILE = 'theme.json'
const PLUGINS_DIR = 'plugins'
```

3) 把原 `parseSettings` 改名并补 `parseTheme`（在原 `parseSettings` 位置替换）：

```ts
function lenientObject<T>(v: unknown): Partial<T> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  return v as Partial<T>
}
/** settings.json 宽松解析（非主题字段）。 */
export function parseVaultSettings(v: unknown): Partial<VaultSettings> | null {
  return lenientObject<VaultSettings>(v)
}
/** theme.json 宽松解析。 */
export function parseTheme(v: unknown): Partial<ThemeSettings> | null {
  return lenientObject<ThemeSettings>(v)
}
```

4) `readConfigFiles` 改为读三份：

```ts
export async function readConfigFiles(): Promise<{
  workspace: WorkspaceState | null
  settings: Partial<VaultSettings> | null
  theme: Partial<ThemeSettings> | null
}> {
  if (!_adapter) return { workspace: null, settings: null, theme: null }
  const path = meta().path
  let workspace: WorkspaceState | null = null
  let settings: Partial<VaultSettings> | null = null
  let theme: Partial<ThemeSettings> | null = null
  try {
    const parsed = JSON.parse(await _adapter.readText(joinConfigPath(path, WORKSPACE_FILE))) as unknown
    if (validateWorkspace(parsed)) workspace = parsed
  } catch { /* 缺失/损坏 → null */ }
  try {
    settings = parseVaultSettings(JSON.parse(await _adapter.readText(joinConfigPath(path, SETTINGS_FILE))) as unknown)
  } catch { /* 缺失/损坏 → null */ }
  try {
    theme = parseTheme(JSON.parse(await _adapter.readText(joinConfigPath(path, THEME_FILE))) as unknown)
  } catch { /* 缺失/损坏 → null */ }
  return { workspace, settings, theme }
}
```

5) `createConfigFolder`（替换原函数）——只写非主题 settings，写 theme.json，写非空插件数据：

```ts
function pickVault(s: VaultSettings): VaultSettings {
  return {
    pluginStates: s.pluginStates,
    autoTimestamps: s.autoTimestamps,
    showOtherFiles: s.showOtherFiles,
  }
}

/** 创建配置文件夹并写入种子内容（当前 store 状态），置 active。 */
export async function createConfigFolder(
  ws: WorkspaceState,
  settings: VaultSettings,
  theme: ThemeSettings,
  pluginData?: Record<string, Record<string, unknown>>,
): Promise<void> {
  if (!_adapter) return
  const path = meta().path
  await _adapter.createDirectory(path)
  await _adapter.writeText(joinConfigPath(path, WORKSPACE_FILE), JSON.stringify(ws, null, 2))
  await _adapter.writeText(joinConfigPath(path, SETTINGS_FILE), JSON.stringify(pickVault(settings), null, 2))
  await _adapter.writeText(joinConfigPath(path, THEME_FILE), JSON.stringify(theme, null, 2))
  if (pluginData) {
    for (const [id, data] of Object.entries(pluginData)) {
      if (!data || Object.keys(data).length === 0) continue
      await _adapter.createDirectory(joinConfigPath(path, `${PLUGINS_DIR}/${id}`))
      await _adapter.writeText(pluginDataPath(id), JSON.stringify(data, null, 2))
    }
  }
  setMeta((m) => ({ ...m, status: 'active' }))
  await persistMeta()
}
```

6) `migratePath`（替换原函数）：

```ts
/** 改相对路径并把当前配置写到新路径（置 active）。 */
export async function migratePath(
  newPath: string,
  ws: WorkspaceState,
  settings: VaultSettings,
  theme: ThemeSettings,
  pluginData?: Record<string, Record<string, unknown>>,
): Promise<void> {
  setMeta((m) => ({ ...m, path: newPath }))
  await createConfigFolder(ws, settings, theme, pluginData)
}
```

7) `saveSettings`（替换原函数，改窄为 VaultSettings，仅写 3 字段）：

```ts
export function saveSettings(s: VaultSettings): void {
  if (!isConfigActive()) return
  if (settingsTimer) clearTimeout(settingsTimer)
  settingsTimer = setTimeout(() => {
    void _adapter?.writeText(
      joinConfigPath(meta().path, SETTINGS_FILE),
      JSON.stringify(pickVault(s), null, 2),
    )
  }, SAVE_DEBOUNCE_MS)
}
```

8) 新增 `saveTheme` 与插件数据 IO（在 `saveSettings` 之后）：

```ts
let themeTimer: ReturnType<typeof setTimeout> | null = null
export function saveTheme(t: ThemeSettings): void {
  if (!isConfigActive()) return
  if (themeTimer) clearTimeout(themeTimer)
  themeTimer = setTimeout(() => {
    void _adapter?.writeText(
      joinConfigPath(meta().path, THEME_FILE),
      JSON.stringify(t, null, 2),
    )
  }, SAVE_DEBOUNCE_MS)
}

/** 某插件数据文件的 vault 内路径。 */
export function pluginDataPath(id: string): string {
  return joinConfigPath(meta().path, `${PLUGINS_DIR}/${id}/data.json`)
}

export async function readPluginData(id: string): Promise<Record<string, unknown> | null> {
  if (!_adapter) return null
  try {
    const v = JSON.parse(await _adapter.readText(pluginDataPath(id))) as unknown
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      return v as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

const pluginTimers = new Map<string, ReturnType<typeof setTimeout>>()
export function savePluginData(id: string, data: Record<string, unknown>): void {
  if (!isConfigActive()) return
  const prev = pluginTimers.get(id)
  if (prev) clearTimeout(prev)
  pluginTimers.set(
    id,
    setTimeout(() => {
      void (async () => {
        await _adapter?.createDirectory(joinConfigPath(meta().path, `${PLUGINS_DIR}/${id}`))
        await _adapter?.writeText(pluginDataPath(id), JSON.stringify(data, null, 2))
      })()
    }, SAVE_DEBOUNCE_MS),
  )
}
```

> 删掉原 `parseSettings`（已被 `parseVaultSettings` 取代）。`SettingsState` 仍在 import 中保留
> （`createConfigFolder` 旧引用已不需要它，但其他签名可能引用；若 `tsc` 报未使用则从 import 移除）。

- [ ] **Step 5: 运行 vaultConfig 测试，确认通过**

Run: `npx vitest run src/vault/__tests__/vaultConfig.test.ts`
Expected: PASS。

- [ ] **Step 6: 更新 vault/index.ts 调用方（保持编译）**

在 `src/vault/index.ts` 的 `snapshotStores` 返回里补 `theme`，并改 create/migrate 调用：

把 `snapshotStores` 函数体替换为：

```ts
async function snapshotStores(): Promise<{
  ws: import('../stores/types').WorkspaceState
  settings: import('../stores/types').VaultSettings
  theme: import('../stores/types').ThemeSettings
}> {
  const { workspaceStore } = await import('../stores/workspaceStore')
  const { settingsStore } = await import('../stores/settingsStore')
  return {
    ws: {
      layouts: workspaceStore.layouts,
      activeLayoutId: workspaceStore.activeLayoutId,
    },
    settings: {
      pluginStates: settingsStore.pluginStates,
      autoTimestamps: settingsStore.autoTimestamps,
      showOtherFiles: settingsStore.showOtherFiles,
    },
    theme: {
      theme: settingsStore.theme,
      customThemes: settingsStore.customThemes,
      customCSS: settingsStore.customCSS,
    },
  }
}
```

把 `createVaultConfigFromStores` 改为：

```ts
async function createVaultConfigFromStores(): Promise<void> {
  const { ws, settings, theme } = await snapshotStores()
  await vaultConfig.createConfigFolder(ws, settings, theme)
}
```

把 `vaultConfigActions.setPath` 改为：

```ts
  async setPath(path: string): Promise<void> {
    const { ws, settings, theme } = await snapshotStores()
    await vaultConfig.migratePath(path, ws, settings, theme)
  },
```

- [ ] **Step 7: 类型检查 + 全量测试**

Run: `npx tsc --noEmit`
Expected: 无错误。

Run: `npx vitest run`
Expected: 全部 PASS。

- [ ] **Step 8: 提交**

```bash
git add src/stores/types.ts src/vault/vaultConfig.ts src/vault/__tests__/vaultConfig.test.ts src/vault/index.ts
git commit -m "feat(vault): theme.json + 插件数据 IO；settings.json 改窄非主题

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: pluginData 模块（按 id 内存 store + 落盘）

**Files:**
- Create: `src/lib/pluginData.ts`
- Test: `src/lib/__tests__/pluginData.test.ts`

**Interfaces:**
- Consumes: `vaultConfig.savePluginData(id, data)`（Task 3）。
- Produces:
  - `getPluginConfig(id: string): Record<string, unknown>`（store 快照，追踪作用域内响应式；不含 defaults）
  - `setPluginConfig(id: string, patch: Record<string, unknown>): void`
  - `hydratePluginData(id: string, data: Record<string, unknown>): void`（覆盖式注入）

- [ ] **Step 1: 写失败测试**

`src/lib/__tests__/pluginData.test.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSave = vi.fn()
vi.mock('../../vault/vaultConfig', () => ({
  savePluginData: mockSave,
  isConfigActive: () => false,
}))

const { getPluginConfig, setPluginConfig, hydratePluginData } = await import('../pluginData')

describe('pluginData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('未设置时返回空对象', () => {
    expect(getPluginConfig('x-none')).toEqual({})
  })

  it('setPluginConfig 合并写入', () => {
    setPluginConfig('p1', { a: 1 })
    setPluginConfig('p1', { b: 2 })
    expect(getPluginConfig('p1')).toEqual({ a: 1, b: 2 })
  })

  it('hydratePluginData 覆盖式注入', () => {
    setPluginConfig('p2', { a: 1 })
    hydratePluginData('p2', { c: 3 })
    expect(getPluginConfig('p2')).toEqual({ c: 3 })
  })

  it('写入会触发 savePluginData', () => {
    setPluginConfig('p3', { x: 1 })
    expect(mockSave).toHaveBeenCalledWith('p3', { x: 1 })
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/lib/__tests__/pluginData.test.ts`
Expected: FAIL（`../pluginData` 未找到）。

- [ ] **Step 3: 写实现**

`src/lib/pluginData.ts`：

```ts
// 职责：按插件 id 持有响应式内存配置 store，并防抖落盘到 .symbol-notes/plugins/<id>/data.json。
// 插件早于 vault 连接启动 → store 模块级持有、随启停不丢；vault 连接后由 hydratePluginData 注入。
import { createEffect, createRoot } from 'solid-js'
import { createStore, type SetStoreFunction } from 'solid-js/store'
import * as vaultConfig from '../vault/vaultConfig'

interface Entry {
  config: Record<string, unknown>
  setConfig: SetStoreFunction<Record<string, unknown>>
}

const registry = new Map<string, Entry>()

function ensure(id: string): Entry {
  let entry = registry.get(id)
  if (!entry) {
    createRoot(() => {
      const [config, setConfig] = createStore<Record<string, unknown>>({})
      // 落盘 effect：初次 fire 在无 adapter 时被 gate 掉，不产生 hydrate 前脏写。
      createEffect(() => vaultConfig.savePluginData(id, { ...config }))
      entry = { config, setConfig }
    })
    registry.set(id, entry!)
  }
  return entry!
}

/** 读该插件配置快照（追踪作用域内响应式）。不含 defaults，调用方自行 merge。 */
export function getPluginConfig(id: string): Record<string, unknown> {
  return { ...ensure(id).config }
}

/** 合并 patch 进该插件配置。 */
export function setPluginConfig(id: string, patch: Record<string, unknown>): void {
  ensure(id).setConfig((prev) => ({ ...prev, ...patch }))
}

/** 覆盖式注入（data.json → store）。 */
export function hydratePluginData(id: string, data: Record<string, unknown>): void {
  ensure(id).setConfig(() => ({ ...data }))
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/lib/__tests__/pluginData.test.ts`
Expected: PASS（4 个用例）。

- [ ] **Step 5: 类型检查 + 提交**

Run: `npx tsc --noEmit`
Expected: 无错误。

```bash
git add src/lib/pluginData.ts src/lib/__tests__/pluginData.test.ts
git commit -m "feat(plugins): pluginData 模块（按 id 内存 store + 防抖落盘）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: pluginRegistry 配置改走 pluginData

**Files:**
- Modify: `src/lib/pluginRegistry.ts:309-319,397-402`（`loadPlugin` 配置段与 getConfig/setConfig）

**Interfaces:**
- Consumes: `getPluginConfig`/`setPluginConfig` from `src/lib/pluginData`。

> tsc + 既有测试把关；无新单测。

- [ ] **Step 1: 加 import**

在 `src/lib/pluginRegistry.ts` 顶部 import 区加：

```ts
import { getPluginConfig, setPluginConfig } from './pluginData'
```

并删除已不再使用的 `import { loadFromStorage, saveToStorage } from './localStorage'`
（若 `tsc` 报这俩在本文件其他处仍用，则保留该 import；本文件内仅 loadPlugin 用到，应可删）。

- [ ] **Step 2: 删 loadPlugin 内的本地 config store**

把 `loadPlugin` 开头的这段：

```ts
    const saved = loadFromStorage<Record<string, unknown>>(
      `sn-plugin-${def.id}`,
      {},
      (v) => typeof v === 'object' && v !== null,
    )
    const [config, setConfig] = createStore<Record<string, unknown>>(
      saved ?? {},
    )
    createEffect(() => saveToStorage(`sn-plugin-${def.id}`, { ...config }))

    const ctx: PluginContext = {
```

替换为：

```ts
    const ctx: PluginContext = {
```

- [ ] **Step 3: 改 getConfig/setConfig 走 pluginData**

把 `settings` 里的：

```ts
        getConfig<T extends Record<string, unknown>>(defaults: T): T {
          return { ...defaults, ...config } as T
        },
        setConfig(patch) {
          setConfig((prev) => ({ ...prev, ...patch }))
        },
```

替换为：

```ts
        getConfig<T extends Record<string, unknown>>(defaults: T): T {
          return { ...defaults, ...getPluginConfig(def.id) } as T
        },
        setConfig(patch) {
          setPluginConfig(def.id, patch)
        },
```

- [ ] **Step 4: 类型检查 + 全量测试**

Run: `npx tsc --noEmit`
Expected: 无错误（若报 `createStore`/`createEffect` 在本文件不再使用，从顶部 import 移除对应名）。

Run: `npx vitest run`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/pluginRegistry.ts
git commit -m "refactor(plugins): loadPlugin 配置改走 pluginData（去 localStorage）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: 直读消费方迁移到 pluginData

**Files:**
- Modify: `src/plugins/daily-note/openDailyNote.ts:1,16-23`
- Modify: `src/plugins/excalidraw/ExcalidrawViewer.tsx:2,14-21`
- Modify: `src/plugins/excalidraw/index.tsx:95-101`
- Modify: `src/lib/templates/store.ts`

**Interfaces:**
- Consumes: `getPluginConfig`/`setPluginConfig` from `src/lib/pluginData`。

> tsc + build 把关。

- [ ] **Step 1: daily-note/openDailyNote.ts**

把首行 `import { loadFromStorage } from '../../lib/localStorage'` 替换为：

```ts
import { getPluginConfig } from '../../lib/pluginData'
```

把 `dailyConfig()` 函数体替换为：

```ts
function dailyConfig() {
  return { ...DEFAULTS, ...getPluginConfig('daily-note') }
}
```

- [ ] **Step 2: excalidraw/ExcalidrawViewer.tsx**

把 `import { loadFromStorage } from '../../lib/localStorage'` 替换为：

```ts
import { getPluginConfig as getPluginData } from '../../lib/pluginData'
```

把本地 `getPluginConfig()` 函数体替换为：

```ts
function getPluginConfig(): ExcalidrawPluginConfig {
  return {
    ...EXCALIDRAW_DEFAULTS,
    ...getPluginData('excalidraw'),
  } as ExcalidrawPluginConfig
}
```

- [ ] **Step 3: excalidraw/index.tsx**

把首部 `import { loadFromStorage, saveToStorage } from '../../lib/localStorage'` 替换为：

```ts
import { setPluginConfig } from '../../lib/pluginData'
```

把 `updateExcalidrawPluginConfig` 函数体替换为：

```ts
export function updateExcalidrawPluginConfig(patch: Partial<ExcalidrawPluginConfig>): void {
  setPluginConfig('excalidraw', patch as Record<string, unknown>)
}
```

- [ ] **Step 4: templates/store.ts**

把顶部 `import { loadFromStorage, saveToStorage } from '../localStorage'` 替换为：

```ts
import { getPluginConfig, setPluginConfig } from '../pluginData'
```

把这段：

```ts
const KEY = 'sn-templates'
```

…以及：

```ts
const initial = loadFromStorage<{ folder: string }>(
  KEY,
  { folder: 'templates' },
  (v) => typeof v === 'object' && v !== null,
)

const [templatesFolder, setTemplatesFolderSignal] = createSignal(initial.folder)

export { templatesFolder }

export function setTemplatesFolder(folder: string): void {
  setTemplatesFolderSignal(folder)
  saveToStorage(KEY, { folder })
}
```

整体替换为：

```ts
/** 模板文件夹：存 plugins/templates/data.json 的 folder 字段（缺省 'templates'）。 */
export function templatesFolder(): string {
  const v = getPluginConfig('templates').folder
  return typeof v === 'string' ? v : 'templates'
}

export function setTemplatesFolder(folder: string): void {
  setPluginConfig('templates', { folder })
}
```

并删除此文件不再使用的 `import { createSignal } from 'solid-js'`（若 `tsc` 报未使用）。

- [ ] **Step 5: 类型检查 + 全量测试**

Run: `npx tsc --noEmit`
Expected: 无错误。

Run: `npx vitest run`
Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add src/plugins/daily-note/openDailyNote.ts src/plugins/excalidraw/ExcalidrawViewer.tsx src/plugins/excalidraw/index.tsx src/lib/templates/store.ts
git commit -m "refactor(plugins): daily-note/excalidraw/templates 直读改走 pluginData

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: settingsStore 两路持久化 + hydrateTheme

**Files:**
- Modify: `src/stores/settingsStore.ts:17-25`
- Modify: `src/stores/__tests__/settingsStore.test.ts`（追加 hydrate 用例）

**Interfaces:**
- Consumes: `vaultConfig.saveSettings(VaultSettings)` / `vaultConfig.saveTheme(ThemeSettings)`（Task 3）；`applyTheme`/`resolveTheme` from `src/lib/theme`。
- Produces:
  - `hydrateSettings(payload: Partial<VaultSettings>): void`（只动非主题三字段）
  - `hydrateTheme(payload: Partial<ThemeSettings>): void`（写主题三字段，随后同步 `applyTheme`）

- [ ] **Step 1: 写失败测试**

在 `src/stores/__tests__/settingsStore.test.ts` 顶部 import 后加（若已 mock 需合并）：

```ts
import { hydrateSettings, hydrateTheme } from '../settingsStore'
```

追加用例：

```ts
describe('hydrate 分流', () => {
  it('hydrateSettings 只动非主题字段', () => {
    hydrateTheme({ theme: 'nord' })
    hydrateSettings({ autoTimestamps: false })
    expect(settingsStore.autoTimestamps).toBe(false)
    expect(settingsStore.theme).toBe('nord') // 未被 hydrateSettings 覆盖
  })

  it('hydrateTheme 只动主题字段', () => {
    hydrateSettings({ showOtherFiles: false })
    hydrateTheme({ theme: 'light' })
    expect(settingsStore.theme).toBe('light')
    expect(settingsStore.showOtherFiles).toBe(false) // 未被 hydrateTheme 覆盖
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/stores/__tests__/settingsStore.test.ts`
Expected: FAIL（`hydrateTheme` 未导出）。

- [ ] **Step 3: 改 settingsStore**

在 `src/stores/settingsStore.ts`：顶部 import 加 `applyTheme, resolveTheme`：

```ts
import { applyTheme, resolveTheme } from '../lib/theme'
```

并在 types import 中加 `ThemeSettings, VaultSettings`：

```ts
import type { SettingsState, ThemeId, CustomTheme, ThemeMode, ThemeSettings, VaultSettings } from './types'
```

把 `hydrateSettings` 与 `createRoot` 段替换为：

```ts
/** 注入非主题配置（settings.json → store，与默认值合并）。 */
export function hydrateSettings(payload: Partial<VaultSettings>): void {
  setSettingsStore({
    pluginStates: payload.pluginStates ?? defaults.pluginStates,
    autoTimestamps: payload.autoTimestamps ?? defaults.autoTimestamps,
    showOtherFiles: payload.showOtherFiles ?? defaults.showOtherFiles,
  })
}

/** 注入主题配置（theme.json → store），随后同步应用主题（避免揭遮罩前的微任务竞态）。 */
export function hydrateTheme(payload: Partial<ThemeSettings>): void {
  setSettingsStore({
    theme: payload.theme ?? defaults.theme,
    customThemes: payload.customThemes ?? defaults.customThemes,
    customCSS: payload.customCSS ?? defaults.customCSS,
  })
  applyTheme(resolveTheme(settingsStore.theme, settingsStore.customThemes))
}

createRoot(() => {
  // 非主题 → settings.json（vaultConfig.saveSettings 内 gate isConfigActive + 防抖）
  createEffect(() =>
    vaultConfig.saveSettings({
      pluginStates: settingsStore.pluginStates,
      autoTimestamps: settingsStore.autoTimestamps,
      showOtherFiles: settingsStore.showOtherFiles,
    }),
  )
  // 主题 → theme.json
  createEffect(() =>
    vaultConfig.saveTheme({
      theme: settingsStore.theme,
      customThemes: settingsStore.customThemes,
      customCSS: settingsStore.customCSS,
    }),
  )
})
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/stores/__tests__/settingsStore.test.ts`
Expected: PASS。

> 若测试因 `applyTheme` 触碰 DOM（`document` 未定义）报错：在该测试文件顶部
> `vi.mock('../../lib/theme', () => ({ applyTheme: vi.fn(), resolveTheme: vi.fn(() => ({ kind: 'preset', id: 'dark' })) }))`。

- [ ] **Step 5: 类型检查 + 全量测试 + 提交**

Run: `npx tsc --noEmit`
Expected: 无错误。

Run: `npx vitest run`
Expected: 全部 PASS。

```bash
git add src/stores/settingsStore.ts src/stores/__tests__/settingsStore.test.ts
git commit -m "feat(settings): 主题/非主题两路持久化 + hydrateTheme

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: vault 编排接入主题 + 插件数据 hydrate

**Files:**
- Modify: `src/vault/index.ts`（`hydrateVaultConfig` + `createVaultConfigFromStores`/`setPath` 补 pluginData）

**Interfaces:**
- Consumes: `vaultConfig.readConfigFiles()`（含 theme）、`vaultConfig.readPluginData(id)`、`hydrateTheme`、`hydrateSettings`、`getRegisteredPlugins`、`getPluginConfig`。

> tsc + build + 手动把关；无新单测。

- [ ] **Step 1: 改 hydrateVaultConfig 读三份 + 插件数据**

把 `src/vault/index.ts` 的 `hydrateVaultConfig` 替换为：

```ts
/** 读 workspace/settings/theme 注入 store；再并行 hydrate 各插件 data.json。 */
async function hydrateVaultConfig(): Promise<void> {
  const { workspace, settings, theme } = await vaultConfig.readConfigFiles()
  const { hydrateWorkspace } = await import('../stores/workspaceStore')
  const { hydrateSettings, hydrateTheme } = await import('../stores/settingsStore')
  if (workspace) hydrateWorkspace(workspace)
  if (settings) hydrateSettings(settings)
  if (theme) hydrateTheme(theme)
  await hydrateAllPluginData()
}

/** 对所有已注册插件并行读 data.json 并注入内存 store（含未启用插件）。 */
async function hydrateAllPluginData(): Promise<void> {
  const { getRegisteredPlugins } = await import('../lib/pluginRegistry')
  const { hydratePluginData } = await import('../lib/pluginData')
  await Promise.all(
    getRegisteredPlugins().map(async (p) => {
      const data = await vaultConfig.readPluginData(p.id)
      if (data) hydratePluginData(p.id, data)
    }),
  )
}
```

> 原 `hydrateVaultConfig` 里 `if (!workspace && !settings) return` 的早退去掉（现按字段各自判断）。

- [ ] **Step 2: 让 create/migrate 带上插件数据快照**

新增一个收集器，并在 create/setPath 调用处带上。把 `createVaultConfigFromStores` 替换为：

```ts
/** 收集各已注册插件当前内存配置（非空者）作为创建配置文件夹的种子。 */
async function snapshotPluginData(): Promise<Record<string, Record<string, unknown>>> {
  const { getRegisteredPlugins } = await import('../lib/pluginRegistry')
  const { getPluginConfig } = await import('../lib/pluginData')
  const out: Record<string, Record<string, unknown>> = {}
  for (const p of getRegisteredPlugins()) {
    const cfg = getPluginConfig(p.id)
    if (Object.keys(cfg).length > 0) out[p.id] = cfg
  }
  return out
}

async function createVaultConfigFromStores(): Promise<void> {
  const { ws, settings, theme } = await snapshotStores()
  const pluginData = await snapshotPluginData()
  await vaultConfig.createConfigFolder(ws, settings, theme, pluginData)
}
```

把 `vaultConfigActions.setPath` 替换为：

```ts
  async setPath(path: string): Promise<void> {
    const { ws, settings, theme } = await snapshotStores()
    const pluginData = await snapshotPluginData()
    await vaultConfig.migratePath(path, ws, settings, theme, pluginData)
  },
```

- [ ] **Step 3: 类型检查 + 全量测试**

Run: `npx tsc --noEmit`
Expected: 无错误。

Run: `npx vitest run`
Expected: 全部 PASS。

- [ ] **Step 4: 提交**

```bash
git add src/vault/index.ts
git commit -m "feat(vault): hydrate theme.json + 各插件 data.json；create/migrate 带插件快照

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: 构建校验 + 手动回归

**Files:** 无代码改动（验证）。

- [ ] **Step 1: 生产构建 + 全量测试**

Run: `npm run build && npx vitest run`
Expected: 均无错误。

- [ ] **Step 2: 手动验证（`npm run dev`，逐条勾选）**

- [ ] 任意主题刷新：loading 遮罩首帧即正确颜色（无闪）；揭遮罩后内容主题正确、无跳变。
- [ ] 切到 nord/浅色/自定义后刷新：遮罩颜色随之更新。
- [ ] `theme.json` 删除/写坏：主题回落默认值不报错；改一次主题后生成干净 theme.json。
- [ ] 新建配置文件夹：生成 workspace.json + settings.json（无主题字段）+ theme.json + 各非空 plugins/<id>/data.json。
- [ ] 改主题 → theme.json 落盘；改插件开关/显示设置 → settings.json 落盘；两者互不串写。
- [ ] 改 daily-note 文件夹 / excalidraw 网格 / templates 模板夹 → 对应 plugins/<id>/data.json 落盘；刷新后值保留、相关功能读到正确配置。
- [ ] declined 状态 vault：插件配置仅内存、刷新丢失，不报错。

- [ ] **Step 3: 如有文档/小修，提交；否则跳过**

```bash
git add -A
git commit -m "test(vault): 主题文件 + 插件数据迁移手动回归通过

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
