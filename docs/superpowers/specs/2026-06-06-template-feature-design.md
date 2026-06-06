# 模板功能设计 (Template Feature)

日期：2026-06-06
状态：已批准，待实现

## 背景与目标

新建笔记（尤其是每日日记）时，希望能快速展开一套预设结构，并自动填入日期、时间、星期等动态内容。

本项目没有 Obsidian 那样的 `vault.on('create')` 事件系统，但这并非障碍：日记创建、右键新建等都是代码里明确的调用点，可以在调用点**主动注入**模板内容，比"监听文件创建再回填"的被动方式更简单可控。

目标：通用的多模板系统，支持动态占位符，可配置模板文件夹，并与每日日记联动。

## 架构总览

四个模块，各管一摊、边界清晰：

| 模块 | 职责 |
|---|---|
| `src/lib/templates/` | 纯逻辑：占位符引擎、扩展的日期格式化、模板发现、共享的"模板文件夹"配置 |
| `src/plugins/templates/` | 入口插件：设置页、Ribbon 按钮(B)、文件树右键(A)、`TemplatePicker` 弹窗 |
| `src/lib/cm6/templateSlashExtension.ts` | 编辑器内 `/` 斜杠命令(C)，CM6 autocomplete |
| `src/plugins/daily-note/` 改动 | 设置页加"模板"下拉，新建日记时套用 |

**实现分两阶段：**
- **阶段一**：共享 lib + `templates` 插件（A 右键新建、B Ribbon 插入）+ daily-note 联动。复用现成 ctx 入口，零新机制，风险低，最快可用。
- **阶段二**：C 编辑器斜杠命令。需新建 CM6 补全机制，风险隔离为独立一期。

## 1. 占位符引擎（`src/lib/templates/`，纯逻辑、可测）

核心函数：

```ts
resolveTemplate(content: string, ctx: { title?: string; now?: Date }): {
  text: string
  cursorPos: number | null
}
```

支持的占位符（均为 `{{...}}` 语法）：

| 占位符 | 替换为 |
|---|---|
| `{{date}}` / `{{date:FMT}}` | 当天日期，默认格式 `YYYY-MM-DD` |
| `{{time}}` / `{{time:FMT}}` | 当前时间，默认格式 `HH:mm` |
| `{{yesterday}}` / `{{yesterday:FMT}}` | 相对 `now` 的昨天，默认 `YYYY-MM-DD` |
| `{{tomorrow}}` / `{{tomorrow:FMT}}` | 相对 `now` 的明天，默认 `YYYY-MM-DD` |
| `{{weekday}}` | 中文星期（周一…周日） |
| `{{title}}` | 新文件名（不含 `.md`）；缺省时替换为空串 |
| `{{cursor}}` | 从文本移除，返回其偏移量作 `cursorPos`；出现多个时取第一个，其余删除 |

规则：
- `now` 默认 `new Date()`，可注入以便测试。`yesterday`/`tomorrow` 相对 `now` 计算。
- 未识别的 `{{...}}` 原样保留（不报错），避免误删用户内容。
- 无 `{{cursor}}` 时 `cursorPos` 为 `null`。

### 日期格式化扩展

扩展现有 `src/plugins/daily-note/formatDate.ts` 的 `formatDate(date, fmt)`：

- 现有 token `YYYY` / `MM`(月) / `DD` 保留，行为不变。
- 新增 `HH`(24 时制时) / `mm`(分) / `ss`(秒)，均补零两位。
- `MM`(月) 与 `mm`(分) 大小写区分，`replaceAll` 互不影响。
- daily-note 继续复用此函数，无回归。

> 注：是否将 `formatDate` 物理迁移到 `src/lib/templates/` 由实现阶段决定；无论位置如何，保持 daily-note 现有导入可用（必要时再导出）。

## 2. 共享配置 & 模板发现（同 lib）

- 响应式 signal `templatesFolder`（字符串，相对 vault 根目录），独立持久化到 localStorage key `sn-templates`。
- **不归属任何插件**：`templates` 插件设置页与 daily-note 设置页都通过该共享模块读写，避免跨插件读 `sn-plugin-*` 的耦合与非响应式问题。
- `listTemplates(): { name: string; path: string }[]`：读 `vaultStore.files`，过滤 `templatesFolder` 下的 `.md` 文件，`name` 为去扩展名的文件名。响应式。文件夹未配置或为空 → 返回空数组。

## 3. 入口（阶段一：A + B + 日记）

### TemplatePicker 弹窗（A、B 共用）

两种模式：
- `mode: 'create'`（A）：模板列表 + **文件名输入框** → 返回 `{ template, name }`。
- `mode: 'insert'`（B）：仅模板列表 → 返回 `{ template }`。

空态：模板文件夹未配置/为空时显示提示文案（引导去设置页配置）。

### A — 文件树右键"从模板新建"

- 在文件夹节点（及根）右键菜单注册 "从模板新建"（复用 `ctx.contextMenu`）。
- 流程：弹 `TemplatePicker`(create 模式) → 读模板文件 → `ctx.vault.createFile(目标路径)` → `resolveTemplate`(title = 用户填入名) → `ctx.vault.saveFile` → `ctx.workspace.openFile`。

### B — Ribbon "插入模板"

- 注册 Ribbon 按钮（`ctx.ribbon`）。
- 流程：弹 `TemplatePicker`(insert 模式) → 读模板文件 → `resolveTemplate` →
  - 有激活编辑器：经新原语 `ctx.workspace.insertAtCursor(text, cursorPos?)` 插入到光标处。
  - 无激活编辑器：回退为 create 流程（提示输入文件名后新建）。

#### 新原语：`ctx.workspace.insertAtCursor`

- 在 `PluginContext.workspace` 新增 `insertAtCursor(text: string, cursorPos?: number | null): boolean`。
- 实现：取 `leafInstances[activeLeafId].cmView`（EditorViewer 已将实时 `EditorView` 注册到 leaf runtime），`view.dispatch` 在当前选区替换插入；若提供 `cursorPos` 则把光标设到插入文本内的对应偏移。无激活编辑器返回 `false`。

### daily-note 联动

- 设置页新增"模板"下拉：选项由 `listTemplates()` 填充，含"无"（默认）。选中值存 daily-note 自身 config（模板文件 path）。
- `openToday()` 创建分支改造：`createFile` 成功后，若配置了模板：读模板 → `resolveTemplate`(title = 日期文件名, now = 当天) → `saveFile` → `openFile`。未配置模板则保持现状（空文件）。
- 自动创建（autoCreate）与弹确认框两条路径都套用模板。

## 4. 阶段二：C 编辑器斜杠命令

- 新建 `src/lib/cm6/templateSlashExtension.ts`：基于 `@codemirror/autocomplete`，输入 `/` 触发补全。
- 候选项来自 `listTemplates()`；选中后在光标处插入 `resolveTemplate` 结果，并按 `{{cursor}}` 定位光标（删除已输入的 `/` 触发串）。
- 注册进 `EditorViewer` 的扩展列表，扩展天然持有 `view`，无需经 ctx。

## 5. 边界与取舍

- `{{cursor}}` 定位仅在"插入到编辑器"路径（B 有激活编辑器、C）生效。**新建文件路径（A、日记）剥离 `{{cursor}}` 但不做精确定位**——打开文件是异步的，phase 1 不追求定位。
- 模板文件夹未配置/为空：A、B 的 picker 显示空态；日记下拉仅"无"。
- 模板文件读取失败：toast 报错；新建流程退化为创建空文件（不阻断）。
- A 新建时目标文件已存在：沿用 `ctx.vault.createFile` 现有行为。
- 未识别占位符原样保留，不误删。

## 6. 测试

- `resolveTemplate`：注入固定 `now`，覆盖全部占位符（含 `:FMT`、`{{cursor}}` 单个/多个/缺省、未识别占位符保留、`title` 缺省）。
- `formatDate`：新增 `HH/mm/ss` token 单测，确认 `MM`/`mm` 不互相污染，现有 token 无回归。
- `listTemplates`：文件夹过滤、空态、`.md` 过滤逻辑单测。
- UI/CM6 入口（A 右键、B Ribbon、日记下拉、C 斜杠）手动验证。

## 文件清单（预期）

阶段一：
- 新增 `src/lib/templates/`（占位符引擎、`listTemplates`、`templatesFolder` 配置；`formatDate` 扩展）
- 新增 `src/plugins/templates/`（插件、`TemplatePicker`、设置页）
- 改 `src/lib/pluginRegistry.ts`（`workspace.insertAtCursor` 接口与实现）
- 改 `src/plugins/daily-note/index.tsx`（模板下拉 + 套用）
- 改插件注册入口（注册 `templates` 插件）
- 新增对应 `__tests__`

阶段二：
- 新增 `src/lib/cm6/templateSlashExtension.ts`
- 改 `src/plugins/editor/EditorViewer.tsx`（注册扩展）
