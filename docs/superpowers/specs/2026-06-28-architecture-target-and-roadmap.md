# 架构目标形态与改进路线

日期：2026-06-28
状态：方向性设计（north-star + roadmap），逐项落地各自再出 spec/plan
B（派生优先第一刀）采**简化实现**：不写独立 spec、不引 workQueue——metadata 直接响应式遍历
`vault.fileMap` 解析、纯派生。

## 1. 现状判断

骨架是好的，**不重写**。以下几样是对的，保留：

- 插件系统：`definePlugin` + `ctx` 注入 + `createRoot/onCleanup` 自动清理。
- SolidJS 响应式 store 作真相。
- 单写入口（fileManager）。
- cm6 编辑器扩展隔离在 `lib/cm6`。

问题不在选型，在 **4 个"说了没做实"**：

1. **门面是愿景，没被强制**：`services.ts` 设计成插件唯一入口，实测只有 `pluginRegistry`
   用它，19+ 插件绕过它直接 import `vault/`、`metadata/` 内部（最深到 `vault/fs/io`、
   `metadata/indexes/backlinks`）。约束只写在注释里，无工具守。
2. **循环依赖被懒加载掩盖**：核心代码 9 处 `await import` 全是绕环，集中指向
   `workspaceStore` / `pluginRegistry`（在 `lifecycle.ts`、`fileActions.ts`）。
3. **`workspaceStore` 上帝对象**：710 行、~100 action、21 个 import，是耦合中心与多数环的另一端。
4. **编排式 vs 派生式**：orchestrator "先喊 A 再喊 B" 应被"下层播报变更、上层派生"取代——
   不止启动一处，应成为默认范式。

## 2. 目标形态：5 层严格单向分层 + 派生优先

```
5 UI 层        components（内核 shell） / 插件 view
   ↑ 只准向下依赖（工具强制）
4 插件宿主     registries(view/ribbon/command/settings/menu) + ctx —— 插件唯一接触面
3 命令层       所有"写"收成具名 command（save/rename/createDailyNote…）= imperative shell
2 领域 store   vault(files+changefeed) · metadata(派生) · workspace · settings —— 响应式真相
1 平台适配     FileSystemAdapter · idb · hash —— 纯 I/O，零 app 知识
```

### 各层当前文件归位

| 层 | 职责 | 现有文件 |
|---|---|---|
| L1 平台 | 纯 I/O，无 app 知识 | `vault/fs/LocalAdapter`、`vault/fs/io`(底层部分)、`idb-keyval`、`lib/contentHash` |
| L2 领域 store | 响应式真相 + 派生 | `vault/store`(+新 workQueue)、`metadata/{store,cache,indexes}`、`stores/{workspaceStore,settingsStore,ui}`、`lib/templates/store` |
| L3 命令层 | 具名写操作 | `fileManager/fileActions`、`vault/lifecycle`(连接+配置)、`vaultConfigActions`、**(目标)从 workspaceStore 拆出的 workspaceActions** |
| L4 插件宿主 | 注册表 + ctx | `lib/pluginRegistry`(含**内联的 service 实现**)、`lib/pluginData`；`lib/services` **删除**（折进 ctx） |
| L5 UI | 渲染，只读 store / dispatch command | `components/**`、`plugins/*/*.tsx`、`App.tsx` |

### 依赖规则（工具强制，非注释）

- 每层只能向**下**依赖；同层 sibling 依赖需谨慎、不得成环。
- **L1 叶子**（`vault/{store,fs,scan}`、`metadata/store`）：不得 import 任何上层。
- **L2 metadata** 派生：只读 `vault`，**不得** import `fileManager` / `plugins` / `components`。
- **L5 区分两类**：
  - **内核 shell 组件**（`components/**`、移入后的 files）：可直连 L3 命令 + L2 store 读。
  - **插件 view**（`plugins/**`）：**只能经 L4 `ctx`**，禁止直接 import `vault/`、`metadata/`、
    `fileManager/`、`stores/`（类型除外）。
- **禁止用 `await import` 绕环**——它出现即代表分层有环，须从分层修，不得用懒加载掩盖。

### 强制手段

引入 `dependency-cruiser`（或 eslint `no-restricted-imports`），CI 挡回潮。核心规则：

```
forbid:
  - plugins/**          ->  vault/** | metadata/** | fileManager/** | stores/**(非 type)
  - vault/{store,fs,scan}-> metadata/** | fileManager/** | plugins/** | components/**
  - metadata/**         ->  fileManager/** | plugins/**
  - no-circular（含动态 import）
```

## 3. 核心原则

### 派生优先（derivation over orchestration）

store 间靠**响应式订阅互相派生**，不靠 orchestrator 推。`vault → metadata` 是第一个落地点：
vault.files 作唯一真相，metadata 用一个响应式 effect 遍历 `vault.fileMap`、解析变更文件、重建索引，
纯派生。这个范式消灭"先喊 A 再喊 B"的编排，连带消灭随之而来的循环与懒加载。

### 命令层（named commands）

现在写操作散在 `workspaceActions` / `fileActions` / `vaultConfigActions` / `ui.*` / 插件 ctx。
目标：收成一个 **command registry**，每个写操作是具名 command。白捡：

- 命令面板、快捷键绑定；
- 统一可测性（command 是纯函数式入口）；
- ctx 从"手搓一堆方法"变成"暴露注册好的 command"，L4 接触面收窄。

### 插件 vs 内核 的界定

- **插件**（`plugins/`）：可选、可在设置里开关、经 `ctx` 接触系统、走 `definePlugin` 生命周期。
- **内核 shell**（workspace / components）：一定加载、不可关闭、作为外壳直连 L2/L3。

判据：**"用户能不能关掉它而 app 仍可用"**——不能关的，就是内核，不该住在 `plugins/`。

## 4. 决策：FilesPanel 从插件移入 workspace 内核

**FilesPanel 不再是插件。** 它作为内核 shell，**直接读取 vault 内容**（合法直连 L2/L3 的
`vault` / `fileManager` / `stores`），不经 `ctx`/service——因为它恒在、不可关闭，不是可选插件。

### 理由

- `FilesPlugin` 已标 `core: true`——自认不可选，却仍走插件生命周期，**名实矛盾**。
- 它是门面违规重灾区：`FilesPanel.tsx` 直接 import `vault`(vaultFs/vaultStore)、
  `vault/lifecycle`(openVault)、`fileActions`、`pluginRegistry`(getFileViewForPath)、
  `stores/{settingsStore,ui}`。这些对**内核 shell 合法、对插件越层**。
- `openVault`（FilesPanel "打开 vault" 按钮）正是之前阻塞"lifecycle 简化"的外部调用方之一。

### 目标

- 代码从 `src/plugins/files/` 迁到 `src/components/workspace/files/`（或 `src/workspace/files/`）。
- **注册方式改为内核启动时直接注册**为 left panel view（仍用 view registry，因此仍是可开合的
  侧栏 leaf），但**不经 `definePlugin`、不进设置的插件开关**——它恒在。
- ribbon 项、`file` 右键菜单同样由内核注册。

### 解开的耦合

- 它对 `vault` / `fileManager` / `stores` 的直接依赖**就地合法化**（内核 shell 允许直连 L2/L3），
  门面违规计数立减一大块。
- `App.tsx` 把 files 作为内核外壳一部分直接挂载/注册，与 `Ribbon`/`StatusBar` 同级。
- 插件越层统计后续只剩真正的可选插件，lint 规则可干净地只约束 `plugins/**`。

## 5. 决策：service 直接折进 ctx，删除独立 facade

`lib/services.ts`（79 行）当前**唯一消费者就是 `pluginRegistry`**，本就是专为喂 ctx 而存在的中间层。
**不再独立写一遍**：把三个 service（Vault / Metadata / FileManager）的实现**直接内联进 ctx 构造处**，
删除 `services.ts`。

- 接口类型（`VaultService` / `MetadataService` / `FileManagerService`）保留在 `pluginRegistry`，作 ctx 的
  类型契约。
- 三个单例实现就地写在 ctx 里（直接调 `vault` / `metadata` / `fileManager` 领域 API），不再多绕一层文件。
- 收益：少一层转交、定义不重复；插件接触面收敛到唯一一处 `ctx`。

配套：本决策只**移动门面位置**。插件**越层**（直接 import `vault/`、`metadata/`）仍须靠 §4 的 lint +
FilesPanel 移入来收口——否则 ctx 照样被架空。

## 6. 现状 → 目标 差距映射

| 系统性问题 | 违反的目标规则 | 对应改进 |
|---|---|---|
| 门面没强制（19+ 越层） | L5 插件只能经 ctx | dependency-cruiser + FilesPanel 移入内核 |
| 懒加载绕环（9 处） | 禁止动态 import 绕环 | 派生优先（B）+ workspaceActions 拆出 + files 移入 |
| workspaceStore 上帝对象 | L2 store 不混 L3 命令 | 按域拆 + 命令层抽出 |
| 编排式 | 派生优先 | B（metadata 响应式遍历 vault.fileMap 派生）作首个范例 |

## 7. 迁移路线（按性价比）

1. **加分层 lint 守**（dependency-cruiser，~半天）：立刻止血、防回潮。先以"警告"接入现有违规，
   再逐步收紧为"错误"。
2. **B：vault→metadata 派生**（简化实现）：metadata 响应式遍历 `vault.fileMap` 解析；
   拆掉 `lifecycle.parseAndIndex` 与 `fileActions.reindexFile`，消编排、消 vault↔metadata 环。
3. **FilesPanel 移入内核 workspace + service 折进 ctx**：消最大门面违规、删多余 facade 层、
   解开 `openVault` 阻塞。
4. **拆 `workspaceStore`** 按域（layout / leaf / sidebar / drag / reveal），`types` 已独立。
5. **抽命令层**（最大、可最后）：写操作收成 command registry，ctx 改为暴露 command。

①②③④ 做完，9 处绕环懒加载基本清零、门面真正生效。

## 8. 非目标

- 不做完整重写——90% 结构原地演进即可。
- 不引入新框架/状态库——SolidJS 响应式已够。
- 本文档只定方向与规则；每项落地各自再出 spec + plan。
