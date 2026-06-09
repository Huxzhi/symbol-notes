# file.lists 列表项索引（第一期）— 设计

日期：2026-06-09
状态：已确认，待写实现计划

## 背景与目标

软件已有任务系统：`- [ ] 文本` 由 `tasksField`（CM6 StateField）解析成 `TaskItem`，
既用于编辑器、也经 `parseMarkdown` 用于全库扫描；结果存进 `FileMeta.tasks`，
聚合成 `vaultStore.taskMap` 供 dashboard 读取。

目标是引入 Dataview 风格的 **`file.lists`**：把**所有列表项**（不只是任务）索引进文件缓存，
任务成为"带复选框的列表项"这一子集。子弹笔记（BuJo）的信号字符（`*`/`=`/`!`/`&` 等）
只作为列表项上的一个属性原样保存，**第一期不解释其含义、不渲染、不做 dashboard 过滤**——
那些属于第二期。第一期只交付可解析、可索引、可持久化的数据地基。

本期为整体 BuJo 工作的第一个子项目。第二期（信号字符渲染、输入手感、dashboard 按类型过滤）
另立 spec。

## 方案

**泛化单一数据源**：把 `tasksField` 升级为 `listsField`，一次扫描抓取全部列表项，
产出 `ListItem[]`。`tasks` 不再独立解析，而是 `lists` 中 `task === true` 的子集派生而来。
符合 Dataview "task ⊂ list"，杜绝两套数据漂移。现有读任务的代码改读 `ListItem`（见迁移）。

## 数据模型

`TaskItem` **删除**，全库统一为 `ListItem`（`src/stores/types.ts`）：

```ts
export interface ListItem {
  text: string                    // 列表标记后、剥掉前导 token（复选框/信号字符）的正文；仍含 [k:: v]
  visual: string                  // text 再去掉 [k:: v] 内联字段后的纯展示文本
  line: number                    // 0-based 起始行
  lineCount: number               // 该列表项跨的物理行数（≥1）
  symbol: string                  // 列表标记原文：'-' / '*' / '+'，或有序列表的 '1.' / '2.' / '1)'
  signifier: string | null        // 前导单个非词字符（* = ~ ! & … ）；无则 null
  status: string | null           // 复选框字符 ' '/'x'/'X'/'/'/'>' …；非复选框为 null
  checked: boolean                // status === 'x' || status === 'X'
  task: boolean                   // status !== null（是否任务）
  fields: Record<string, string>  // [k:: v] 内联字段（key/val 均 trim）
  tags: string[]                  // 行内 #标签（不含 #）
}
```

字段语义补充：
- `text` **不含**前导 token 与信号字符；`visual` 在 `text` 基础上再剥字段。
- `signifier` 与 `status` 互斥：一行要么是复选框任务（`status` 有值、`signifier` 为 null），
  要么有信号字符（`signifier` 有值、`status` 为 null），要么都为 null（普通列表）。
- 分类交给消费方：第一期不存 `type`，dashboard/插件自行按 `signifier`/`task` 判断。

## 解析规则（`listsField`）

用语法树定位列表项，再对每项首行做内容解析。

### 1. 收集列表项

`syntaxTree(state).iterate`，遇 `FencedCode`/`CodeBlock` 整段跳过（`return false`，沿用 tasksField 的做法）。
对每个 `ListItem` 节点：
- `symbol`：该节点 `ListMark` 子节点的原文——无序 `-`/`*`/`+`，有序 `1.`/`2.`/`1)` 等，原样保存。
- 起始行 `line = doc.lineAt(ListMark.from).number - 1`。
- `lineCount = doc.lineAt(node.to).number - doc.lineAt(node.from).number + 1`（节点跨行数，≥1）。
- 待解析内容 `content`：`ListMark` 之后到该项首行行尾的文本（即 `doc.sliceString(listMarkEnd+1, firstLine.to)`，再 `trimStart`）。
  本期 `text`/`signifier`/`status`/`fields` 只看首行内容，多行续行不并入 `text`（`lineCount` 已记录跨度供定位）。

### 2. 解析单项内容 `content`（按优先级）

1. **任务（复选框）**：`/^\[(.)\]\s+(.*)$/` 匹配 → `status = m[1]`，`task = true`，`signifier = null`，
   `rawBody = m[2]`。（覆盖 `[ ]`/`[x]`/`[/]`/`[>]` 等任意单字符状态。）
2. **信号字符**：否则 `/^([\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E])\s+(.*)$/` 匹配 → `signifier = m[1]`，
   `status = null`，`task = false`，`rawBody = m[2]`。该字符类是**全部 ASCII 标点/符号**
   （`! " # $ % & ' ( ) * + , - . / : ; < = > ? @ [ \ ] ^ _ \` { | } ~`），刻意**排除字母、数字、中文**
   （`[^\w\s]` 会误吃中文字符如「看」，故不用）。要求符号后**有空格**才算正文——`*斜体*`、`[[链接]]`、
   `#tag` 等无空格者不会误判。
3. **普通**：否则 `signifier = null`，`status = null`，`task = false`，`rawBody = content`。

`checked = status === 'x' || status === 'X'`。

### 3. 从 `rawBody` 提取字段、标签、文本

- `fields`：用现有 `INLINE_FIELD_RE = /\[([^\]]+?)::([^\]]*)\]/g` 扫 `rawBody`，`fields[key.trim()] = val.trim()`。
- `text = rawBody.trim()`（含字段原文）。
- `visual`：`rawBody` 去掉 `[k:: v]` 片段、折叠多余空白后 `trim()`（复用 tasksField 现有 `cleanText` 逻辑）。
- `tags`：复用 `inlineTagsField` 现有标签正则 `/(?<!\S)#([a-zA-Z_一-龥][a-zA-Z0-9_一-龥\/-]*)/g`
  扫 `rawBody`，去重收集（不含 `#`）。

### 4. 排序

按 `line` 升序，保持文档顺序（沿用 tasksField）。

## 管线接入

### `src/lib/cm6/tasksField.ts` → `listsField`

- 重命名导出：`tasksField` → `listsField`，类型 `StateField<ListItem[]>`，`extractTasks` → `extractLists`。
- `buildTask` → `buildListItem`，产出上面的 `ListItem`。
- 第一期我们刚加的自动补全（`taskFieldComplete`/`fieldCompletionSource`/`valueCompletionSource`/
  `completionLineEdit`/日期辅助）原样保留在本文件，不受影响。

### `src/lib/parseMarkdown.ts`

- `ParseResult.tasks: TaskItem[]` → `lists: ListItem[]`。
- `extractResult` 读 `state.field(listsField)`。

### `src/vault/scan.ts` 与 `src/vault/index.ts`

- Phase 2 内容解析与 `reindexFile` 把 `rawListItems` 写进 `FileMeta.lists`（字段从 `tasks` 改名 `lists`）。
- 这两处当前对 `rawTaskItems` 做的 `.map(...)` 规整逻辑改为产出 `ListItem`（多数字段直传）。
- `applyFileTasks(path, fields.lists.filter(l => l.task))` —— taskMap 只收任务子集。

### `src/stores/types.ts`

- 删 `TaskItem`，加 `ListItem`。
- `FileMeta.tasks` → `FileMeta.lists: ListItem[]`。
- `VaultState.taskMap: Record<string, TaskItem[]>` → `Record<string, ListItem[]>`（仍叫 taskMap，只含 `task` 项）。

### `src/vault/tasks.ts`

- `buildTaskMap(files)`：遍历 `files`，`const ts = meta.lists.filter(l => l.task)`，`if (ts.length) result[path] = ts`。
- `applyFileTasks` / `removeFileTasks` 签名改 `ListItem[]`。

### 持久化 `src/vault/indexStorage.ts`

- `CachedFields` 的 `'tasks'` 改为 `'lists'`。
- 缓存按 content-hash 存：旧条目缺 `lists`。读取处（scan/index 用 `getCachedMeta`/`getManyMeta` 的地方）
  把 **`entry.lists === undefined` 视为 cache-miss**，重新解析并 `setCachedMeta` 覆盖。
  无需改 key、无需清库；旧 `tasks` 字段随覆盖自然淘汰。

### 消费方迁移（`TaskItem` → `ListItem`，`cleanText` → `visual`）

- `src/plugins/dashboard/dashboardUtils.ts`：`WeekTask = ListItem & { path }`；`buildWeekTaskData` 仍读
  `task.fields['due']`，不受影响。
- `src/plugins/dashboard/DashboardViewer.tsx`：渲染 `task.cleanText` → `task.visual`。
- `src/plugins/calendar/calendarUtils.ts` 与 `CalendarViewer.tsx`：`TaskItem` → `ListItem`，
  `cleanText` → `visual`（其余按 `fields`/`checked` 读，逻辑不变）。

## 数据流

1. 编辑/扫描 → `listsField` 抓全部列表项 → `ListItem[]`。
2. `reindexFile`/scan → `FileMeta.lists`（持久化进 meta 缓存）。
3. `buildTaskMap`/`applyFileTasks` 过滤 `task===true` → `taskMap`。
4. dashboard/calendar 读 `taskMap`（现仍只关心任务），展示文本用 `visual`。
5. 完整 `file.lists` 已就绪，供第二期做信号字符渲染与按类型过滤。

## 边界与错误处理

- 代码块内的"列表"不计入（语法树整段跳过）。
- 有序列表（`1.`/`1)`）与无序列表一视同仁，`symbol` 存原始标记；内容解析（复选框/信号字符/字段）一致。
- `- *斜体*`、`- [[链接]]`、`- #tag`（符号后无空格）→ 普通列表项，`signifier` 为 null，`text` 保留原文。
- 空任务 `- [ ]`（复选框后无正文）：`text`/`visual` 为空串，`task=true`，合法收录。
- 旧缓存缺 `lists` → 重解析覆盖，不报错。

## 测试

扩展 `src/lib/__tests__/tasksField.test.ts`（或新建 `listsField.test.ts`）：
- 普通列表项：`- 买牛奶` → `{ task:false, signifier:null, status:null, text:'买牛奶', visual:'买牛奶', symbol:'-' }`。
- 有序列表项：`1. 第一步` → `{ symbol:'1.', task:false, text:'第一步' }`；`2. [ ] 做事` → `{ symbol:'2.', task:true, status:' ' }`。
- 任务：`- [ ] 写报告 [due:: 2026-06-09]` → `{ task:true, status:' ', checked:false, text:'写报告 [due:: 2026-06-09]', visual:'写报告', fields:{due:'2026-06-09'} }`。
- 完成任务：`- [x] done` → `{ task:true, checked:true, status:'x' }`。
- 信号字符：`- * 看了电影` → `{ signifier:'*', task:false, text:'看了电影', visual:'看了电影' }`；
  `- = 今天很开心` → `signifier:'='`；`- ! 注意` → `signifier:'!'`；`- & 留意` → `signifier:'&'`。
- 误判保护：`- *斜体* 文本` → `signifier:null`（`*` 后无空格），`text:'*斜体* 文本'`。
- 字段剥离：`- ~ 想法 [k:: v]` → `signifier:'~'`，`visual:'想法'`，`fields:{k:'v'}`。
- 标签：`- 看书 #读书` → `tags:['读书']`。
- 行定位：第 3 行的项 `line===2`；单行项 `lineCount===1`。
- 代码块跳过：``` ```\n- [ ] x\n``` ``` 内不产生列表项。
- 派生：`buildTaskMap` 只保留 `task===true` 的项。

## 不做（第二期）

- 信号字符的语义/渲染（`•`/`=`/`—`、红黄背景高亮）。
- 输入手感（input rule / 快捷插入）。
- dashboard / 视图按 `signifier` 类型过滤与展示。
- 列表项嵌套父子结构（本期扁平，`lineCount` 仅记跨度）。
