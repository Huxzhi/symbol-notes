# Symbol Notes（符号笔记）

> 基于符号学的个人知识管理工具 —— 纯前端、本地优先、Obsidian 风格的 Markdown 笔记应用。

Symbol Notes 直接读写你本地磁盘上的一个 Markdown 文件夹（vault），所有数据留在本地，
不上传任何服务器。它把「列表项前导符号」（signifier）当作一等公民，配合双向链接、标签、
日历与子弹日记（Bullet Journal）式的语义高亮，把零散的笔记织成一张可检索、可回溯的知识网。

应用以 PWA 形式发布，可安装到桌面/移动端离线使用。

---

## ✨ 核心特性

- **本地文件夹直读直写** —— 基于 File System Access API，vault 就是磁盘上的普通 `.md` 文件；
  目录句柄通过 IndexedDB 持久化，刷新后自动恢复。
- **CodeMirror 6 实时预览编辑器** —— 光标离开后内联渲染粗体/斜体/链接，`[[wikilink]]` 高亮，
  内嵌可编辑的 Frontmatter（Properties）卡片，Markdown 快捷输入。
- **双向链接知识图谱** —— `[[wiki 链接]]` 解析、出链/入链面板、重命名时自动改写反链。
- **标签系统** —— frontmatter 标签 + 行内 `#标签` 统一索引，标签面板聚合浏览。
- **子弹日记 / 符号学高亮** —— 列表项前导符号（`-` 事件、`=` 心情、`~` 想法、`!` 重要、`&` 关注）
  驱动整行语义着色；解析层只认符号，含义由渲染插件赋予。
- **日历视图** —— 按 `dated`/`created`/`updated` 与任务/条目聚合到每一天，支持月/周行视图、
  无限滚动、周计划 & 月计划、从日期格直接打开当天的「每日笔记」。
- **每日笔记 & 模板** —— 一键打开/创建当天笔记；模板系统支持日期占位符与变量解析。
- **多视图工作区** —— Obsidian 式的可分屏、可拖拽的标签页 + 左右侧边栏面板，
  每个标签独立的前进/后退历史与面包屑导航；布局持久化到 localStorage。
- **Excalidraw 画板** —— 内置手绘白板插件，`.excalidraw` 文件作为一种视图类型打开。
- **主题与自定义** —— 内置「深空 / 晴日 / 极光(Nord)」三套主题，支持自定义主题色与自定义 CSS。
- **保存冲突检测** —— 外部修改文件时检测冲突并提示，避免覆盖丢失。

---

## 🧱 技术栈

| 层次 | 选择 |
|------|------|
| 框架 | SolidJS + TypeScript |
| 构建 | Vite + `vite-plugin-pwa` |
| 编辑器 | CodeMirror 6（`@codemirror/*`） |
| 样式 | Tailwind CSS v4（`@tailwindcss/vite`） |
| 存储 | File System Access API + `idb-keyval`（IndexedDB） |
| 虚拟列表 | `@tanstack/solid-virtual` |
| 画板 | `@excalidraw/excalidraw` |
| 测试 | Vitest |
| 图标 | `lucide-solid` |

> Frontmatter 由自实现的浏览器可运行 YAML 子集解析器处理，不引入重型依赖。

---

## 🚀 快速开始

```bash
npm install
npm run dev          # 启动开发服务器（Vite）
npm run build        # 类型检查 + 生产构建（tsc && vite build）
npm run preview      # 预览生产构建
npx vitest           # 运行单元测试（watch 模式）
npx vitest run       # 单次运行全部测试
```

启动后点击打开 vault，授权选择本地文件夹即可。需在支持 File System Access API 的
浏览器（Chromium 系）中运行。

---

## 🏗️ 架构总览

```
src/
├── App.tsx                # 应用根：注册并启动所有插件，组装工作区骨架
├── vault/                 # 「领域核心」：文件系统抽象 + 内容索引（单一真实来源）
│   ├── fs/                # FileSystemAdapter（LocalAdapter）+ 并发控制
│   ├── io.ts              # 读写文件、目录、mtime，缓存失效
│   ├── scan.ts            # 全量扫描：构建 FileMeta + fileTree
│   ├── fileTree.ts        # 结构树（纯结构、无 stat），结构的唯一真实来源
│   ├── indexStorage.ts    # 内容哈希缓存 + 文件 stat 缓存（IndexedDB）
│   ├── backlinks.ts       # 双链/反链、stem & alias 索引
│   ├── tags.ts            # 标签索引
│   ├── tasks.ts           # 任务/列表项索引
│   ├── calendarIndex.ts   # 按日期增量聚合的日历索引
│   └── index.ts           # vaultStore（响应式）+ fileActions（CRUD 编排）
├── stores/                # 工作区/设置/弹窗/Toast 等 UI 状态 store
│   ├── workspaceStore.ts  # 分屏/标签树、leaf 生命周期、布局持久化
│   ├── settingsStore.ts   # 主题、插件开关、自定义 CSS
│   └── types.ts           # FileMeta / ListItem / 工作区树等核心类型
├── lib/
│   ├── pluginRegistry.ts  # 插件系统：视图/Ribbon/设置页/右键菜单注册 + PluginContext
│   ├── cm6/               # CodeMirror 扩展（实时预览、wikilink、bujo 高亮、补全…）
│   ├── templates/         # 模板解析引擎
│   └── theme.ts           # 主题变量与应用
├── plugins/               # 功能以插件形式提供
│   ├── editor/            # Markdown / 图片 文件视图
│   ├── files/             # 文件树面板（虚拟滚动、拖拽、右键菜单）
│   ├── links/ outline/ tags/ search/   # 右侧/左侧功能面板
│   ├── calendar/          # 日历视图与周/月计划
│   ├── daily-note/        # 每日笔记
│   ├── templates/         # 模板选择器
│   └── excalidraw/        # 手绘白板
└── components/            # 工作区渲染、Ribbon、状态栏、模态框等通用 UI
```

### 设计要点

- **vault 是领域核心，UI 是消费者。** `vaultStore` 是文件元数据与跨文件索引（双链 / 标签 /
  任务 / 日历）的单一响应式真实来源；`fileTree` 单独持有纯结构。所有写操作经由 `fileActions`
  编排，先落盘再增量更新索引。
- **一切皆插件。** 编辑器、文件树、面板、日历、画板都通过 `definePlugin` + `PluginContext`
  注册到统一的视图/Ribbon/设置/右键菜单注册表。核心插件 `core: true`，其余可在设置中开关。
  插件之间不直接耦合，只依赖 `PluginContext` 暴露的 `vault` / `workspace` / `settings` 能力。
- **视图注册表（View Registry）。** 文件视图按 `canAcceptFile` 后注册者优先匹配（last-wins），
  页面视图与左右面板视图分别注册，工作区按 `viewState.type` 渲染对应组件。
- **分阶段启动扫描。** 打开 vault 后：阶段 1 仅 stat 入 store 撤掉遮挡 → 阶段 2 后台解析内容
  （Toast 显示进度）→ 阶段 2.5 一次性合并完整 FileMeta → 阶段 3 构建跨文件索引。内容哈希缓存
  让未改动文件跳过重复解析。

---

## 📈 阶段性进展（截至 2026-06）

项目自 2026-05-20 启动，约一个月内完成了从「能读能写的编辑器」到「插件化知识管理平台」的演进。
完整的设计稿与实现计划见 [`docs/`](docs/)。

| 阶段 | 时间 | 里程碑 |
|------|------|--------|
| **一·编辑器内核** | 05-20 → 05-24 | File System Access 读写 vault、CM6 实时预览、Frontmatter 卡片、Markdown 快捷输入 |
| **二·工作区与知识网** | 05-24 → 05-31 | 分屏/标签工作区系统、文件树面板（折叠/拖拽/右键菜单）、布局持久化、双向链接与标签索引、保存冲突检测 |
| **三·插件化重构** | 05-29 → 06-04 | 插件系统迁移、领域 store 拆分、vault domain split、运行时 store 分离、文件缓存重构 |
| **四·功能繁荣** | 06-01 → 06-12 | Excalidraw 画板、日历视图（无限滚动/周月计划/每日笔记）、模板系统、子弹日记符号高亮、wikilink 自动补全、主题自定义、标签页导航栏 |
| **五·性能与结构基建** | 06 持续 | 文件树虚拟滚动、分阶段启动加载、日历按日增量聚合、fileTree 作为结构真实来源 |

**当前状态：** 核心编辑、知识图谱、日历、插件体系均已可用，32 个单元测试覆盖解析、索引、
工作区与 CM6 扩展等关键纯逻辑。代码持续在「领域核心稳定、UI 插件迭代」的节奏上演进。

---

## 🗺️ 后续方向（候选）

- 全局搜索增强（内容/标签/字段复合查询）
- 仪表盘 / Dashboard 插件（计划文档已存在于 `docs/`）
- 图谱视图（关系可视化）
- 移动端交互打磨

---

## 📄 许可

私有项目。
