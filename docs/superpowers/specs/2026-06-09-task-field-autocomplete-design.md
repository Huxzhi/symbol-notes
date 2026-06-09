# 任务行字段自动补全 + 勾选自动补完成日期 — 设计

日期：2026-06-09
状态：已确认，待实现

## 背景

编辑器（CM6，`src/plugins/editor/EditorViewer.tsx`）中任务以 GFM 语法书写：`- [ ] 文本`。
任务的元数据采用 Dataview 风格的内联字段 `[key::value]`，由 `src/lib/cm6/tasksField.ts` 解析：
当前识别 `[due::…]`（→ `dueDate`）和 `[completion::…]`（→ `completedDate`）。

目标：

1. 在**任务行**内输入 `[`，弹出字段补全：`due` / `completion` / `priority`；选定字段后接着弹出值补全（日期快捷项 / 优先级）。
2. **勾选任务完成**时，自动在行尾追加今天的 `[completion::YYYY-MM-DD]`；取消勾选时删除该字段。

## 方案

采用 CodeMirror 官方的 `@codemirror/autocomplete`（需新增依赖，版本对齐 `@codemirror/view` ^6），
新增扩展文件 `src/lib/cm6/taskFieldComplete.ts`，注册两个链式补全源；
勾选行为改在现有 `src/lib/cm6/livePreviewExtension.ts` 的 `CheckboxWidget` 中实现。

## 组件与改动

### 1. 新文件 `src/lib/cm6/taskFieldComplete.ts`

导出：

- `taskFieldComplete`：CM6 扩展（`autocompletion({ override: [fieldSource, valueSource] })`）。
- `todayISO(): string`：返回今天的 `YYYY-MM-DD`（本地时区），供 `livePreviewExtension` 复用。

辅助：

- `isTaskLine(line: string): boolean` — 判定任务行，正则 `^\s*[-*+] \[.\] `（覆盖标准 `[ ]`/`[x]` 与非标准 `[/]`/`[>]` 等）。
- `offsetISO(days: number): string` — 今天加偏移天数后的 `YYYY-MM-DD`。
- `nextMondayISO(): string` — 下一个周一的日期。

#### 字段级补全源 `fieldSource`

触发：当前行是任务行，且光标前刚好是一个 `[`（排除 `[[`，即前一字符不是 `[`）。
匹配 `matchBefore(/\[$/)`。

选项（`label` / 插入结果，光标 `↳` 标注）：

| label | 插入（替换匹配到的 `[`） | 选定后 |
|---|---|---|
| `due` | `[due::↳]` | 自动 `startCompletion`（进入值级） |
| `completion` | `[completion::↳]` | 自动 `startCompletion` |
| `priority` | `[priority::↳]` | 自动 `startCompletion` |

`apply` 用自定义函数：`view.dispatch` 插入文本并把光标放到 `::` 与 `]` 之间，
随后 `startCompletion(view)` 触发值级补全。

#### 值级补全源 `valueSource`

触发：光标前匹配 `/\[(due|completion|priority)::([^\]\n]*)$/`。
捕获组 1 决定值列表，从 `::` 之后到光标为补全替换区间。

- `due` / `completion` → 日期快捷项（见下表），插入纯日期串（如 `2026-06-09`），光标落到 `]` 之后。
- `priority` → `high` / `medium` / `low`，插入纯文本。

日期快捷项（相对今天，`detail` 显示算出的具体日期）：

| label | 计算 |
|---|---|
| 今天 | `offsetISO(0)` |
| 明天 | `offsetISO(1)` |
| 后天 | `offsetISO(2)` |
| 昨天 | `offsetISO(-1)` |
| 一周后 | `offsetISO(7)` |
| 上周（一周前） | `offsetISO(-7)` |
| 下周一 | `nextMondayISO()` |

### 2. 解析器 `src/lib/cm6/tasksField.ts` + 类型

- `TaskItem`（`src/stores/types.ts`）新增 `priority: string | null`。
- `buildTask` 新增 `priority: fields['priority'] ?? null`。
- 其余不变（`completion` 已映射为 `completedDate`）。

### 3. 勾选自动补完成日期 `src/lib/cm6/livePreviewExtension.ts`

改 `CheckboxWidget.toDOM` 的 `mousedown` 处理，用单个 transaction 同时改标记与行尾：

- 计算所在行 `line = view.state.doc.lineAt(markerFrom)`。
- 勾选完成（当前 `checked === false` → 插入 `[x]`）：
  若 `line.text` 不含 `[completion::…]`，在 `line.to` 追加 ` [completion::${todayISO()}]`。
- 取消完成（当前 `checked === true` → 插入 `[ ]`）：
  若 `line.text` 含 `[completion::…]`（正则 ` ?\[completion::[^\]\n]*\]`），从行内删除该片段（连同前导空格）。
- 标记改动（`from=markerFrom, to=markerFrom+3`）与行尾改动放进同一次 `view.dispatch` 的 `changes` 数组。

从 `taskFieldComplete.ts` 导入 `todayISO`。

### 4. 接线

- `EditorViewer.tsx` 的 `buildEditorState` extensions 数组加入 `taskFieldComplete`。
- `package.json` 新增依赖 `@codemirror/autocomplete`（^6，对齐其它 `@codemirror/*`）。
- 补全下拉沿用现有 `darkTheme`；若默认样式与主题不协调，在 `taskFieldComplete` 内附一小段 `EditorView.theme` 调整 `.cm-tooltip-autocomplete` 配色（用 CSS 变量 `--bg`/`--text`/`--accent`）。

## 数据流

1. 用户在任务行输入 `[` → `fieldSource` 弹出三字段。
2. 选 `due` → 插入 `[due::]`、光标居中、`startCompletion` → `valueSource` 弹日期项。
3. 选「明天」→ 插入 `2026-06-09` 之类，得到 `[due::2026-06-10]`。
4. 点击复选框 → `CheckboxWidget` 切标记并自动加/删 `[completion::今天]`。
5. 文档变更触发 `tasksField` 重新解析 → `EditorViewer` 防抖 reindex，`priority` 一并进索引。

## 边界与错误处理

- 非任务行的 `[`、`[[`（wiki 链接）不触发字段补全。
- 已存在 `[completion::…]` 时勾选不重复追加。
- 取消勾选时只删第一个 `[completion::…]` 片段。
- 值级补全在已输入部分日期/文字时仍能按前缀过滤（CM6 默认 `validFor`/filter 行为）。

## 测试

- 单元测试 `src/lib/cm6/__tests__/taskFieldComplete.test.ts`：
  - `isTaskLine` 对标准/非标准/普通列表/普通文本的判定。
  - `offsetISO` / `nextMondayISO` / `todayISO` 的日期计算（注入固定 `Date`）。
  - `fieldSource` / `valueSource`：构造 `CompletionContext`，断言返回的选项与替换区间、`due/priority` 分支。
- 解析器：`src/lib/__tests__/tasksField.test.ts`（若已存在则扩展）断言 `[priority::high]` → `priority: 'high'`。
- 勾选行为：对 `CheckboxWidget` 的逻辑可抽出纯函数 `toggleTaskLine(text, willCheck) → {markerInsert, lineEdit}` 便于单测追加/删除 `[completion::…]`。

## 不做（YAGNI）

- 不支持自定义字段集合配置（先硬编码三字段）。
- 不做日期选择日历弹窗（仅相对快捷项 + 手动续打）。
- 不在补全里支持 emoji 优先级。
