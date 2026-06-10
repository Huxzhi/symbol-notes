# 日历显示 BuJo 条目（第二期 b-①）— 设计

日期：2026-06-10
状态：已确认，待写实现计划

## 背景与目标

第二期(a) 已让编辑器按 signifier 给列表行上色。现在把 BuJo 条目搬上**日历大图**（取代原先设想的 dashboard 方案）。

本期两件事：
1. **删掉 dashboard 插件**（整个退役，其周/月计划角色后续由增强日历承担）。
2. **日历月视图**新增 **事件 / 心情 / 想法** 三类条目：加三个过滤 chip，日期格里在任务之外也显示这些条目（用第二期 a 的配色）。

明确边界（来自澄清）：
- 条目落位规则与任务一致：`fields['due'] ?? 文件 dated`（事件/心情/想法一般无 due，落在文件日期）。
- 只这 3 类（事件 `-`、心情 `=`、想法 `~`）进日历；`重要 !` / `留意 &` **不进**（属行内强调，非"某天发生的条目"）。
- 显示：前导符号 + `visual` 文本，整条淡背景按类型（事件淡蓝 / 心情淡绿 / 想法淡紫），与任务 ☐/☑ 并列。
- 周视图（8 列 + 总结反思 + viewState 模式）是**下期 2b-②**，本期不做。

## 方案

复用日历现有数据流：`vaultStore.files[*].lists` 已含所有列表项（带 signifier、fields、文件 dated）。
新增纯函数 `buildEntryDayData(files)` 聚合事件/心情/想法到"日期 → 条目"映射（与 `buildTaskDayData` 同构）。
`CalendarViewer` 增 3 个过滤项与 3 种 cell 渲染分支。dashboard 插件删除。

## 组件与改动

### 1. 删除 dashboard 插件

- 删目录 `src/plugins/dashboard/`（`index.tsx`、`DashboardViewer.tsx`、`dashboardUtils.ts`、`__tests__/dashboardUtils.test.ts`）。
- `src/App.tsx`：删 `import { DashboardPlugin } from './plugins/dashboard'`（第 22 行）与 `registerPlugin(DashboardPlugin)`（第 65 行）。
- 全库仅此两处引用（已确认）。删后 `tsc`/`build`/测试须仍绿。

### 2. `src/plugins/calendar/calendarUtils.ts` — 新增 `buildEntryDayData`

```ts
const ENTRY_SIGNIFIERS = new Set(['-', '=', '~'])

/** 事件/心情/想法条目按日期聚合：fields['due'] 优先，否则文件 dated。 */
export function buildEntryDayData(
  files: Record<string, FileMeta>,
): Record<string, Task[]> {
  const map: Record<string, Task[]> = {}
  for (const [path, meta] of Object.entries(files)) {
    if (meta.kind !== 'file') continue
    const fallback = meta.dated ?? null
    for (const it of meta.lists) {
      if (!it.signifier || !ENTRY_SIGNIFIERS.has(it.signifier)) continue
      const date = it.fields['due'] ?? fallback
      if (!date) continue
      ;(map[date] ??= []).push({ ...it, path })
    }
  }
  return map
}
```

（`Task = ListItem & { path: string }` 已存在，结构通用，事件/心情/想法条目沿用该类型。）

### 3. `src/plugins/calendar/CalendarViewer.tsx`

**过滤项**：`FILTER_DEFAULTS` 增三键（默认开）：

```ts
const FILTER_DEFAULTS = {
  dated: true, created: true, updated: true, pending: true, done: true,
  event: true, mood: true, idea: true,
}
```

**条目颜色**（与第二期 a 的事件/心情/想法一致，本处为日历 DOM 用的 hue 值）：

```ts
const ENTRY_STYLE: Record<string, { hue: string; sig: string }> = {
  event: { hue: '#4aa3ff', sig: '-' },
  mood:  { hue: '#56c596', sig: '=' },
  idea:  { hue: '#9d8dff', sig: '~' },
}
```

**CellItem 联合**新增三种：

```ts
type CellItem =
  | { kind: 'dated' | 'created' | 'updated'; path: string }
  | { kind: 'pending' | 'done'; task: Task }
  | { kind: 'event' | 'mood' | 'idea'; entry: Task }
```

**数据源**：主组件加 `const entryDayData = createDeferred(() => buildEntryDayData(vaultStore.files))`，
经 props 传入 `WeekRowComp`（与 `taskDayData` 并列）。

**cellData()** 在现有 all 数组后追加（gated by filter，并按 signifier 分流到三类）：

```ts
const ed = props.entryDayData()
const entries = ed[dayStr] ?? []
...
  ...(f.event ? entries.filter(e => e.signifier === '-').map((entry): CellItem => ({ kind: 'event', entry })) : []),
  ...(f.mood  ? entries.filter(e => e.signifier === '=').map((entry): CellItem => ({ kind: 'mood',  entry })) : []),
  ...(f.idea  ? entries.filter(e => e.signifier === '~').map((entry): CellItem => ({ kind: 'idea',  entry })) : []),
```

**渲染分支**：在现有 pending/done 之后，加三个分支，结构同 pending（点击打开文件，淡背景 + 主色文字），显示 `前导符号 + visual`，例如：

```tsx
if (item.kind === 'event' || item.kind === 'mood' || item.kind === 'idea') {
  const st = ENTRY_STYLE[item.kind]
  return (
    <button
      class="shrink-0 text-left text-[10px] leading-snug px-1.5 py-0.5 rounded w-full cursor-pointer transition-colors truncate hover:opacity-80"
      style={{ color: st.hue, 'background-color': `color-mix(in srgb, ${st.hue} 16%, transparent)` }}
      onClick={() => props.onOpenFile(item.entry.path)}
      title={item.entry.path}
    >
      {st.sig} {item.entry.visual}
    </button>
  )
}
```

**工具栏**：在"已完成"chip 后加三个 `FilterChip`（label 事件/心情/想法），`colorClass` 用对应淡色。
因现有 `FilterChip` 的 `colorClass` 走 Tailwind class（如 `bg-(--tag)`），而这三色无 CSS 变量，
给 `FilterChip` 增加可选 `dotStyle?: JSX.CSSProperties` 走 inline `background-color`；三个新 chip 传
`dotStyle={{ 'background-color': hue }}`。（保持旧 chip 不变。）

`MAX_CELL_ITEMS` 保持 5，新条目一并计入溢出。

## 数据流

1. 文件索引 → `vaultStore.files[*].lists` 含事件/心情/想法（signifier）。
2. `buildEntryDayData(files)` → 日期→条目；`createDeferred` 包裹避免频繁刷新掉帧。
3. 日期格按过滤项渲染任务 + 三类条目；点击打开来源文件。

## 边界与错误处理

- 仅 `-`/`=`/`~` 三 signifier 进日历；其余（含 `!`/`&`/普通列表/任务以外）不计。
- 无文件日期且无 `due` 的条目 → 不落任何格（跳过）。
- 目录项（`kind !== 'file'`）跳过。
- 删 dashboard 后无残留引用；持久化的旧 workspace 若含 dashboard leaf 属运行期数据，超出本期范围。

## 测试

- `src/plugins/calendar/__tests__/calendarUtils.test.ts` 扩展 `buildEntryDayData`：
  - 事件/心情/想法分别按文件 dated 落位；带 `[due::]` 时用 due。
  - 跳过任务（signifier null）、普通列表（null）、`!`/`&`。
  - 跳过目录、无日期项。
  - `{ ...it, path }` 带上 path。
- dashboard 测试随目录删除一并移除。
- 日历 cell 的可视化（颜色、过滤开关联动）留手动/浏览器验证。

## 不做（后续）

- 周视图：8 列布局、本周总结与反思、viewState 存 mode+anchor（2b-②）。
- `重要 !` / `留意 &` 进日历。
- 条目在日历内编辑/勾选（只读 + 点击跳转）。
