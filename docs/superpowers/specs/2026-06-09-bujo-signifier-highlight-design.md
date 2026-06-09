# BuJo 信号字符整行高亮（第二期 a）— 设计

日期：2026-06-09
状态：已确认，待写实现计划

## 背景与目标

第一期已把所有列表项索引进 `FileMeta.lists`，每项带原始 `signifier` 字符（`listsField` 解析层只存字符、不赋含义）。
第二期(a)做**可见层**：在 CM6 编辑器里，对带 signifier 的列表项**整行加一层有区分度的淡背景色**。

明确约束（来自需求澄清）：
- **不替换字形、不加图标**——前导符号（`-`/`=`/`~`/`!`/`&`）原样保留，用户自己读符号判断含义。
- 只做"按 signifier 给整行上淡背景"这一件事。
- **UI 渲染与解析解耦**：解析层（`listsField`）只给原始 signifier；**语义（signifier→颜色）由渲染插件自己持有**。以后改配色/加符号/换语义只动渲染插件。
- 输入手感**不做**（方案 2 下 `- - 看了电影` 本就自然可打，无需 input rule）。
- dashboard 按类型汇总/过滤是**第二期(b)**，另立 spec。

## 方案

新增 ViewPlugin（非 StateField），规避 StateField 间的声明顺序依赖，且只处理视口内可见行（大文档性能更好）。
ViewPlugin 通过 `view.state.field(listsField)` 读取已解析的列表项（**不重新解析**），自带 `signifier → CSS class` 映射，
对命中行加 `Decoration.line({ class })`。配套 CSS 进 `cmTheme`，颜色用 `color-mix(... , transparent)` 适配深/浅/nord 三主题。

把该插件与 `listsField` 一并纳入 `livePreviewExtension` 的 bundle，使主编辑器与 dashboard 的计划预览**两处自动生效**。

## 组件与改动

### 1. 新文件 `src/lib/cm6/bujoHighlight.ts`

导出：

- `SIGNIFIER_CLASS: Record<string, string>` —— 渲染插件自有的语义映射：

  | signifier | 含义 | class |
  |---|---|---|
  | `-` | 事件 | `cm-bujo-event` |
  | `=` | 心情 | `cm-bujo-mood` |
  | `~` | 想法 | `cm-bujo-idea` |
  | `!` | 重要 | `cm-bujo-important` |
  | `&` | 留意 | `cm-bujo-attention` |

  其余 signifier（或 null）→ 无背景。

- `buildLineClassMap(items: ListItem[]): Map<number, string>` —— 纯函数：遍历 items，
  对 `signifier` 命中 `SIGNIFIER_CLASS` 的项，记 `item.line → class`。供 ViewPlugin 与单测共用。

- `bujoHighlight` —— `ViewPlugin.fromClass`，`{ decorations: v => v.decorations }`：
  - `buildBujoDecos(view)`：`const items = view.state.field(listsField)`；`map = buildLineClassMap(items)`；
    若空直接返回空集；否则对每个 `view.visibleRanges` 逐行遍历，`map.get(line.number - 1)` 命中则
    `builder.add(line.from, line.from, Decoration.line({ class }))`（`RangeSetBuilder`，按 `from` 升序）。
  - `update(u)`：`if (u.docChanged || u.viewportChanged) this.decorations = buildBujoDecos(u.view)`。
    （signifier 仅随文档变化；不依赖光标，故不监听 `selectionSet`——背景常驻。）

依赖：`@codemirror/view`（ViewPlugin/Decoration/DecorationSet）、`@codemirror/state`（RangeSetBuilder）、
`./listsField`（`listsField`）、`../../stores/types`（`ListItem`）。无循环依赖（`listsField` 不反向 import）。

### 2. `src/lib/cm6/cmTheme.ts`

在 `darkTheme`（`EditorView.theme`）对象里加五条整行背景规则（淡蓝/绿/紫/红/黄）：

```ts
'.cm-bujo-event':     { backgroundColor: 'color-mix(in srgb, #4aa3ff 12%, transparent)' },
'.cm-bujo-mood':      { backgroundColor: 'color-mix(in srgb, #56c596 12%, transparent)' },
'.cm-bujo-idea':      { backgroundColor: 'color-mix(in srgb, #9d8dff 14%, transparent)' },
'.cm-bujo-important': { backgroundColor: 'color-mix(in srgb, #ff5a5a 14%, transparent)' },
'.cm-bujo-attention': { backgroundColor: 'color-mix(in srgb, #ffcc44 16%, transparent)' },
```

（`Decoration.line` 把 class 加到该行的 `.cm-line` 元素上，背景覆盖整行。）

### 3. `src/lib/cm6/livePreviewExtension.ts`

把 `listsField` 与 `bujoHighlight` 纳入导出 bundle：

```ts
import { listsField } from './listsField'
import { bujoHighlight } from './bujoHighlight'
// ...
export const livePreviewExtension = [listsField, inlinePreviewPlugin, blockPreviewField, bujoHighlight]
```

- 把 `listsField` 放进 bundle 是为了让"用了 livePreview 的地方"都保证 `listsField` 在 state 里（dashboard 的
  `PlanEditor` 当前未单独加 `listsField`），从而高亮在主编辑器与 dashboard 预览两处都生效。
- `EditorViewer` 已单独把同一个 `listsField`（模块级单例）加进 extensions；CM6 按引用去重，重复纳入无副作用。

## 数据流

1. 文档变化 → `listsField` 重算列表项（含 signifier）。
2. `bujoHighlight` 在 `docChanged`/`viewportChanged` 时读 `listsField`、构建可见行的 line 装饰。
3. 命中 signifier 的行渲染出对应淡背景；前导符号、列表圆点、复选框、文字均不改动。

## 边界与错误处理

- 不在 `SIGNIFIER_CLASS` 里的 signifier、以及任务/普通列表 → 无背景。
- 多行列表项只给**起始行**上背景（`item.line`）；续行不染。Phase 2a 接受此简化。
- 空文档 / 无命中 → 空装饰集，零开销。
- 仅渲染：不改文档内容、不影响解析与索引。

## 测试

新建 `src/lib/cm6/__tests__/bujoHighlight.test.ts`（纯逻辑，不依赖 DOM）：
- `SIGNIFIER_CLASS` 含 `- = ~ ! &` 五键，值为对应 class。
- `buildLineClassMap`：
  - 输入含 `signifier:'-'` 的项（line 2）→ map 有 `2 → 'cm-bujo-event'`。
  - `signifier:'='`/`'~'`/`'!'`/`'&'` 分别映射到 mood/idea/important/attention。
  - `signifier:null`（普通列表）与 `signifier` 不在表内（如 `'*'`）→ 不进 map。
  - 任务项（`task:true, signifier:null`）→ 不进 map。
- 可视化（淡背景实际渲染）留待手动/浏览器验证（ViewPlugin 需真实 EditorView/DOM）。

## 不做（后续）

- dashboard / 视图按 signifier 类型汇总与过滤（第二期 b）。
- 信号字符的输入辅助（input rule / 补全）。
- 替换字形、加图标、状态符号渲染。
- 多行列表项续行高亮、列表嵌套结构。
