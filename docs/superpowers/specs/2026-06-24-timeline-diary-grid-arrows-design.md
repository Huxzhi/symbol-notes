# 时间轴改进：日记脉 + 日期对齐网格 + 出链箭头 — 设计

> 日期：2026-06-24
> 在已落地的「多列 BFS 时间轴」基础上改进：新增日记专栏作为时间轴脉络，把多列改为按日期对齐的网格，BFS 遍历到日记时不再展开，并在有出链关系的卡片之间画可配样式的箭头。

依据既有实现：`docs/superpowers/specs/2026-06-23-link-context-timeline-design.md` 与 `src/plugins/timeline/`（`selection.ts` / `events.ts` / `columns.ts` / `TimelineView.tsx`）。

---

## 0. 背景与现状

当前时间轴（`src/plugins/timeline/`）：
- `buildNeighborhood(focus, files, backlinkMap, resolve, { maxFiles })` 无向 BFS 产出 `{ notes, edges }`，`Edge` 带 `dir`/`headingPath`/`lineTags`。
- `deriveEvents(neighborhood, files)` 产 `TimelineEvent[]`（含 `path`/`date(created)`/`title`/`tags`/`span`/`linkCount`）。
- `assignColumns(noteIds, edgesByNote, columns)` 按 `Column{filter, priority, repeat}` 归列。
- `TimelineView` 把每列渲染成独立时间序 `<ol>`，列各自排序、行不对齐。

本设计的四项改进：日记专栏脉络、日期对齐网格、BFS 跳过日记展开、出链箭头（样式可配）。

`extractDateFromName(name: string): string | null` 已由 `src/vault` re-export（`src/vault/index.ts` 末尾），timeline 可直接 import。

---

## 1. 日记判定

```ts
// timeline 内部
const isDiary = (path: string) => extractDateFromName(path) != null
```

即**文件名是日期**（如 `journal/2026-06-24.md`）即视为日记。零跨插件耦合，覆盖绝大多数日记场景。`isDiary` 作为参数注入纯函数（`buildNeighborhood` / `buildGrid`），便于测试。

---

## 2. BFS 跳过日记展开

`buildNeighborhood` 增加 `isDiary` 判据，展开时跳过日记节点：

```ts
export function buildNeighborhood(
  focus: string,
  files: Record<string, Pick<FileMeta, 'outLinks'>>,
  backlinkMap: Record<string, string[]>,
  resolve: (target: string) => string | null,
  opts: { maxFiles: number; isDiary: (path: string) => boolean },
): Neighborhood {
  // …
  for (const cur of frontier) {
    if (opts.isDiary(cur) && cur !== focus) continue   // 日记是叶子：收下但不展开其出/入链
    // …原有出边 / 入边扩展…
  }
  // …
}
```

要点：
- 到达日记的那条边由**它的链接者**展开时记录（`addEdge`），因此日记仍进入 `notes` 与 `edges`，照常显示、照常能被箭头指向。
- 仅跳过「从日记继续扩展」，防止日记（常链接大量笔记）把邻域炸开。
- focus 自身即便是日记也照常展开（`cur !== focus`）。
- 整层预算 `maxFiles` 逻辑不变。

---

## 3. 网格数据模型（纯函数 `buildGrid`）

新增 `src/plugins/timeline/grid.ts`。把事件按「日期行 × 列」铺成网格。

```ts
import type { TimelineEvent } from './events'
import type { Edge } from './selection'
import type { Column } from './columns'
import { assignColumns } from './columns'
import { edgesByNote } from './events'

export interface Grid {
  rows: string[]                                      // 排序后的日期；= 所有可见事件 date 的并集
  cells: Map<string, Map<number, TimelineEvent[]>>    // cells.get(date)?.get(colIdx) = 该格卡片（可堆叠）
  arrows: { from: string; to: string }[]              // 两端都可见的出链边（path→path）
}

export function buildGrid(
  events: TimelineEvent[],
  columns: Column[],
  edges: Edge[],
  isDiary: (path: string) => boolean,
): Grid
```

构建规则：
- **列即顺序**：`columns` 是有序列表，**数组次序 = 屏幕从左到右**。每列都是普通 `Column`；其中过滤 `by:'diary'` 的那列即「日记脉」，可放在任意位置（例：左=标题:计划、中=日记、右=标题:反思）。
- **归列**：所有事件经 `assignColumns(events.map(e=>e.path), edgesByNote(edges), columns, isDiary)` 归到各列；列索引 = 该列在 `columns` 中的位置。`by:'diary'` 列匹配 `isDiary(path)` 的事件。`priority` 仅决定 dedupe 抢占（与显示顺序解耦）。
- **行**：`rows` = 所有可见事件 `date` 去重后升序。某日期无日记 → 日记列该行空，但其他列若有该日期卡片照常显示。
- **同格多卡**（同列同日期）→ 数组堆叠，按 `path` 稳定次序。
- **arrows**：`edges.filter(e => e.dir === 'out' && visible.has(e.from) && visible.has(e.to))`，`visible` = `new Set(events.map(e=>e.path))`。日记是 BFS 叶子，故无「从日记发出」的 out 边，只有指向日记的箭头。

`buildGrid` 为纯函数，单测覆盖：行并集与排序、日记进 0 列、其余列 dedupe/repeat、箭头过滤（仅 out 且两端可见）。

---

## 4. 渲染：日期对齐网格

`TimelineView` 用 CSS Grid 渲染（`display:grid`）：
- **列**：`columns` 数组次序（含日记列在内），列宽等分或 `minmax`。
- **行**：`grid.rows`（每个日期一行）。
- 每个事件渲染进 `grid-row = 该日期的行序`、`grid-column = 列序`。同格多卡纵向堆叠。
- **日期对齐对所有列生效**：同一行 = 同一天，无论日记列被放在左/中/右，各列卡片都按其 `date` 行水平对齐。日记列只是视觉上点亮为时间脉络（背景/日期标签），不影响对齐逻辑。
- 行首（最左）固定显示日期标签，作为时间标尺。
- 卡片样式复用现有卡片（日期/标题/缩略图/snippet/tags/linkCount/焦点徽标）。
- 卡片点击：沿用现有 `openCard`（焦点→openFile；反链→openFileAt 定位 `[[focus]]`；否则 openFile）。

容器 `position: relative`，供箭头 SVG 叠层定位。

---

## 5. 出链箭头叠层（DOM 运行时，样式可配）

### 5.1 收集卡片位置

每张卡片注册 ref：`ref={(el) => cardRefs.set(ev.path, el)}`，`onCleanup` 删除。`cardRefs: Map<string, HTMLElement>`。

### 5.2 箭头样式配置

时间轴级单一配置（组件本地 signal）：

```ts
type ArrowStyle = {
  shape: 'straight' | 'elbow' | 'curve'   // 直线 / 正交折线 / 曲线
  color: string                           // 十六进制色，默认 '#6aa0ff'（可改）
}
```

UI：形状下拉（直线/折线/曲线）+ `<input type="color">`（默认值 `#6aa0ff`），放在配置栏。`stroke`/`marker` 均用此色。

### 5.3 计算与重算

```ts
// 对每条 arrows 的 {from,to}：
//   取两卡相对容器的包围盒 → 起点（源卡边缘）→ 终点（目标卡边缘）
//   按 shape 生成 SVG path：
//     straight: M sx sy L ex ey
//     elbow:    M sx sy L mx sy L mx ey L ex ey   （正交折线，mx = 中点）
//     curve:    M sx sy C c1x c1y c2x c2y ex ey   （三次贝塞尔）
//   末端用 <marker> 箭头头，指向 to。
```

- 结果（path d 串数组）存进 signal，`<svg class="absolute inset-0 pointer-events-none">` + `<defs><marker>` 渲染。
- **重算时机**：`createEffect` 依赖 `grid()`（数据/列变化）与 `arrowStyle()`；容器 `ResizeObserver`；滚动监听。卡片数 ≈ `maxFiles`（默认 20），边数有限，重算开销可忽略。
- 箭头几何属 DOM 层，不进单测；靠 `npm run dev` 手动验证。哪些边该画由 `buildGrid.arrows` 决定（已单测）。

---

## 6. 列配置

### 6.1 `ColumnFilter` 增日记类型

`src/plugins/timeline/columns.ts` 的 `ColumnFilter` 新增一种：

```ts
export type ColumnFilter =
  | { by: 'diary' }                        // 新增：日记列（匹配 isDiary(path)）
  | { by: 'heading'; value: string }
  | { by: 'tag'; value: string }
  | { by: 'direction'; value: 'out' | 'in' }
  | null                                   // 全部
```

`assignColumns` / `matches` 增收 `isDiary` 参数：`by:'diary'` 时返回 `isDiary(note)`（其余分支不变）。签名：

```ts
export function assignColumns(
  noteIds: string[],
  edgesByNote: Map<string, Edge[]>,
  columns: Column[],
  isDiary: (path: string) => boolean,
): string[][]
```

### 6.2 重排与编辑

- 每列一个控件块：过滤 `by`（全部/日记/标题/标签/方向 + 值）、`priority`、`repeat`、**左移 `←` / 右移 `→`**（与相邻列交换数组位置）、删除 `✕`。
- 「+ 列」追加一列；可把任意列设为日记列并移到中间，实现「左计划 / 中日记 / 右反思」。
- **显示顺序 = `columns` 数组次序**；`priority` 独立，仅管 dedupe 抢占。
- **dedupe / repeat 语义**（按用户定义）：某卡符合多列过滤时，只在 `priority` 最高（数值最小）的列显示；低优先列不再显示；仅当某列 `repeat: true` 才额外再显示一份。语义不变。
- **默认列**：`[{ filter: { by:'diary' }, priority:0, repeat:false }]`（开局只有日记脉，用户自行加列重排）。

### 6.3 其他

- 保留 `maxFiles` 数值输入。
- 新增**箭头样式**配置（§5.2）。
- 配置均为组件本地 signal（未持久化进 viewState，与现状一致）。

---

## 7. 影响面

| 文件 | 改动 |
|---|---|
| `src/plugins/timeline/columns.ts` | `ColumnFilter` 增 `{by:'diary'}`；`assignColumns`/`matches` 加 `isDiary` 参数 |
| `src/plugins/timeline/__tests__/columns.test.ts` | 补 `by:'diary'` 归列用例（传 isDiary） |
| `src/plugins/timeline/grid.ts`（新） | `buildGrid` + `Grid` 类型 + 测试 |
| `src/plugins/timeline/selection.ts` | `buildNeighborhood` opts 加 `isDiary`，跳过日记展开 |
| `src/plugins/timeline/__tests__/selection.test.ts` | 补「日记不展开 / 入边保留」用例 |
| `src/plugins/timeline/TimelineView.tsx` | CSS Grid 网格渲染 + 卡片 ref + SVG 箭头叠层 + 列重排/箭头样式配置 UI；调用 `buildGrid` |

`extractDateFromName` 已 re-export，无需改 vault 层。

---

## 8. 测试

纯逻辑（node，`npx vitest run`）：
- `assignColumns`（扩充）：`by:'diary'` 列按 `isDiary(path)` 归入；与现有过滤、dedupe、repeat 不冲突。
- `buildGrid`：
  - `rows` = 可见事件日期并集且升序；
  - 列索引 = `columns` 数组次序；日记列可在任意位置；
  - 同格多卡堆叠；
  - `arrows` 仅含 `dir:'out'` 且两端可见的边。
- `buildNeighborhood`（扩充）：
  - 日记节点不展开（其独有邻居不应进入 `notes`）；
  - 指向日记的入边/出边仍保留；
  - focus 自身为日记时照常展开。

箭头几何与网格视觉：`npm run dev` 手动验证（直线/折线/曲线切换、颜色、对齐、跨列连线）。

提交前 `npm run build`（含 tsc）与 `npx vitest run` 均须通过。
