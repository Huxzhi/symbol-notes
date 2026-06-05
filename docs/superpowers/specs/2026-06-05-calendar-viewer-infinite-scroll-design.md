# CalendarViewer 无限滚动 + 类型过滤 设计

**日期**：2026-06-05  
**范围**：`CalendarViewer`（日历大图视图）重构为多月连续无限滚动，工具栏过滤器改为可交互 checkbox，过滤状态持久化到插件配置。

---

## 背景

当前 `CalendarViewer` 采用固定 7 列等高网格，每次只显示一个月（通过 ◀ ▶ 切换）。行高由 CSS `grid-auto-rows: 1fr` 均分，内容多时每格内部滚动。工具栏图例为静态展示，不可交互。

目标：
1. 改为多月连续纵向滚动，支持双向无限延伸
2. 行高由内容自然撑开，使用虚拟列表保证性能
3. 工具栏五类过滤 checkbox，过滤状态持久化到插件 localStorage

---

## §1 整体架构

### 布局变化

```
CalendarViewer
  ├─ Toolbar                    固定在顶部，不随内容滚动
  │    ├─ 今天按钮              scrollToIndex 定位当月
  │    └─ 5个过滤 checkbox
  ├─ 固定周头行                 一 二 三 四 五 六 日（shrink-0）
  └─ VirtualScroller            flex-1 overflow-y-auto
       └─ 绝对定位容器（getTotalSize px 高）
            └─ For virtualItems → RowRenderer
```

移除 ◀ ▶ 翻月按钮，导航改为滚动。

### 行模型

虚拟列表的数据单元是扁平的 `CalRow[]`，有两种行类型：

```ts
type MonthHeaderRow = { type: 'month-header'; year: number; month: number }
type WeekRow        = { type: 'week'; cells: (DayRef | null)[] }  // 7 元素
type DayRef         = { year: number; month: number; day: number; dayStr: string }
type CalRow         = MonthHeaderRow | WeekRow
```

一个月展开为：`[MonthHeaderRow, WeekRow, WeekRow, ..., WeekRow]`（1 + 4~6 行）。

### 初始状态

以当前月为中心，前后各 3 个月，生成约 30 行作为初始数据。

---

## §2 过滤器与持久化

### 过滤类型（5 种）

| Key | 含义 | 颜色 |
|-----|------|------|
| `dated` | 日记（文件名含日期） | `--text-2`（灰） |
| `created` | 新建文件 | `--accent`（蓝） |
| `updated` | 修改文件 | `--link-2`（绿） |
| `pending` | 待办任务 | `--tag`（紫） |
| `done` | 已完成任务 | `--text-4`（浅灰）|

取消勾选某类型 → 该类型条目在所有日格中完全隐藏。

### 持久化模式

与 `DashboardViewer` 相同：`CalendarPlugin.setup()` 将 `ctx.settings.getConfig` / `ctx.settings.setConfig` 作为 props 传入组件，底层自动持久化到 `localStorage` key `sn-plugin-calendar`。

```ts
// CalendarPlugin.setup() 中包装组件
component: (viewProps) => (
  <CalendarViewer
    {...viewProps}
    getConfig={(d) => ctx.settings.getConfig(d)}
    setConfig={(p) => ctx.settings.setConfig(p)}
  />
)
```

```ts
// CalendarViewer 内读写
const FILTER_DEFAULTS = {
  dated: true, created: true, updated: true, pending: true, done: true,
}
const filter = () =>
  (props.getConfig({ filter: FILTER_DEFAULTS }).filter ?? FILTER_DEFAULTS) as typeof FILTER_DEFAULTS

const toggleFilter = (key: keyof typeof FILTER_DEFAULTS) =>
  props.setConfig({ filter: { ...filter(), [key]: !filter()[key] } })
```

`getConfig` 在 SolidJS 响应式上下文中访问 store proxy，filter 变更自动触发重渲染。

### Toolbar UI

```
[今天]  [✓日记●] [✓新建●] [✓修改●] [✓待办●] [✓已完成●]
```

- 每个 checkbox 用彩色圆点替代原生样式
- 勾选时圆点实色，取消时圆点变 `--text-4`（灰）
- 点击整个 label 区域触发切换

---

## §3 数据层

### 新增工具函数（`calendarUtils.ts`）

```ts
// 将单个月展开为 CalRow[]
export function buildMonthRows(year: number, month: number): CalRow[]

// 将多个月合并为扁平 CalRow[]
// startMonth 为 0-based
export function buildRangeRows(
  startYear: number,
  startMonth: number,
  count: number,
): CalRow[]
```

`buildMonthRows` 内部复用现有 `buildCalendarGrid` 逻辑，将 `(number | null)[]` 转为 `WeekRow[]`（按 7 个一组分行），并在最前插入 `MonthHeaderRow`。

### 现有函数不变

`buildDayData`、`buildTaskDayData` 继续提供按 `dayStr`（YYYY-MM-DD）索引的数据 map。DayCell 渲染时直接按 `dayStr` 查表：

```ts
const dated   = () => show.dated   ? dayData().dated[dayStr()]   ?? [] : []
const created = () => show.created ? dayData().created[dayStr()] ?? [] : []
const updated = () => show.updated ? dayData().updated[dayStr()] ?? [] : []
const tasks   = () => taskDayData()[dayStr()] ?? []
const pending = () => show.pending ? tasks().filter(t => !t.checked) : []
const done    = () => show.done    ? tasks().filter(t =>  t.checked) : []
```

---

## §4 虚拟列表与滚动机制

### 依赖

```
@tanstack/solid-virtual
```

若项目未安装，需 `npm i @tanstack/solid-virtual`。

### 行高估算

| 行类型 | estimateSize |
|--------|-------------|
| `month-header` | 32px |
| `week` | 80px（动态测量后修正） |

使用 `virtualizer.measureElement(el)` 动态测量实际高度，虚拟列表自动修正偏移。

### Virtualizer 配置

```ts
const virtualizer = createVirtualizer({
  get count() { return rows().length },
  getScrollElement: () => scrollEl,
  estimateSize: (i) => rows()[i].type === 'month-header' ? 32 : 80,
  overscan: 5,
})
```

### 渲染模板

```tsx
<div ref={scrollEl} class="flex-1 overflow-y-auto min-h-0">
  <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
    <For each={virtualizer.getVirtualItems()}>
      {(vItem) => (
        <div
          style={{
            position: 'absolute',
            top: 0,
            transform: `translateY(${vItem.start}px)`,
            width: '100%',
          }}
          ref={(el) => virtualizer.measureElement(el)}
          data-index={vItem.index}
        >
          <RowRenderer row={rows()[vItem.index]} ... />
        </div>
      )}
    </For>
  </div>
</div>
```

### 无限滚动触发

在 scroll 事件或 `createEffect` 中检查虚拟列表可见范围：

```ts
createEffect(() => {
  const items = virtualizer.getVirtualItems()
  if (items.length === 0) return
  if (items[0].index < 5)                        prependMonths(3)
  if (items[items.length - 1].index > rows().length - 5) appendMonths(3)
})
```

### Prepend 补偿（防跳位）

向过去插入月份时，新行插在数组头部，会将所有现有行下推，导致视口跳动。补偿方式：

```ts
const prependMonths = (n: number) => {
  const newRows = buildRangeRows(headYear, headMonth - n, n)
  const estimatedAddedHeight = newRows.reduce((acc, r) =>
    acc + (r.type === 'month-header' ? 32 : 80), 0)
  setRows(prev => [...newRows, ...prev])
  // 同步补偿 scrollTop，防止视口跳动
  scrollEl.scrollTop += estimatedAddedHeight
}
```

由于使用估算高度而非测量高度，补偿后可能有 ±几像素误差，可接受。

### 定位到今天

```ts
onMount(() => {
  const now = new Date()
  const idx = rows().findIndex(
    r => r.type === 'month-header' &&
         r.year === now.getFullYear() &&
         r.month === now.getMonth()
  )
  if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'start' })
})
```

「今天」按钮同样调用此逻辑。

---

## 文件改动范围

| 文件 | 改动 |
|------|------|
| `calendarUtils.ts` | 新增 `CalRow` 类型、`buildMonthRows`、`buildRangeRows` |
| `CalendarViewer.tsx` | 完全重写：虚拟列表 + 无限滚动 + 过滤 + getConfig/setConfig props |
| `CalendarPlugin/index.tsx` | 组件包装传入 getConfig/setConfig，移除 ◀ ▶ 按钮相关 |

`CalendarPanel.tsx`（侧边栏小日历）**不涉及**，保持不变。

---

## 不在范围内

- CalendarPanel 侧边栏的改动
- 农历显示（现有 `showLunar` 设置不受影响，只是本次不实现）
- 滚动位置持久化（刷新后重新定位到今天）
