# Vault 配置驱动的启动时序 + 主题防闪烁 — 设计稿

日期：2026-06-19

## 1. 背景与目标

### 现状问题

- `scanAndIndex()`（`src/vault/index.ts`）在「阶段1」扫描完成、把仅含 stat 的
  `FileMeta` 入 store、建好 `fileTree` 后，**立即** `endScanOverlay()` 撤掉全屏遮罩。
  而读取 `.symbol-notes/` 配置并 hydrate 的 `connectVaultConfig()` 跑在
  `await scanAndIndex()` **之后**——即所有后台解析（阶段2/3）也跑完之后。
  结果：用户先看到默认布局 + 默认深色主题，几秒后布局重排 + 主题跳变。
- 主题首帧由 CSS `:root[data-theme="dark"]` 兜底；真实主题存于 vault 的
  `settings.json`，要等「FS 句柄恢复 → 扫描 → 读配置 → hydrateSettings」才生效，
  因此存在明显的明↔暗闪烁。

### 目标启动时序

```
1. 扫描本地文件          (loading mask 显示)
2. 读 .symbol-notes/ 配置 (mask 保持)
3. hydrate workspace + settings (mask 保持)
4. 解开遮罩，渲染正确布局/主题
5. 后台解析双链/任务/索引  (右上角 toast 进度，不挡视图)
```

外加：IndexedDB 缓存「完整解析后的主题」，使**首帧（含 mask 本身）**就以正确主题
着色，消除启动期的明↔暗闪烁。

### 非目标

- 不重写 workspace → `workspace.json` 的落盘逻辑（已实现，见 §5）。
- 不改 `.symbol-notes/` 配置文件的格式、探测或 meta 状态机
  （`vaultConfig.ts` 既有逻辑保持不变）。
- 不引入 localStorage 同步兜底；主题缓存统一走 IndexedDB（与项目既有
  `idb-keyval` 用法一致）。

## 2. 时序重构

核心：把「读配置 + hydrate」从 `scanAndIndex` 之后挪到「扫描完成」与「撤遮罩」之间，
并把撤遮罩（reveal）的控制权从 `scanAndIndex` 内部交给调用方。

### 2.1 `scanAndIndex` 拆分

将现 `scanAndIndex()` 拆成两段：

- **`scanPhase1()`（reveal 之前，串行）**：执行 `buildScan` + `loadAllFileStats`、
  比对 stat 决定 `mdUnchanged`/`mdChanged`、`setVaultStore('files', files)`、
  `setFileTree(tree)`。**不再调用 `endScanOverlay()`**。返回后续阶段所需的中间态
  （`mdUnchanged`、`mdChanged`、`session` 等）。
- **`parseAndIndex(...)`（reveal 之后，后台 await）**：现阶段2/3 的全部内容——
  `parseAll`、就地合并完整 `FileMeta`、`buildBacklinks/Tags/Tasks/Calendar`、
  prune、toast 进度。

`endScanOverlay(session)` 的调用从 `scanAndIndex` 内部移除，由调用方在 hydrate 后触发。

> 注意 `session`/`currentSession` 取消语义、`setIsIndexing`、
> `beginLoadProgress`/`endLoadProgress` 的配对要随拆分保持完整：begin 在
> `scanPhase1` 前，end 在 `parseAndIndex` 的 `finally`。

### 2.2 `restoreVault` / `openVault` 新流程

```
restoreVault():
  adapter = LocalAdapter.restore(); 若无 → return
  initFileIO / setVaultFs / vaultConfig.setAdapter
  await vaultConfig.loadMeta()
  mid = await scanPhase1()                 // mask 保持
  await connectVaultConfig({ reveal })     // 读配置 + hydrate；按状态决定何时 reveal
  await parseAndIndex(mid)                  // 后台解析，toast
```

`openVault` 同理（其差异仅在 `resetMeta()` + `clearAllLeaves()`，保持不变）。

### 2.3 reveal 时机（mask 保持 vs 立即撤）

`connectVaultConfig` 依据 `vaultConfig.metaStatus()` 决定 reveal 点：

- `status === 'active'`，或 `unknown 且 configFolderExists()` 为真
  → **有配置可读**：先 `markActive`（unknown 分支）、`hydrateVaultConfig()`，
  **hydrate 完成后** `endScanOverlay()`（reveal）。用户看到的首个可交互帧即正确布局/主题。
- `status === 'declined'`，或 `unknown 且无配置文件夹`（需弹「是否创建配置」框）
  → **无配置可 hydrate**：**先 `endScanOverlay()`（reveal）**，再走既有逻辑
  （declined 直接返回；unknown 弹 `promptCreateVaultConfig()`）。
  不让 mask 卡在等待用户弹窗上。

实现上，把 reveal 作为一个回调/标志传入或在 `connectVaultConfig` 内按分支调用
`endScanOverlay(session)`；`session` 需从 `scanPhase1` 透传下来。

## 3. 主题 IndexedDB 缓存（防闪烁）

### 3.1 新模块 `src/lib/themeCache.ts`

职责：把「当前生效的 `ThemeSpec`」镜像到 IndexedDB，并在启动时读回应用。
依赖 `idb-keyval` 的 `get`/`set`；key 为 `sn-theme-cache`。

- **`getCachedTheme(): Promise<ThemeSpec | null>`**：读回缓存，形状非法则返回 `null`。
- **`writeCachedTheme(spec: ThemeSpec): Promise<void>`**：写入（fire-and-forget 调用即可）。

`ThemeSpec` 复用 `src/lib/theme.ts` 既有类型：
`{ kind:'preset'; id } | { kind:'custom'; mode; vars }`。缓存「完整解析后的主题」
即缓存 `resolveTheme(...)` 的输出，任何主题（含 nord / 自定义）下次启动都零闪烁还原。

### 3.2 首帧应用（`src/index.tsx`）

在渲染 `<App>` **之前** `await getCachedTheme()`，若非 `null` 则 `applyTheme(spec)`。
IDB 读取为个位数毫秒，期间 root 为空（无可见内容），换来 mask 与页面背景首帧即正确着色。

### 3.3 写缓存（订阅生效主题）

新增一个 `createEffect`（置于 `themeCache.ts` 的 `createRoot` 内，或 App 内）订阅
`resolveTheme(settingsStore.theme, settingsStore.customThemes)`，主题一变即
`writeCachedTheme(spec)`。这样下次启动 §3.2 读到的就是最近一次生效主题。

### 3.4 关键陷阱：避免默认值回灌

App 现有：

```ts
createEffect(() => applyTheme(resolveTheme(settingsStore.theme, settingsStore.customThemes)))
```

挂载时 `settingsStore` 仍是默认（`theme:'dark'`），该 effect 会先用深色跑一次，
**把 §3.2 应用的缓存主题覆盖回深色**，直到 hydrateSettings 才纠正——闪烁复现。

**解决：加 `themeHydrated` gate。**

- 新增响应式标志 `themeHydrated`（signal，初值 `false`）。
- 上述「应用主题」effect 改为：`themeHydrated()` 为 `false` 时 **直接 return 不 apply**
  （此时由 index.tsx 应用的缓存主题兜底）；为 `true` 后才 `applyTheme(...)`。
- `themeHydrated` 在以下时机置 `true`：
  - `hydrateSettings(...)` 执行后（有配置，settings 已注入）；
  - 或确定「无配置可 hydrate」的分支（declined / unknown 无配置）——此时真实 settings
    即默认值，应用默认主题与缓存一致，无跳变。
- 置 `true` 后 effect 接管，应用真实（已 hydrate）主题；因与缓存一致，用户无感。

> gate 的存放位置：`themeHydrated` 信号宜放在 `themeCache.ts` 或 `settingsStore.ts`，
> 由 `hydrateSettings` 与 vault 编排层（`connectVaultConfig` 的无配置分支）共同置位。
> 选其一并保持单一写入入口，避免竞态。

## 4. 模块边界与依赖

- `src/lib/themeCache.ts`（新）：仅依赖 `idb-keyval` 与 `src/lib/theme.ts` 的类型/函数。
  对外暴露 `getCachedTheme` / `writeCachedTheme` / `themeHydrated` 信号（或 setter）。
- `src/index.tsx`：启动时 `await getCachedTheme()` → `applyTheme`，再 `render(<App/>)`。
- `src/App.tsx`：「应用主题」effect 加 `themeHydrated()` gate；保留 `customCSS` effect 不变。
- `src/vault/index.ts`：`scanAndIndex` 拆为 `scanPhase1` + `parseAndIndex`；
  `restoreVault`/`openVault` 串成「scan → connectVaultConfig(含 reveal) → parseAndIndex」；
  `connectVaultConfig` 按状态决定 reveal 时机并触发 `themeHydrated` 置位（无配置分支）。
- `src/stores/settingsStore.ts`：`hydrateSettings` 末尾置 `themeHydrated = true`
  （或调用 themeCache 暴露的 setter）。
- 不改：`vaultConfig.ts`、`workspaceStore.ts` 的落盘逻辑、`loadProgress.ts` 的 API
  （仍用 `beginLoadProgress`/`endScanOverlay`/`endLoadProgress`）。

## 5. 已就位部分（仅回归验证）

`workspaceStore.ts` 已有：

```ts
createRoot(() => {
  createEffect(() => vaultConfig.saveWorkspace({
    layouts: workspaceStore.layouts,
    activeLayoutId: workspaceStore.activeLayoutId,
  }))
})
```

`vaultConfig.saveWorkspace` 内部 `isConfigActive()` gate + 800ms 防抖。
「更新 workspace 存到 `.symbol-notes/workspace.json`」**已实现**，本次不重写，
仅在时序重构后回归验证：编辑布局后防抖落盘正常、不在配置未激活时误写。

## 6. 测试与验证

纯逻辑单测（node 环境，`npx vitest run`）：

- `themeCache`：`getCachedTheme` 对合法/非法/缺失值的返回（mock `idb-keyval`，
  参考 `src/vault/__tests__/indexStorage.test.ts` 的 mock 方式）。
- 若 `connectVaultConfig` 的 reveal 分支逻辑可抽成纯函数（输入 status + exists →
  输出 reveal 时机/是否 hydrate），补一个分支判定的纯函数测试。

手动验证（`npm run dev`）：

1. 深色主题用户刷新：首帧深色，无闪烁，布局一次到位（无重排）。
2. 浅色 / nord / 自定义主题用户刷新：首帧即对应主题，无明↔暗或跳色。
3. 首次打开某 vault（无 `.symbol-notes/`）：扫描后 reveal → 弹「是否创建配置」框，
   mask 不卡在弹窗前。
4. `declined` 状态 vault：扫描后正常 reveal，不读配置。
5. 编辑布局（开关标签/分屏）→ 800ms 后 `workspace.json` 落盘（§5 回归）。

提交前：`npm run build`（含 `tsc`）与 `npx vitest run` 均通过。
