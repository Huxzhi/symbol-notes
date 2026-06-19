# Vault 本地配置文件夹（`.symbol-notes/`）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 workspace 与 settings 从全局 `localStorage` 改为按 vault 存储在顶层隐藏文件夹 `.symbol-notes/`，实现 per-vault 配置；打开 vault 时自动读取，缺失则提示创建，拒绝则记住。

**Architecture:** 新增 `src/vault/vaultConfig.ts` 协调层，独占配置 IO（经 `FileSystemAdapter` 直读直写，绕开 `io.ts` 索引层）与 vault 外的 meta（IndexedDB via `idb-keyval`）。两个 store 改为只从默认值初始化、持久化副作用从 `saveToStorage` 改成 `vaultConfig.save*`，并新增 hydrate 入口。`vault/index.ts` 的 `openVault`/`restoreVault` 接入「探测 + 提示 + hydrate」编排，复用 `modalStore` 弹窗。

**Tech Stack:** SolidJS（`createSignal`/`createStore`/`createEffect`）、TypeScript、`idb-keyval`、File System Access API（经现有 `LocalAdapter`）、Vitest（node 环境，仅测纯函数）。

## Global Constraints

- 代码注释、commit message、UI 文案用中文；变量/类型名用英文。
- 应用是 SolidJS，不要写 React（依赖里的 react 仅为 excalidraw）。
- 纯前端，无后端；配置数据 = vault 本地文件 + IndexedDB meta。
- 默认配置文件夹名 `.symbol-notes`（点开头，扫描器 `if (name.startsWith('.')) continue` 自动隐藏）。
- 配置文件夹是唯一真相来源；两个 store **不再读写 localStorage**；**不迁移**旧 `sn-workspace`/`sn-settings`（开发阶段丢弃）。
- 拒绝创建的决定按 vault 记住（meta `status: 'declined'`），不再反复弹窗。
- 提交前两道关：`npm run build`（含 tsc）与 `npx vitest run` 都要通过。
- commit 信息遵循 `type(scope): 描述`。

---

### Task 1: vaultConfig 纯函数（路径拼接 + payload 校验）

新建模块并先落地可单测的纯函数：配置文件相对路径拼接、workspace/settings 的形状校验。

**Files:**
- Create: `src/vault/vaultConfig.ts`
- Test: `src/vault/__tests__/vaultConfig.test.ts`

**Interfaces:**
- Consumes: `WorkspaceState`、`SettingsState`（`src/stores/types.ts`，type-only import）。
- Produces:
  - `joinConfigPath(base: string, file: string): string`
  - `validateWorkspace(v: unknown): v is WorkspaceState`
  - `parseSettings(v: unknown): Partial<SettingsState> | null`
  - 常量 `DEFAULT_CONFIG_PATH = '.symbol-notes'`

- [ ] **Step 1: 写失败的测试**

`src/vault/__tests__/vaultConfig.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import {
  joinConfigPath,
  validateWorkspace,
  parseSettings,
  DEFAULT_CONFIG_PATH,
} from '../vaultConfig'

describe('joinConfigPath', () => {
  it('拼接 base 与文件名', () => {
    expect(joinConfigPath('.symbol-notes', 'workspace.json')).toBe('.symbol-notes/workspace.json')
  })
  it('去掉首尾多余斜杠', () => {
    expect(joinConfigPath('/foo/bar/', 'settings.json')).toBe('foo/bar/settings.json')
  })
  it('base 为空时只返回文件名', () => {
    expect(joinConfigPath('', 'x.json')).toBe('x.json')
  })
})

describe('validateWorkspace', () => {
  it('接受合法形状', () => {
    expect(validateWorkspace({ layouts: {}, activeLayoutId: 'a' })).toBe(true)
  })
  it('缺少 activeLayoutId 时拒绝', () => {
    expect(validateWorkspace({ layouts: {} })).toBe(false)
  })
  it('layouts 是数组时拒绝', () => {
    expect(validateWorkspace({ layouts: [], activeLayoutId: 'a' })).toBe(false)
  })
  it('null 时拒绝', () => {
    expect(validateWorkspace(null)).toBe(false)
  })
})

describe('parseSettings', () => {
  it('返回对象本身', () => {
    expect(parseSettings({ theme: 'dark' })).toEqual({ theme: 'dark' })
  })
  it('数组时返回 null', () => {
    expect(parseSettings([])).toBeNull()
  })
  it('null 时返回 null', () => {
    expect(parseSettings(null)).toBeNull()
  })
})

describe('DEFAULT_CONFIG_PATH', () => {
  it('默认 .symbol-notes', () => {
    expect(DEFAULT_CONFIG_PATH).toBe('.symbol-notes')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/vault/__tests__/vaultConfig.test.ts`
Expected: FAIL（`Cannot find module '../vaultConfig'` 或导出未定义）。

- [ ] **Step 3: 写最小实现**

`src/vault/vaultConfig.ts`：

```ts
// 职责：vault 本地配置（.symbol-notes/）的唯一协调层。
// 配置 IO 经 FileSystemAdapter 直读直写，绕开 io.ts 的 contentCache 与索引层；
// vault 外的 meta（路径 / 是否拒绝）存 IndexedDB。
import type { SettingsState, WorkspaceState } from '../stores/types'

export const DEFAULT_CONFIG_PATH = '.symbol-notes'

/** 把相对 base 与配置文件名拼成 vault 内路径；去掉首尾多余斜杠。 */
export function joinConfigPath(base: string, file: string): string {
  const b = base.replace(/^\/+|\/+$/g, '')
  return b ? `${b}/${file}` : file
}

/** workspace.json 形状校验（与原 sn-workspace 校验一致）。 */
export function validateWorkspace(v: unknown): v is WorkspaceState {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.layouts === 'object' &&
    o.layouts !== null &&
    !Array.isArray(o.layouts) &&
    typeof o.activeLayoutId === 'string'
  )
}

/** settings.json 宽松解析：是非数组对象即返回（按字段与默认值合并由 store 负责）。 */
export function parseSettings(v: unknown): Partial<SettingsState> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  return v as Partial<SettingsState>
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/vault/__tests__/vaultConfig.test.ts`
Expected: PASS（全部 case 绿）。

- [ ] **Step 5: 提交**

```bash
git add src/vault/vaultConfig.ts src/vault/__tests__/vaultConfig.test.ts
git commit -m "feat(vault): vaultConfig 纯函数（路径拼接 + payload 校验）"
```

---

### Task 2: vaultConfig 状态与 IO（meta + 读写 + 防抖落盘）

在同一模块补齐有状态部分：响应式 meta 信号、adapter 注入、读/写配置文件、防抖保存。这些依赖浏览器 API（adapter / idb-keyval），不写单测（与仓库约定一致），靠 `npm run build` 类型把关。

**Files:**
- Modify: `src/vault/vaultConfig.ts`

**Interfaces:**
- Consumes: `FileSystemAdapter`（`src/vault/fs/types.ts`）；`get`/`set`（`idb-keyval`）；`createSignal`（solid-js）；Task 1 的 `joinConfigPath`/`validateWorkspace`/`parseSettings`/`DEFAULT_CONFIG_PATH`。
- Produces:
  - `type VaultConfigStatus = 'active' | 'declined' | 'unknown'`
  - `interface VaultConfigMeta { path: string; status: VaultConfigStatus }`
  - `vaultConfigMeta: () => VaultConfigMeta`（响应式 accessor，供 UI）
  - `setAdapter(a: FileSystemAdapter | null): void`
  - `metaStatus(): VaultConfigStatus`、`configPath(): string`、`isConfigActive(): boolean`
  - `loadMeta(): Promise<void>`、`resetMeta(): Promise<void>`、`decline(): Promise<void>`、`markActive(): Promise<void>`
  - `configFolderExists(): Promise<boolean>`
  - `readConfigFiles(): Promise<{ workspace: WorkspaceState | null; settings: Partial<SettingsState> | null }>`
  - `createConfigFolder(ws: WorkspaceState, settings: SettingsState): Promise<void>`
  - `migratePath(newPath: string, ws: WorkspaceState, settings: SettingsState): Promise<void>`
  - `saveWorkspace(ws: WorkspaceState): void`、`saveSettings(s: SettingsState): void`

- [ ] **Step 1: 在文件顶部补 import 与模块状态**

把 `src/vault/vaultConfig.ts` 顶部的注释块之后、`export const DEFAULT_CONFIG_PATH` 之前，插入：

```ts
import { createSignal } from 'solid-js'
import { get, set } from 'idb-keyval'
import type { FileSystemAdapter } from './fs/types'
```

并把 `import type { SettingsState, WorkspaceState } from '../stores/types'` 保留在最上方（已存在）。

然后在 `DEFAULT_CONFIG_PATH` 常量**下方**追加：

```ts
const META_KEY = 'sn-vault-config-meta'
const WORKSPACE_FILE = 'workspace.json'
const SETTINGS_FILE = 'settings.json'
const SAVE_DEBOUNCE_MS = 800

export type VaultConfigStatus = 'active' | 'declined' | 'unknown'
export interface VaultConfigMeta {
  path: string
  status: VaultConfigStatus
}

const [meta, setMeta] = createSignal<VaultConfigMeta>({
  path: DEFAULT_CONFIG_PATH,
  status: 'unknown',
})
/** 响应式 meta（供设置页读取状态/路径）。 */
export const vaultConfigMeta = meta

let _adapter: FileSystemAdapter | null = null

export function setAdapter(a: FileSystemAdapter | null): void {
  _adapter = a
}
export function metaStatus(): VaultConfigStatus {
  return meta().status
}
export function configPath(): string {
  return meta().path
}
export function isConfigActive(): boolean {
  return meta().status === 'active' && _adapter !== null
}
```

- [ ] **Step 2: 追加 meta 持久化与状态迁移函数**

在文件**末尾**追加：

```ts
async function persistMeta(): Promise<void> {
  await set(META_KEY, meta())
}

/** restore 路径：从 IndexedDB 读回 meta（非法值回退 unknown/默认路径）。 */
export async function loadMeta(): Promise<void> {
  const m = await get<VaultConfigMeta>(META_KEY)
  if (
    m &&
    typeof m.path === 'string' &&
    (m.status === 'active' || m.status === 'declined' || m.status === 'unknown')
  ) {
    setMeta(m)
  } else {
    setMeta({ path: DEFAULT_CONFIG_PATH, status: 'unknown' })
  }
}

/** open 路径：选了新 vault → 重置为 unknown + 默认路径。 */
export async function resetMeta(): Promise<void> {
  setMeta({ path: DEFAULT_CONFIG_PATH, status: 'unknown' })
  await persistMeta()
}

export async function decline(): Promise<void> {
  setMeta((m) => ({ ...m, status: 'declined' }))
  await persistMeta()
}

export async function markActive(): Promise<void> {
  setMeta((m) => ({ ...m, status: 'active' }))
  await persistMeta()
}
```

- [ ] **Step 3: 追加配置文件读取函数**

在文件末尾追加：

```ts
/** 探测：settings.json 能读到即认为配置文件夹存在。 */
export async function configFolderExists(): Promise<boolean> {
  if (!_adapter) return false
  try {
    await _adapter.readText(joinConfigPath(meta().path, SETTINGS_FILE))
    return true
  } catch {
    return false
  }
}

/** 读两份配置；缺失或解析失败的那份返回 null（不抛）。 */
export async function readConfigFiles(): Promise<{
  workspace: WorkspaceState | null
  settings: Partial<SettingsState> | null
}> {
  if (!_adapter) return { workspace: null, settings: null }
  const path = meta().path
  let workspace: WorkspaceState | null = null
  let settings: Partial<SettingsState> | null = null
  try {
    const raw = await _adapter.readText(joinConfigPath(path, WORKSPACE_FILE))
    const parsed = JSON.parse(raw) as unknown
    if (validateWorkspace(parsed)) workspace = parsed
  } catch {
    /* 缺失/损坏 → null */
  }
  try {
    const raw = await _adapter.readText(joinConfigPath(path, SETTINGS_FILE))
    settings = parseSettings(JSON.parse(raw) as unknown)
  } catch {
    /* 缺失/损坏 → null */
  }
  return { workspace, settings }
}
```

- [ ] **Step 4: 追加创建 / 迁移 / 防抖保存函数**

在文件末尾追加：

```ts
/** 创建配置文件夹并写入种子内容（当前 store 状态），置 active。 */
export async function createConfigFolder(
  ws: WorkspaceState,
  settings: SettingsState,
): Promise<void> {
  if (!_adapter) return
  const path = meta().path
  await _adapter.createDirectory(path)
  await _adapter.writeText(joinConfigPath(path, WORKSPACE_FILE), JSON.stringify(ws, null, 2))
  await _adapter.writeText(joinConfigPath(path, SETTINGS_FILE), JSON.stringify(settings, null, 2))
  setMeta((m) => ({ ...m, status: 'active' }))
  await persistMeta()
}

/** 改相对路径并把当前配置写到新路径（置 active）。 */
export async function migratePath(
  newPath: string,
  ws: WorkspaceState,
  settings: SettingsState,
): Promise<void> {
  setMeta((m) => ({ ...m, path: newPath }))
  await createConfigFolder(ws, settings)
}

let wsTimer: ReturnType<typeof setTimeout> | null = null
let settingsTimer: ReturnType<typeof setTimeout> | null = null

export function saveWorkspace(ws: WorkspaceState): void {
  if (!isConfigActive()) return
  if (wsTimer) clearTimeout(wsTimer)
  wsTimer = setTimeout(() => {
    void _adapter?.writeText(
      joinConfigPath(meta().path, WORKSPACE_FILE),
      JSON.stringify(ws, null, 2),
    )
  }, SAVE_DEBOUNCE_MS)
}

export function saveSettings(s: SettingsState): void {
  if (!isConfigActive()) return
  if (settingsTimer) clearTimeout(settingsTimer)
  settingsTimer = setTimeout(() => {
    void _adapter?.writeText(
      joinConfigPath(meta().path, SETTINGS_FILE),
      JSON.stringify(s, null, 2),
    )
  }, SAVE_DEBOUNCE_MS)
}
```

- [ ] **Step 5: 类型检查 + 测试**

Run: `npm run build && npx vitest run src/vault/__tests__/vaultConfig.test.ts`
Expected: build 通过（tsc 无错），Task 1 测试仍 PASS。

- [ ] **Step 6: 提交**

```bash
git add src/vault/vaultConfig.ts
git commit -m "feat(vault): vaultConfig 状态与 IO（meta + 读写 + 防抖落盘）"
```

---

### Task 3: 两个 store 改为 vault 持久化 + hydrate 入口

`settingsStore` / `workspaceStore` 不再读写 localStorage：只从默认值初始化，持久化副作用改调 `vaultConfig.save*`，并各暴露一个 hydrate 函数。

**Files:**
- Modify: `src/stores/settingsStore.ts`
- Modify: `src/stores/workspaceStore.ts`

**Interfaces:**
- Consumes: `vaultConfig.saveSettings` / `vaultConfig.saveWorkspace`（Task 2）。
- Produces:
  - `hydrateSettings(payload: Partial<SettingsState>): void`（`settingsStore.ts` 具名导出）
  - `hydrateWorkspace(payload: WorkspaceState): void`（`workspaceStore.ts` 具名导出）

- [ ] **Step 1: 改 `settingsStore.ts` 的 import 与初始化**

把开头的：

```ts
import { createRoot, createEffect } from 'solid-js'
import { createStore } from 'solid-js/store'
import { loadFromStorage, saveToStorage } from '../lib/localStorage'
import type { SettingsState, ThemeId, CustomTheme, ThemeMode } from './types'
```

改为：

```ts
import { createRoot, createEffect } from 'solid-js'
import { createStore } from 'solid-js/store'
import * as vaultConfig from '../vault/vaultConfig'
import type { SettingsState, ThemeId, CustomTheme, ThemeMode } from './types'
```

把：

```ts
const [settingsStore, setSettingsStore] = createStore<SettingsState>({
  ...defaults,
  ...loadFromStorage<Partial<SettingsState>>('sn-settings', defaults, (v) => typeof v === 'object' && v !== null),
})

createRoot(() => {
  createEffect(() => saveToStorage('sn-settings', { ...settingsStore }))
})
```

改为：

```ts
const [settingsStore, setSettingsStore] = createStore<SettingsState>({ ...defaults })

/** 由 vaultConfig 读到磁盘配置后注入（与默认值合并，容忍缺字段）。 */
export function hydrateSettings(payload: Partial<SettingsState>): void {
  setSettingsStore({ ...defaults, ...payload })
}

createRoot(() => {
  // 仅在配置文件夹激活时落盘；否则仅内存（vaultConfig.saveSettings 内部已 gate）。
  createEffect(() => vaultConfig.saveSettings({ ...settingsStore }))
})
```

- [ ] **Step 2: 改 `workspaceStore.ts` 的 import**

把开头第 3 行：

```ts
import { loadFromStorage, saveToStorage } from '../lib/localStorage'
```

改为：

```ts
import * as vaultConfig from '../vault/vaultConfig'
```

- [ ] **Step 3: 改 `workspaceStore.ts` 的初始化与持久化**

把：

```ts
const savedWs = loadFromStorage<WorkspaceState>(
  'sn-workspace',
  defaultWorkspace,
  (v) =>
    typeof v === 'object' && v !== null &&
    typeof (v as Record<string, unknown>).layouts === 'object' &&
    !Array.isArray((v as Record<string, unknown>).layouts) &&
    typeof (v as Record<string, unknown>).activeLayoutId === 'string',
)

const [workspaceStore, setWorkspaceStore] = createStore<WorkspaceState>({
  layouts: savedWs.layouts,
  activeLayoutId: savedWs.activeLayoutId,
})

createRoot(() => {
  createEffect(() =>
    saveToStorage('sn-workspace', {
      layouts: workspaceStore.layouts,
      activeLayoutId: workspaceStore.activeLayoutId,
    }),
  )
})
```

改为：

```ts
const [workspaceStore, setWorkspaceStore] = createStore<WorkspaceState>({
  layouts: defaultWorkspace.layouts,
  activeLayoutId: defaultWorkspace.activeLayoutId,
})

/** 由 vaultConfig 读到磁盘 workspace 后注入（覆盖式）。 */
export function hydrateWorkspace(payload: WorkspaceState): void {
  setWorkspaceStore({
    layouts: payload.layouts,
    activeLayoutId: payload.activeLayoutId,
  })
}

createRoot(() => {
  // 仅在配置文件夹激活时落盘；否则仅内存。
  createEffect(() =>
    vaultConfig.saveWorkspace({
      layouts: workspaceStore.layouts,
      activeLayoutId: workspaceStore.activeLayoutId,
    }),
  )
})
```

- [ ] **Step 4: 类型检查 + 测试**

Run: `npm run build && npx vitest run`
Expected: build 通过；全部测试 PASS（含 `settingsStore.test.ts`）。

> 若 `src/stores/__tests__/settingsStore.test.ts` 因移除 localStorage 持久化而失败：该测试若断言「写入 localStorage」，改为断言 `settingsActions` 修改后 `settingsStore` 字段变化即可（不再校验 localStorage）；若仅测 actions 逻辑则无需改动。先读该测试再决定。

- [ ] **Step 5: 提交**

```bash
git add src/stores/settingsStore.ts src/stores/workspaceStore.ts
git commit -m "refactor(stores): workspace/settings 改为 vault 持久化 + hydrate 入口"
```

---

### Task 4: index.ts 接入「探测 + 提示 + hydrate」编排

`openVault`/`restoreVault` 连上 vaultConfig：注入 adapter、读/重置 meta、扫描后探测配置文件夹并 hydrate 或弹窗提示创建。并导出供设置页用的 actions。

**Files:**
- Modify: `src/vault/index.ts`

**Interfaces:**
- Consumes: `vaultConfig.*`（Task 2）；`hydrateWorkspace`/`hydrateSettings`（Task 3，经动态 import）；`showModal`/`closeModal`（`src/stores/modalStore.ts`）；`workspaceStore`/`settingsStore`（动态 import 取快照）。
- Produces（从 `src/vault/index.ts` 导出，供 Settings 用）：
  - `vaultConfigMeta`（re-export Task 2 的响应式 accessor）
  - `vaultConfigActions: { enable(): Promise<void>; setPath(path: string): Promise<void> }`

- [ ] **Step 1: 加 import**

在 `src/vault/index.ts` 的 import 区追加：

```ts
import * as vaultConfig from './vaultConfig'
import { showModal, closeModal } from '../stores/modalStore'
```

- [ ] **Step 2: 改 `openVault` / `restoreVault`**

把现有：

```ts
export async function openVault(): Promise<void> {
  clearEmbedUrlCache()
  const adapter = await LocalAdapter.open()
  initFileIO(adapter)
  setVaultFs(adapter)
  const { workspaceActions } = await import('../stores/workspaceStore')
  workspaceActions.clearAllLeaves()
  await scanAndIndex()
}

export async function restoreVault(): Promise<void> {
  const adapter = await LocalAdapter.restore()
  if (!adapter) return
  initFileIO(adapter)
  setVaultFs(adapter)
  await scanAndIndex()
}
```

改为：

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
  await scanAndIndex()
  await connectVaultConfig()
}

export async function restoreVault(): Promise<void> {
  const adapter = await LocalAdapter.restore()
  if (!adapter) return
  initFileIO(adapter)
  setVaultFs(adapter)
  vaultConfig.setAdapter(adapter)
  await vaultConfig.loadMeta()
  await scanAndIndex()
  await connectVaultConfig()
}
```

- [ ] **Step 3: 加编排辅助函数**

在 `restoreVault` 之后、`// ── Orchestration ──` 注释之前（或紧跟 restoreVault）插入：

```ts
// ── Vault 配置编排 ─────────────────────────────────────────────────────────────

/** 读两份配置注入 store；任一缺失则跳过那份（保持默认）。 */
async function hydrateVaultConfig(): Promise<void> {
  const { workspace, settings } = await vaultConfig.readConfigFiles()
  if (!workspace && !settings) return
  const { hydrateWorkspace } = await import('../stores/workspaceStore')
  const { hydrateSettings } = await import('../stores/settingsStore')
  if (workspace) hydrateWorkspace(workspace)
  if (settings) hydrateSettings(settings)
}

/** 取当前 store 状态作为创建配置文件夹的种子。 */
async function snapshotStores(): Promise<{
  ws: import('../stores/types').WorkspaceState
  settings: import('../stores/types').SettingsState
}> {
  const { workspaceStore } = await import('../stores/workspaceStore')
  const { settingsStore } = await import('../stores/settingsStore')
  return {
    ws: {
      layouts: workspaceStore.layouts,
      activeLayoutId: workspaceStore.activeLayoutId,
    },
    settings: { ...settingsStore },
  }
}

/** 用当前 store 状态创建配置文件夹。 */
async function createVaultConfigFromStores(): Promise<void> {
  const { ws, settings } = await snapshotStores()
  await vaultConfig.createConfigFolder(ws, settings)
}

/** 弹窗询问是否创建配置文件夹。 */
function promptCreateVaultConfig(): void {
  showModal({
    title: '配置文件夹',
    message: `在此 vault 顶层创建 ${vaultConfig.configPath()}/ 用于保存布局与设置？`,
    buttons: [
      {
        label: '不创建',
        variant: 'ghost',
        onClick: () => {
          closeModal()
          void vaultConfig.decline()
        },
      },
      {
        label: '创建',
        variant: 'primary',
        onClick: () => {
          closeModal()
          void createVaultConfigFromStores()
        },
      },
    ],
  })
}

/** 扫描后接入配置：active→读盘；declined→不动；unknown→探测，存在则读盘否则提示。 */
async function connectVaultConfig(): Promise<void> {
  const status = vaultConfig.metaStatus()
  if (status === 'declined') return
  if (status === 'active') {
    await hydrateVaultConfig()
    return
  }
  // unknown
  if (await vaultConfig.configFolderExists()) {
    await vaultConfig.markActive()
    await hydrateVaultConfig()
    return
  }
  promptCreateVaultConfig()
}
```

- [ ] **Step 4: 导出 re-export 与 actions**

在 `src/vault/index.ts` 末尾的 `// ── Re-exports ──` 区追加：

```ts
export { vaultConfigMeta } from './vaultConfig'

export const vaultConfigActions = {
  /** 设置页「启用配置文件夹」：用当前 store 状态创建。 */
  async enable(): Promise<void> {
    await createVaultConfigFromStores()
  },
  /** 设置页改相对路径：迁移并写到新路径。 */
  async setPath(path: string): Promise<void> {
    const { ws, settings } = await snapshotStores()
    await vaultConfig.migratePath(path, ws, settings)
  },
}
```

- [ ] **Step 5: 类型检查 + 测试**

Run: `npm run build && npx vitest run`
Expected: build 通过；全部测试 PASS。

- [ ] **Step 6: 提交**

```bash
git add src/vault/index.ts
git commit -m "feat(vault): openVault/restoreVault 接入配置探测/提示/hydrate"
```

---

### Task 5: 设置页「vault 配置」一节 + 端到端验证

在 `Settings.tsx` 新增一节：显示当前状态/路径、改相对路径、declined/未启用时提供「启用」按钮。然后全量验证 + 手动冒烟。

**Files:**
- Modify: `src/components/Settings.tsx`

**Interfaces:**
- Consumes: `vaultConfigMeta`、`vaultConfigActions`（Task 4，从 `../vault`）；`vaultFs`（`../vault`，判断是否有 vault 打开）。

- [ ] **Step 1: 加 import 与新区段定义**

在 `src/components/Settings.tsx` 顶部 import 区追加：

```ts
import { vaultConfigMeta, vaultConfigActions, vaultFs } from "../vault";
```

把：

```ts
const BUILTIN_SECTIONS = [
  { id: "appearance", label: "外观" },
  { id: "files", label: "文件" },
  { id: "shortcuts", label: "快捷键" },
  { id: "plugins", label: "插件" },
];
```

改为：

```ts
const BUILTIN_SECTIONS = [
  { id: "appearance", label: "外观" },
  { id: "files", label: "文件" },
  { id: "vault", label: "Vault 配置" },
  { id: "shortcuts", label: "快捷键" },
  { id: "plugins", label: "插件" },
];
```

- [ ] **Step 2: 加本地草稿信号**

在 `Settings` 组件内、`const [draftShowOtherFiles, ...]` 之后追加：

```ts
  const [draftConfigPath, setDraftConfigPath] = createSignal(
    vaultConfigMeta().path,
  );
  const configStatusLabel = () => {
    if (!vaultFs()) return "未打开 vault";
    switch (vaultConfigMeta().status) {
      case "active":
        return "已启用";
      case "declined":
        return "已拒绝（仅内存，不落盘）";
      default:
        return "未启用";
    }
  };
```

- [ ] **Step 3: 加 `vault` 区段 Match**

在 `<Match when={section() === "files"}>...</Match>` 之后、`<Match when={section() === "shortcuts"}>` 之前插入：

```tsx
              <Match when={section() === "vault"}>
                <div class="text-[10px] t-3 mb-3 uppercase tracking-widest">
                  Vault 配置文件夹
                </div>
                <div class="text-[12px] t-base mb-2">
                  状态：<span class="t-2">{configStatusLabel()}</span>
                </div>
                <div class="text-[11px] t-3 mb-4 leading-relaxed">
                  布局与设置保存在 vault 顶层的隐藏文件夹中（默认{" "}
                  <code class="bg-(--bg-hover) px-1 rounded text-[10px]">
                    .symbol-notes
                  </code>
                  ）。点开头的文件夹不会出现在文件树中。
                </div>

                <div class="text-[10px] t-3 mb-1.5 uppercase tracking-widest">
                  相对路径
                </div>
                <div class="flex items-center gap-2 mb-4">
                  <input
                    class="flex-1 bg-(--bg-base) border border-(--border) rounded px-2 py-1 text-[12px] t-base font-mono outline-none focus:border-(--accent)"
                    value={draftConfigPath()}
                    disabled={!vaultFs()}
                    onInput={(e) => setDraftConfigPath(e.currentTarget.value)}
                  />
                  <button
                    class="px-3 py-1 text-[12px] rounded bg-(--accent) text-white cursor-pointer hover:bg-(--accent-2) transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={!vaultFs() || !draftConfigPath().trim()}
                    onClick={() =>
                      void vaultConfigActions.setPath(draftConfigPath().trim())
                    }
                  >
                    应用路径
                  </button>
                </div>

                <Show when={vaultFs() && vaultConfigMeta().status !== "active"}>
                  <button
                    class="px-3 py-1.5 text-[12px] rounded border border-(--border) t-2 cursor-pointer hover:border-(--accent) hover:text-(--accent) transition-colors"
                    onClick={() => void vaultConfigActions.enable()}
                  >
                    启用配置文件夹
                  </button>
                </Show>
              </Match>
```

- [ ] **Step 4: 类型检查 + 全量测试**

Run: `npm run build && npx vitest run`
Expected: build 通过；全部测试 PASS。

- [ ] **Step 5: 手动冒烟（开发服务器）**

Run: `npm run dev`，在浏览器验证：
1. 选一个**没有** `.symbol-notes/` 的文件夹 → 弹出「创建配置文件夹？」。点「创建」→ 文件夹内出现 `.symbol-notes/workspace.json` 与 `settings.json`；改主题/拖动布局，约 1 秒后文件内容更新。
2. 刷新页面（触发 `restoreVault`）→ 不再弹窗，主题/布局自动恢复。
3. 另选一个文件夹点「不创建」→ 改设置不写盘；刷新该 vault 不再弹窗（记住拒绝）。设置页「Vault 配置」显示「已拒绝」，点「启用配置文件夹」→ 生成文件、状态变「已启用」。
4. 文件树中看不到 `.symbol-notes`。

Expected: 上述行为全部符合。如有问题，记录后回到相关 Task 修复。

- [ ] **Step 6: 提交**

```bash
git add src/components/Settings.tsx
git commit -m "feat(settings): 新增「Vault 配置」一节（状态/路径/启用）"
```

---

## Self-Review

**Spec coverage：**
- 隐藏文件夹存 workspace+settings → Task 2 `createConfigFolder` 写 `workspace.json`/`settings.json`；Task 3 两个 store 落盘。✓
- 打开 vault 自动读取 → Task 4 `connectVaultConfig` active/exists 分支 `hydrateVaultConfig`。✓
- 不存在则提示创建 → Task 4 `promptCreateVaultConfig`。✓
- 拒绝则仅内存不落盘 → Task 2 `saveWorkspace/saveSettings` 的 `isConfigActive()` gate；Task 4 `decline`。✓
- 记住拒绝（含开机恢复） → meta `declined` 持久化（Task 2）+ `restoreVault → loadMeta`（Task 4）。✓
- 设置页改相对路径 → Task 4 `vaultConfigActions.setPath` + Task 5 输入框。✓
- vault 为唯一真相、不读写 localStorage、不迁移旧数据 → Task 3 移除 `loadFromStorage`/`saveToStorage`。✓
- 默认 `.symbol-notes` 点开头自动隐藏 → `DEFAULT_CONFIG_PATH`（Task 1）+ 现有扫描器跳过 dotfile（无需改）。✓
- 纯函数单测 → Task 1。✓
- 错误处理（解析失败回退默认） → Task 2 `readConfigFiles` try/catch 返回 null。✓

**Placeholder scan：** 无 TBD/TODO；每个改代码的步骤都给了完整代码。✓

**Type consistency：** `hydrateSettings(Partial<SettingsState>)` / `hydrateWorkspace(WorkspaceState)` 在 Task 3 定义、Task 4 调用一致；`saveWorkspace(WorkspaceState)`/`saveSettings(SettingsState)` 在 Task 2 定义、Task 3 调用一致；`createConfigFolder(ws, settings)`/`migratePath(path, ws, settings)` 签名在 Task 2 定义、Task 4 调用一致；`vaultConfigMeta`/`vaultConfigActions` 在 Task 4 导出、Task 5 消费一致。✓

**已知限制（spec 已记）：** 非点开头的自定义路径会出现在文件树；重新 `open()` 曾 declined 的同一文件夹会重置 meta 重新提示。均为可接受范围，不在本计划处理。
