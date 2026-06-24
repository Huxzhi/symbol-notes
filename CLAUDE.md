# CLAUDE.md

本文件为 Claude Code 在本仓库工作时提供指引。面向用户的项目介绍见 [`README.md`](README.md)。

## 项目是什么

Symbol Notes：纯前端、本地优先的 Obsidian 风格 Markdown 笔记应用。基于 File System Access
API 直读直写本地 vault（一个 `.md` 文件夹），核心卖点是「符号学 / 子弹日记」式的列表项语义
高亮 + 双链 + 标签 + 日历。SolidJS + TypeScript + CodeMirror 6 + Tailwind v4 + Vite/PWA。

## 命令

```bash
npm run dev          # 开发服务器
npm run build        # tsc 类型检查 + vite 生产构建（提交前应保证通过）
npx vitest run       # 单次运行全部测试（package.json 无 test 脚本，直接调 vitest）
npx vitest run path/to/file.test.ts   # 跑单个测试文件
```

测试环境为 `node`（见 `vite.config.ts` 的 `test.environment`），测试覆盖纯逻辑（解析、索引、
工作区树、CM6 扩展），不依赖浏览器 API。

## 架构骨架（改动前必读）

三层职责，**不要跨层耦合**：

1. **`src/vault/` —— 领域核心，单一真实来源。** 按职责分模块，`index.ts` 仅是 re-export barrel：
   - `store.ts` 是 `vaultStore`（`FileMeta` 与跨文件索引 `backlinkMap` / `tagMap` / `taskMap` /
     `calendarByDate`）+ 连接句柄 + 扫描状态的唯一真实来源。它是**叶子模块**：其余模块都 import 它，
     它不 import 任何 vault 内部模块（以此避免循环依赖，不要让 store 反向依赖上层）。
   - `fileTree.ts` 单独持有**纯结构**（无 stat），是目录结构的真实来源。
   - `fs/`：文件系统访问层（`types.ts` port + `LocalAdapter.ts` 实现 + `io.ts` 活跃句柄/内容缓存）。
   - `indexStorage.ts`：IndexedDB 缓存（stat / 解析 meta）。
   - `parse/`：字节 → `FileMeta` 字段（`extract.ts` 纯抽取 + `fileMeta.ts` 字段构建器）。
     `buildContentFields` 是 `scan` 与 `reindexFile` **共用的唯一字段拼装器**，改 `FileMeta` 形状先看它。
   - `indexes/`：跨文件派生索引家族（`backlinks` / `tags` / `tasks` / `calendar`），统一
     `build* / applyFile* / removeFile*` 契约——`applyFile*` 加、`removeFile*` 删、全量 `build*` 仅扫描时用。
   - `scan.ts`：FS 扫描 + 后台批量解析管线。
   - **所有文件写操作必须经过 `fileActions.ts`**（create/save/rename/delete/move + `reindexFile`）。契约：
     先落盘（`fs/io`）→ 再增量更新 store 与各索引 → 必要时改写反链。不要绕过它直接 `setVaultStore`。
   - `lifecycle.ts`：接入 vault 的编排（open/restore、配置文件夹编排、扫描+建索引）。

2. **`src/stores/` —— UI/工作区状态。**
   - `workspaceStore.ts`：分屏/标签树、leaf 生命周期、左右侧边栏、布局持久化（localStorage）。
   - 运行时不可序列化状态（CM view、dirty、历史）放 `leafInstances`，与可序列化布局分离。

3. **`src/plugins/` + `src/lib/pluginRegistry.ts` —— 一切功能皆插件。**
   - 用 `definePlugin({ id, name, core?, defaultEnabled?, setup(ctx) })` 定义，在 `App.tsx`
     里 `registerPlugin` 后 `startPlugins()`。
   - `setup` 通过 `PluginContext` 注册视图 / Ribbon / 设置页 / 右键菜单，并访问 `ctx.vault`、
     `ctx.workspace`、`ctx.settings`。**插件间不直接 import 彼此**，只经 `PluginContext` 协作。
   - 视图三种：`file`（按 `canAcceptFile` 匹配，**后注册者优先 / last-wins**）、`page`、`panel`（左/右）。
   - 插件的 `onCleanup` 已由 registry 接管：注册的东西在插件被禁用时自动注销。

## 关键约定

- **语言：** 代码注释、commit message、UI 文案以中文为主（项目惯例）。变量/类型名用英文。
- **解析层不懂语义。** `listsField` / `parseMarkdown` 只产出结构化 `ListItem`（symbol、signifier、
  status、fields、tags…）；含义（如 signifier `~` = 想法）由渲染插件如 `bujoHighlight.ts` 赋予。
  新增语义高亮请遵循这个分层，不要把含义塞进解析层。
- **FileMeta 两阶段填充：** 扫描阶段只填 stat（name/path/kind/parent/size/mtime/hash），内容字段
  （frontmatter/outLinks/tags/...）后台解析后合并。改 `FileMeta` 形状时注意 `createFile` 等处
  的初始化对象要同步补字段。
- **CM6 扩展放 `src/lib/cm6/`**，每个 `*Field` / `*Extension` 自包含；可测的纯函数单独拆出并配
  `__tests__`。
- **提交前：** 跑 `npm run build`（含 `tsc`）与 `npx vitest run`，两者都应通过。
- 提交信息遵循 `type(scope): 描述` 约定（见 git log，如 `feat(calendar):` / `refactor(vault):`）。

## docs/ 目录

`docs/superpowers/specs/` 与 `docs/superpowers/plans/` 按日期存放历史设计稿与实现计划，是理解某个
功能「为什么这么设计」的最佳上下文。改动较大功能前，先查是否有对应的 spec/plan。

## 范围边界

- 本应用是**纯前端**，没有后端 / 数据库 / 网络请求；数据 = 用户本地文件 + IndexedDB 缓存。
  不要引入服务端假设。
- 依赖里有 `react` / `react-dom`，仅因 `@excalidraw/excalidraw` 需要；**应用本体是 SolidJS**，
  写组件请用 Solid（`createSignal` / `createStore` / `<Show>` / `<For>`），不要写 React。
