# 双链上下文地基 + 多列时间轴 — 设计

> 日期：2026-06-23
> 目标：给双链挂上"标识"(所属标题、同行标签、别名/锚点、位置),支持点击精确跳转;并把焦点时间轴重做成「BFS 邻域 + 多列过滤」视图。本设计先打地基(链接上下文),上层功能(跳转、时间轴)读这块地基。

---

## 0. 背景与现状

- `FileMeta.outLinks: string[]`(`src/stores/types.ts` / `src/vault/index.ts`)目前只存归一化后的 wiki 目标字符串,喂 `backlinkMap` 索引(`src/vault/backlinks.ts`)。
- CM6 的 `outLinksField`(`src/lib/cm6/outLinksField.ts`)解析出 `{ type, target, label }`,含外部 URL 链接,供「链接」面板(`src/plugins/links/index.tsx`)展示。
- 解析缓存按 **contentHash** 存(`src/vault/indexStorage.ts`,store `sn-meta-v2`);启动时 `(size, mtime)` 快速路径决定 unchanged/changed(`scanPhase1`),内容变了走 hash 缓存(`parseAll`)。
- 时间轴(`src/plugins/timeline/`)目前:`buildSelection` 取 focus 的 1 跳邻域(出链 + `backlinkMap[focus]`),`deriveEvents` 按 `created` 排成单列,卡片 `openFile` 打开,无任何链接上下文、无精确跳转。

**痛点 / 目标**:双链是扁平字符串,承载不了"标题/标签/方向"等语义,导致(a)无法按上下文分组反链、(b)无法精确跳到某条链接、(c)时间轴只能做无差别 1 跳邻域。本设计补齐这块地基。

---

## 1. 数据模型

### 1.1 不动的部分

**核心原则(对齐原"双链规范" §1):`outLinks` 只存自身文件的本地事实,不存解析结果。** 即每条链接存的是「原始目标名 + 在本文件中的位置 + 所属标题行 + 同行标签」;这条链接到底指向哪个 md(`target name → path`)**不存**,在渲染/查询时去全局 `nameToPath`(现有的 `stemIndex`/`aliasIndex`,见 `src/vault/backlinks.ts`)实时解析。

- 外部 URL 链接仍只活在 `outLinksField`,不进 `FileMeta.outLinks`。

### 1.2 `FileMeta.outLinks` 升级为结构数组

`FileMeta.outLinks` 从 `string[]` 改为 `WikiLinkInfo[]`(`src/stores/types.ts`)。**不引入独立的全局 map**——上下文就长在 outLinks 本身:

```ts
type WikiLinkInfo = {
  target: string          // [[]] 内写的原始目标名(可能含路径/.md),存意图、不存 resolve 后的 path
  alias?: string          // [[目标|别名]]
  anchor?: string         // [[目标#标题]] 的 # 后半段
  headingPath: string[]   // 链接所在的 ## 标题路径,如 ["实验记录","计划"]
  lineTags: string[]      // 与链接同一行出现的 #标签(不含 #)
  from: number            // 链接在本文件中的起始字符 offset
  to: number              // 结束 offset
}
```

`target` 保留写入时的原样(只做轻量归一,如统一是否带 `.md`),因为目标可能尚未创建或会改名,resolve 一律推迟到查询时。

### 1.3 为什么 offset 能安全持久化

`FileMeta.outLinks` 经解析缓存(`CachedFields`)按 **contentHash** 落盘。内容一变 → hash 变 → 缓存 miss → 重解析得新 offset;hash 命中时内容必然一字不差,存的 `from/to` 必然对得上。**因此不需要原"双链规范" §10 那套 mtime 守门**——hash 键缓存天然保证 offset 有效。

### 1.4 resolve-on-query 不变

`target name → path` 的解析仍走查询时实时完成(`resolveLink` via `stemIndex`/`aliasIndex`)。本设计**不持久化任何 resolve 结果**,只是把每条链接的本地上下文补全。`backlinkMap`(派生入链索引)仍由 outLinks 的 target 倒排现算,语义不变。

### 1.5 持久化与升版

- `CachedFields`(`src/vault/indexStorage.ts`)里 `outLinks` 的元素类型从 `string` 变为 `WikiLinkInfo`(不新增并行字段)。
- 缓存 store 名 `sn-meta-v2` → `sn-meta-v3`:形状变,旧缓存自动失效、下次扫描重解析,无需写就地迁移脚本。

### 1.6 响应式

`FileMeta.outLinks` 已在 `vaultStore`(`createStore`)里,本就是响应式;reindex 后读它的 Solid 视图(时间轴、链接面板)自动刷新,无需额外信号。

---

## 2. 解析层

### 2.1 `outLinksField.ts`(产出 WikiLinkInfo)

`extractOutLinks` 遍历 `syntaxTree` 时,额外维护一个**标题栈**:

- 遇 `ATXHeading1..6` / `SetextHeading1..2` 节点:按"弹出所有 `level >= 当前` 的,再压栈"维护(原双链规范 §6.2)。`iterate` 是文档序前序遍历,到达 `WikiLink` 时其前面的标题都已访问过,栈即当前上下文。
- 遇 `WikiLink` 节点:
  - 复用现有 target/alias 解析;
  - 从 target 切出 `anchor`(`#` 后半段);
  - `headingPath` = 当前栈各级标题文本快照;
  - `lineTags` = 该链接所在行(`state.doc.lineAt(node.from)`)内的标签;
  - `from/to` = 节点的起止 offset。
- 仍跳过 `FencedCode` / `CodeBlock`。

### 2.2 纯函数拆分(各配 `__tests__`,遵循 CLAUDE.md 的 cm6 约定)

- `headingText(node, state): string` —— 从 heading 节点抽纯文本(去 `#` 标记/前后空白)。
- `matchTagsInText(text): string[]` —— 从一行文本抽标签。**与 `inlineTagsField` 共用同一 matcher**(把现有标签正则/逻辑提成共享纯函数),保证两处对标签的判定一致。
- 标题栈维护逻辑可独立成纯函数便于测。

### 2.3 `parseMarkdown.ts`

`ParseResult.outLinks` 的类型从 `string[]` 改为 `WikiLinkInfo[]`(wiki only)。`extractResult` 从增强后的 `outLinksField` 读取。所有下游(reindex、parseAll、backlinks)改读 `l.target`(见 §3)。

---

## 3. 索引层

### 3.1 写入路径

- `parseAll`(`src/vault/scan.ts`):解析产出的 `outLinks: WikiLinkInfo[]` 直接进 `FileMeta` 与缓存,无额外写入目标。
- `reindexFile`(`src/vault/index.ts`):单文件保存后照旧写 `FileMeta.outLinks`,只是元素类型变了。
- `applyFileBacklinks` / `removeFileBacklinks` / `remapFileLink`:这些只需 target 的地方改成读 `l.target`(把 `outLinks` 映射成 `target[]` 再走原逻辑),diff/倒排逻辑不变。

### 3.2 `backlinks.ts`

把遍历 `meta.outLinks`(原 `string[]`)的几处改为读 `l.target`(`buildLinkMaps`、`removeFileBacklinks` 等)。`resolveLink`、`backlinkMap`/`unresolvedMap` 的语义与结构**不变**。反链的上下文(标题/标签/位置)在需要时从**源文件的 `FileMeta.outLinks`** 现查:给定 focus,遍历 `backlinkMap[focus]` 的每个 source,在 `files[source].outLinks` 里找 resolve 到 focus 的条目,取其 `headingPath/lineTags/from/to`。

---

## 4. 点击跳转

### 4.1 原则

定位**以打开后的活文档为准**;`FileMeta.outLinks` 里的 offset 仅作提示。理由:目标文件可能在上次解析后被外部改过(虽 hash 缓存会让 offset 自洽,但活文档可能正被编辑),让编辑器现找最稳。

### 4.2 工作区能力

新增 `workspaceActions.openFileAt(path, reveal)`:

```ts
type RevealRequest =
  | { kind: 'wikilink'; targetStem: string; headingPath?: string[] } // 反链/时间轴:在源文档里找 [[focus]]
  | { kind: 'heading';  text: string }                               // 编辑器锚点:在目标文档里找 ## 标题
```

机制:`openFileAt` 把 `reveal` 挂到目标 leaf 的运行时实例上;编辑器组件挂载且文档就绪时**消费一次**——跑定位器得 `{from,to}` → `view.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) })` → 清掉 reveal。

### 4.3 纯定位器(放 `src/lib/`,配 `__tests__`)

```ts
findWikiLink(doc: string, targetStem: string, headingPathHint?: string[]): { from, to } | null
//   扫 [[<stem>...]](容忍 路径/别名/锚点);多处命中且给了 hint → 选 headingPath 匹配的那条,否则取第一处。
findHeading(doc: string, text: string): { from, to } | null
//   扫 ATX/Setext 标题行,文本匹配 → 返回该标题起止。
```

### 4.4 三处接线

- **反链面板入链**(`src/plugins/links/index.tsx`):点入链 → `openFileAt(source, { kind:'wikilink', targetStem: focusStem, headingPath })`,其中 `headingPath` 取自 source 的 `FileMeta.outLinks` 那条,用于消歧。顺带:入链可按 headingPath 分组展示。
- **编辑器 wikilink**:`[[目标]]` → 现有 `openFile`;`[[目标#标题]]` → `openFileAt(目标, { kind:'heading', text: anchor })`。
- **时间轴卡片**:反链卡 → 同反链面板那条 reveal;出链卡 → 普通 `openFile`。

---

## 5. 多列时间轴(BFS 邻域 + 列过滤)

把原"1 跳左右分栏"升级为「带预算的 BFS + 多列过滤」;左右分栏成为"两列"的特例。

### 5.1 遍历:带预算的 BFS

`src/plugins/timeline/selection.ts` 的 `buildSelection` 升级为 `buildNeighborhood`:

```ts
buildNeighborhood(
  focus: string,
  files: Record<string, Pick<FileMeta, 'outLinks'>>,  // outLinks 现在是 WikiLinkInfo[]
  backlinkMap: Record<string, string[]>,
  resolve: (target: string) => string | null,
  opts: { maxFiles: number },
): {
  notes: { path: string; hop: number }[]   // hop = 距焦点跳数
  edges: Edge[]
}

type Edge = {
  from: string
  to: string
  dir: 'out' | 'in'        // 该边相对其链接物理所在文件的方向
  headingPath: string[]    // 链接站点的标题上下文
  lineTags: string[]       // 链接站点的同行标签
}
```

规则:
- 从 focus 出发,**无向**地沿出链 + 入链逐层扩展;每条边仍记住自身方向(`out` = focus 侧射出方向链;`in` = 别人射向该侧)。
- 边的上下文取**链接物理所在处**:`out` 边取源侧 `files[src].outLinks` 里 resolve 到目标的那条;`in` 边取对侧 `files[other].outLinks` 里 resolve 到本侧的那条。
- **按层推进、整层保留**:扩完一层后,若累计文件数 ≥ `maxFiles`(默认 20),停止再扩,不切半层。
- `maxFiles` 存进时间轴 viewState。

### 5.2 列模型

```ts
type ColumnFilter =
  | { by: 'heading';   value: string }   // 连接该笔记的某条边 headingPath 含 value
  | { by: 'tag';       value: string }   // 边 lineTags 含 value
  | { by: 'direction'; value: 'out' | 'in' }
  | null                                  // 不过滤(全部相关笔记 = 时间序主列)

type Column = {
  filter: ColumnFilter
  priority: number    // 越小越先抢
  repeat: boolean     // false:已被更高优先级列收走的不再出现;true:允许重复显示
}
```

- 至少一列 `filter: null` 的时间序主列(向后兼容当前单列)。
- "增加列数" = 往配置加 `Column`;左右分栏 = 两列特例。
- 归列:每个 path 按 `priority` 升序找第一个匹配列归入;`repeat:true` 的列额外把所有匹配项也收一份。
- 每列内部各自按 `created` 排序。
- 列配置存进 timeline viewState。

### 5.3 渲染与纯函数

- `deriveEvents` 仍产时间事件(`TimelineEvent`),每个事件聚合它所有边的 `headingPath/lineTags`(并集)+ 是否有 out/in 边,作为归列依据。
- 新增纯函数 `assignColumns(events, edges, columns): TimelineEvent[][]`,单独配 `__tests__`。
- `TimelineView.tsx` 渲染 N 列;顶部一个列配置 UI(选 filter 维度+值、priority、repeat、maxFiles)。

### 5.4 v1 范围约定

- 每列**单条件**过滤(标题/标签/方向三选一);多条件 AND 留作后续(YAGNI)。
- BFS 无向、整层预算判定(见 5.1)。

---

## 6. 影响面清单

| 文件 | 改动 |
|---|---|
| `src/lib/cm6/outLinksField.ts` | 维护标题栈,WikiLink 产出 `WikiLinkInfo`(headingPath/lineTags/anchor/from/to) |
| `src/lib/cm6/inlineTagsField.ts` | 提取共享 `matchTagsInText` matcher |
| `src/stores/types.ts` | `FileMeta.outLinks: string[]` → `WikiLinkInfo[]`;新增 `WikiLinkInfo` 类型 |
| `src/lib/parseMarkdown.ts` | `ParseResult.outLinks` 类型变为 `WikiLinkInfo[]` |
| `src/vault/indexStorage.ts` | `CachedFields.outLinks` 元素类型变;store 升 `sn-meta-v3` |
| `src/vault/scan.ts` (`parseAll`) | 写 `WikiLinkInfo[]` 进 FileMeta/缓存(无并行字段) |
| `src/vault/index.ts` | `reindexFile`/`createFile` 等初始化 outLinks 形状;`openFileAt` 接 workspace;`remapFileLink` 读 `l.target` |
| `src/vault/backlinks.ts` | 遍历 outLinks 处改读 `l.target`;`resolveLink`/索引语义不变 |
| `src/stores/workspaceStore.ts` | `openFileAt` + leaf 上的 reveal 挂载/消费 |
| `src/lib/linkLocate.ts`(新) | `findWikiLink` / `findHeading` 纯函数 + 测试 |
| 编辑器组件 | 挂载时消费 reveal;wikilink 点击分发 reveal |
| `src/plugins/links/index.tsx` | 入链点击带 reveal;可按 headingPath 分组 |
| `src/plugins/timeline/selection.ts` | `buildSelection` → `buildNeighborhood`(BFS + 预算 + Edge 上下文) |
| `src/plugins/timeline/events.ts` | 事件聚合归列依据;新增 `assignColumns` |
| `src/plugins/timeline/TimelineView.tsx` | 多列渲染 + 列配置 UI;卡片带 reveal |

---

## 7. 测试

纯逻辑(node 环境,`npx vitest run`):
- `outLinksField`:标题栈、anchor 切分、lineTags、offset。
- `matchTagsInText`:与 inlineTags 行为一致。
- `findWikiLink` / `findHeading`:多命中消歧、锚点、无命中。
- `buildNeighborhood`:BFS 跳数、整层预算截断、双向边与上下文取值。
- `assignColumns`:优先级归属、repeat 重复显示、null 主列。

提交前 `npm run build`(含 tsc)与 `npx vitest run` 均须通过。
