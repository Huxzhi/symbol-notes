# Workspace 模块化 + 依赖倒转 设计

- 日期: 2026-06-26
- 状态: 已批准设计，待写实现计划
- 范围: 把 workspace 从 `src/stores/` 的单文件提升为 `src/workspace/` 模块，倒转依赖方向；
  把零散在各 store 的「存盘 effect」收口到 vault 的统一 config 加载器；workspace UI 在配置加载完成后才渲染。

## 1. 背景与问题

当前 workspace 的真实来源是 `src/stores/workspaceStore.ts`（695 行），配套
`src/stores/workspaceTreeHelpers.ts`、`src/stores/leafHistory.ts`，类型在 `src/stores/types.ts`。

它承担的职责：当前焦点（active layout / active leaf / activeFilePath）、leafId、打开/切换/关闭/
拆分/拖拽 leaf、布局（layout）增删切换、给插件提供渲染空间（view 注册表 + 渲染器）、工作区存盘。

存在三条有问题的依赖边：

```
workspaceStore ──► lib/pluginRegistry      (getView / getFileViewForPath)
lib/pluginRegistry ──► workspaceStore       (activeLayout / leafInstances / workspaceActions …)   ← 环
workspaceStore ──► vault/vaultConfig        (saveWorkspace 的 createEffect)                        ← 向下反依赖
```

`workspaceStore ↔ pluginRegistry` 是真正的循环依赖；`workspaceStore → vaultConfig` 让一个高层
模块向下耦合了持久化实现。

此外存盘 effect 分散在多个 store：`workspaceStore`、`settingsStore`（settings + theme 两个）、
`lib/pluginData`（每插件一个），各自 `createRoot/createEffect → vaultConfig.save*`。

## 2. 目标

1. workspace 成为高层「叶子」模块：被 components / pluginRegistry / vault-config 依赖，自己只依赖
   `lib` 和自身 `types`，**不** import `vault` / `pluginRegistry` / `services`。
2. 打破 `workspace ↔ pluginRegistry` 循环。
3. 持久化「读 + 写」收口到 vault 的统一 config 加载器；workspace 不再 import `vaultConfig`。
4. workspace UI 在配置加载完成后才渲染，消除「默认布局闪一下再被 hydrate 覆盖」的闪烁。
5. 对外 API（`workspaceActions.*`、`activeLayout()` 等名字）保持不变，消费方只改 import 路径。
6. 除第 5 节的渲染网关外，不引入行为变化。

非目标：不重写 leaf/tab 的交互逻辑；不改 vaultConfig 的 IO/防抖/gating 实现；不动 plugin data
的每插件 store 生命周期（见 4.3）。

## 3. 目标依赖图

```
lib (cm6 types, theme, utils)
        ▲
   workspace        ← 状态 + 选择器 + 动作 + view 注册表 + 渲染器；只依赖 lib + 自身 types
        ▲   ▲   ▲
        │   │   └────── components (App、StatusBar、Ribbon …)
        │   └────────── pluginRegistry / plugins   (注册进 workspace、读 selectors)
        └────────────── vault/config (统一加载器：hydrate + 存盘 effects)
```

所有箭头都指向 workspace。倒转后：

- `pluginRegistry → workspace`（用 view 注册表 + selectors），不再反向。
- `vault/config → workspace`（hydrate + 反应式读取做存盘），workspace 不再 `→ vaultConfig`。

## 4. 设计

### 4.1 `src/workspace/` 目录结构

```
src/workspace/
  index.ts          # 公共门面：re-export store / selectors / actions / 注册表 / hydrate / types
  types.ts          # ViewState, Workspace{Leaf,Tabs,Split,Node,Root,Layout}, WorkspaceState,
                    #   LeafRuntimeState, RevealRequest, ViewComponentProps（从 stores/types.ts 迁出）
  store.ts          # createStore<WorkspaceState> + leafInstances + 默认布局 + hydrateWorkspace
  selectors.ts      # activeLayout, activeRoot, activeFilePath, activeSidebarType,
                    #   getLeafsByType, findLeafInTree/Root, layoutList
  tree.ts           # 原 workspaceTreeHelpers（mapNode, findParentTabs, insert/remove/split…）
  history.ts        # 原 leafHistory（pushHistory）
  interaction.ts    # revealTarget/revealFolder + dragState/isDraggingMainTab（原文件末尾交互态块）
  viewRegistry.ts   # File/Page/PanelViewDef + register/unregister/getView/getFileViewForPath/get*PanelViews
  actions/
    index.ts        # 组装并导出单一 workspaceActions 门面
    leaves.ts       # createLeaf, closeLeaf/closeOther/closeRight, activateLeaf, setLeafViewState,
                    #   setLeafPinned, navigateBack/Forward, openLeaf/openFile/openPage/openFileAt,
                    #   takePendingReveal, clearAllLeaves, renameLeafPath, splitLeaf
    sidebar.ts      # toggleSidebar, setSidebarWidth, activateSidebarLeaf(ById),
                    #   switchSidebarPanel, openSidebarPanel, splitSidebarLeaf,
                    #   reorderSidebarLeafInTabs, moveSidebarLeaf
    layout.ts       # createLayout, switchLayout, renameLayout, deleteLayout
    dnd.ts          # reorderLeafInTabs, moveLeafToTabs, moveLeafAsSplit
  ui/               # 渲染空间（从 src/components/workspace/ 迁入）
    WorkspaceNodeRenderer.tsx, WorkspaceSplitView.tsx, WorkspaceTabsView.tsx,
    WorkspaceLeafView.tsx, SidebarRenderer.tsx, WorkspaceNavBar.tsx, breadcrumb.ts
```

要点：

- `actions/index.ts` 把 4 个子文件里的函数组装成同一个 `workspaceActions` 对象导出，**调用方不变**
  （`workspaceActions.openFile(...)` 照旧）。动作之间的互相调用（如 `openFile → openLeaf`、
  `navigateBack → setLeafViewState`）通过从兄弟模块 import 具名函数实现，避免 `workspaceActions`
  自引用造成的初始化顺序问题。
- `setLayout`/`setRoot` 这两个内部 setter 助手放在 `actions/internal.ts`，供各 actions 子文件共享
  （依赖 `store.ts` 的 `setWorkspaceStore` 与当前 `activeLayoutId`）。
- `index.ts` 是唯一对外入口；外部一律 `from '../workspace'`（或相对深度），不深链子文件。

### 4.2 View 注册表搬进 workspace

`viewRegistry.ts` 从 `lib/pluginRegistry.ts` 整体迁入 `src/workspace/viewRegistry.ts`，API 不变：
`registerView` / `unregisterView` / `getView` / `getFileViewForPath` / `getLeftPanelViews` /
`getRightPanelViews` / `_clearViewRegistryForTest`，以及类型
`FileViewDef` / `PageViewDef` / `PanelViewDef` / `ViewDef`。

- `pluginRegistry.ts` 保留其余注册表（ribbon、settings tab、context menu、plugin 生命周期、
  `PluginContext`），改为从 `workspace` import view 注册表与 selectors。方向单一。
- `workspace/actions/leaves.ts` 对 `getFileViewForPath`/`getView` 改为**模块内** import。
- `PluginContext.view(def)` 仍调 `registerView`（现来自 workspace）。插件只碰 `ctx`，不受影响。

### 4.3 vault 统一 config 加载器（读 + 写）

`vaultConfig.ts` 已经拥有全部 IO 与 `save*` 函数（内含 `isConfigActive` gating + 防抖）。要收口的
是分散的**反应式绑定**（各 store 自己的存盘 `createEffect`）。

新增 `src/vault/config/bindConfig.ts`（命名可在实现时定），导出在启动时调用一次的
`bindConfigPersistence()`：

```
bindConfigPersistence():
  createRoot(() => {
    createEffect(() => vaultConfig.saveWorkspace({ layouts, activeLayoutId }))   // 读 workspaceStore
    createEffect(() => vaultConfig.saveSettings({ pluginStates, autoTimestamps, showOtherFiles }))
    createEffect(() => vaultConfig.saveTheme({ theme, customThemes, customCSS }))
  })
```

- **从 `workspaceStore` 删除**其 `createRoot/createEffect`（saveWorkspace）。
- **从 `settingsStore` 删除**其 `createRoot` + 两个 `createEffect`（saveSettings / saveTheme）。
- 两个 store 只保留：响应式 store、`hydrate*`、actions。
- **读侧（hydrate）已经收口**在 `vault/lifecycle.hydrateVaultConfig`（调用
  `hydrateWorkspace/Settings/Theme/AllPluginData`），保持不动——它就是统一加载器的「读」一半。
- `bindConfigPersistence()` 的调用时机：在 `App.tsx` 模块顶层、与 `startPlugins()` 同处调用一次。
  存盘 effect 首次 fire 在 `isConfigActive()` 为假时被 vaultConfig 内部 gate 掉，
  不会在 hydrate 前脏写——与当前各 store 自带 effect 的行为一致。

**Plugin data 例外（保持现状）**：`lib/pluginData.ts` 的存盘 effect 是**每插件、惰性**创建的，
且插件早于 vault 连接启动（其文件头注释已说明该生命周期）。它已经经由
`vaultConfig.savePluginData` 落盘——vault 仍是实际写入方。把动态的每插件 effect 塞进静态 binder
会破坏该生命周期，故 `pluginData.ts` 机制不变。

倒转结果：`workspace` 与 `settingsStore` 不再 import `vaultConfig`；方向为
`vault/config → workspace`、`vault/config → settingsStore`。

### 4.4 渲染网关：配置加载完成后才渲染 workspace

`App.tsx` 当前立即渲染 `activeRoot()`。改为把 workspace 渲染器（左栏 `SidebarRenderer`、主区
`WorkspaceNodeRenderer`、右栏 `SidebarRenderer`）包在
`<Show when={metadataStore.initialized}>` 内。

理由：复用 LoadingOverlay 已用的同一信号 `metadataStore.initialized`。`initialized` 置位时配置
早已 hydrate 完成，workspace 直接挂载进正确布局；在此之前全屏 overlay 一直遮挡。单一真相来源，
与既有 overlay 行为一致。

不采用单独的、更早的 `configHydrated` 标志（在 `hydrateVaultConfig` 后、parse 完成前置位）：
overlay 同样遮挡两段时间，肉眼无差异，徒增状态。

`activeRoot()` 在 `initialized` 为真前不被读取，避免默认布局闪烁。

## 5. 影响面（Blast radius）

- **import 路径更新（机械）**：约 24 个文件从 `stores/workspaceStore` 改指 `workspace`；门面保持
  `workspaceActions`/`activeLayout`/… 名称不变，仅路径变化。
- **类型迁移**：workspace 类型从 `stores/types.ts` 迁入 `workspace/types.ts`；`stores/types.ts` 过渡期
  可 re-export，或直接更新少量 importer。
- **view 注册表消费方**：`components/workspace/*`（迁入 `workspace/ui` 后为内部 import）、
  `pluginRegistry.ts`、以及通过 `ctx` 的插件——插件零改动。
- **UI 迁移**：`src/components/workspace/*` → `src/workspace/ui/*`，`App.tsx` 改 import 路径。
- **存盘 effect 迁移**：`workspaceStore` / `settingsStore` 删除自带 effect；新增
  `vault/config/bindConfig.ts` 并在启动调用 `bindConfigPersistence()`。
- **测试**：`tests/stores/reveal.test.ts` 及相关 workspace 测试改指新路径，并镜像到 `tests/workspace/`。
- **行为变化**：仅第 4.4 节渲染网关；其余为纯结构迁移。

## 6. 验证

- `npx tsc --noEmit` 通过。
- `npx vitest run` 全绿（迁移后测试路径更新；不削减断言）。
- 手动冒烟：打开/恢复 vault → overlay 期间不见默认布局闪烁 → `initialized` 后 workspace 进入
  hydrate 后的布局；移动 tab/改布局后 `.symbol-notes/workspace.json` 正常落盘；切换主题/设置正常落盘；
  插件 view / panel / ribbon 正常注册渲染。

## 7. 风险与缓解

- **循环 import / TDZ**：actions 子文件互调若经 `workspaceActions` 自引用会有初始化顺序坑——通过子
  文件间 import 具名函数规避（见 4.1）。
- **存盘 effect 时机**：binder 的 effect 首次 fire 必须被 `isConfigActive` gate 掉，避免 hydrate 前脏写；
  迁移时保持与原 store effect 相同的快照内容与调用，不改 vaultConfig 内部逻辑。
- **大范围移动文件**：分步提交（先迁类型与 store，再迁 actions/registry/ui，最后改 App 与 binder），
  每步 `tsc` + `vitest` 把关。
```

实现计划阶段细化分步与提交边界。
