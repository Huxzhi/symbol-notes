# 日历周视图 + 本周总结反思（第二期 b-②）— 设计

日期：2026-06-10
状态：已确认，待写实现计划

## 背景与目标

日历目前只有竖向无限滚动的月视图（含任务 + 事件/心情/想法条目，b-① 已做）。本期加**周视图**：
一页 8 列（7 日列 + 第 8 列"本周总结与反思"内联编辑器），并把**视图模式与所在周存进 `viewState`**（持久化、重开恢复）。

确认要点（来自澄清）：
- 第 8 列 = **内联编辑周记文件**（方案 A），文件 `weekly/YYYY-Www.md`（`weeklyFolder` 可配，默认 `weekly`），不存在则首次写入时创建。
- 日列复用现有条目渲染（文件/任务/事件/心情/想法），过滤 chips 同样生效；日列内容多时**该列可滚动**，不做月视图的 `+N more` 截断。
- `[月][周]` 模式切换；周导航 ‹上一周 / W## / 下一周› + 今天；`mode` 与 `weekAnchor` 存 `viewState`，默认 `month` / 今天。
- 月视图保持现状（无限滚动，anchor 仅周视图用）。

## 架构与组件

借本期把 `CalendarViewer`（已 ~430 行）里的"单条目渲染"抽出共享，避免月/周重复。

### 1. `src/plugins/calendar/calendarUtils.ts` — 补 ISO 周辅助（纯函数）

重新加回（随 dashboard 删除的）：
- `getISOWeek(date): { year, week }`
- `getISOWeekString(date): string` —— `2026-W24`
- `getISOWeekDates(date): string[]` —— 该 ISO 周周一至周日 7 个 `YYYY-MM-DD`
- `weekFilePath(folder, date): string` —— `folder ? \`${folder}/${getISOWeekString(date)}.md\` : \`${getISOWeekString(date)}.md\``

### 2. `src/plugins/calendar/CalendarCell.tsx`（新）— 共享单元

从 `CalendarViewer` 抽出，供月视图与周视图共用：
- `FILTER_DEFAULTS`（含 b-① 的 event/mood/idea）、`type FilterKey`、`type FilterState = typeof FILTER_DEFAULTS`（迁出 CalendarViewer）。
- `type CellItem`（dated/created/updated/pending/done/event/mood/idea，同现状）。
- `ENTRY_STYLE`（事件/心情/想法 hue+sig，迁出 CalendarViewer）。
- `buildCellItems(dayStr, f: FilterState, data): CellItem[]` —— 纯函数，**不做截断**，返回该天全部命中项。
  `data = { dayData: ReturnType<typeof buildDayData>; taskDayData: Record<string, Task[]>; entryDayData: Record<string, Task[]> }`。
  逻辑即现有 `cellData()` 里 `all` 数组的构建（去掉 slice）。
- `CellItemButton(props: { item: CellItem; onOpenFile: (p: string) => void })` —— 渲染单条（现有 For 循环里那一坨分支按 kind 渲染，原样迁入）。

### 3. `src/plugins/calendar/WeeklyNoteEditor.tsx`（新）— 第 8 列编辑器

移植已删 dashboard `PlanEditor` 思路：
- props：`{ path: string; label: string }`。
- `createResource`（依赖 `vaultStore.files[path] ? path : null`）`readFile(path)`；挂一个 CM `EditorView`
  （`markdown` + `syntaxHighlighting(darkHighlightStyle)` + `darkTheme` + `livePreviewExtension` + `hideFrontmatterExtension` + `lineWrapping`），
  `updateListener` 防抖 500ms 调 `fileActions.saveFile(path, full)`；Ctrl/Cmd-S 立即保存。
- 文件不存在：显示占位 + "新建"按钮（`fileActions.createFile(path)`）。`onCleanup` 销毁 view。

### 4. `src/plugins/calendar/WeekView.tsx`（新）— 8 列周视图

- props：`{ weekAnchor: string; filter: () => FilterState; weeklyFolder: string; onOpenFile; onPrevWeek; onNextWeek; onToday; todayStr }`。
- 顶部周导航条：`‹` / `本周 {getISOWeekString(anchorDate)}` / `›` / `今天`。
- 主体 `grid`，8 列：7 日列等宽 + 第 8 列稍宽（如 `grid-template-columns: repeat(7, 1fr) 1.6fr`）。
- 数据：`dayData=buildDayData(files)`、`taskDayData=buildTaskDayData(taskMap, files)`、`entryDayData=buildEntryDayData(files)`（`createDeferred`）。
- 7 日列：`getISOWeekDates(anchorDate)` 得 7 天；每天 `buildCellItems(day, filter(), data)`，竖排 `<CellItemButton>`，列内 `overflow-y-auto`，今日高亮。
- 第 8 列：`<WeeklyNoteEditor path={weekFilePath(weeklyFolder, anchorDate)} label="本周总结与反思" />`。

### 5. `src/plugins/calendar/CalendarViewer.tsx` — 改为壳

- **viewState 状态**：本地 signal `mode`/`weekAnchor` 初始化自 `props.viewState`（`(props.viewState.mode as 'week'|'month') ?? 'month'`、`(props.viewState.weekAnchor as string) ?? todayStr`）。
  改动经 `applyViewState(next)`：`setMode/setWeekAnchor` + `workspaceActions.setLeafViewState(props.leafId, { type: 'calendar', state: { mode: ..., weekAnchor: ... } })`。
- **工具栏**：保留过滤 chips（移用 `CalendarCell` 的 `FILTER_DEFAULTS`）；加 `[月][周]` 切换（segmented 按钮，改 mode）。
- **主体**：`<Show when={mode()==='week'} fallback={<现有月历滚动>}>`，渲染 `<WeekView weekAnchor={weekAnchor()} ... onPrevWeek/onNextWeek/onToday 改 weekAnchor />`。
- 月视图分支保持现状，但 `WeekRowComp` 改用 `buildCellItems` + `CellItemButton`（截断 `MAX_CELL_ITEMS` 留在 WeekRowComp 内：取 `buildCellItems(...)` 后 slice）。

### 6. `src/plugins/calendar/index.tsx` — 设置

`CalendarSettings` 加 `weeklyFolder` 文本输入（默认 `weekly`）；`CalendarViewer` 通过 `props.getConfig({ weeklyFolder: 'weekly', ... })` 读取，传给 `WeekView`。

## viewState 与数据流

1. 壳读 `viewState.mode`/`weekAnchor` → 本地 signal。
2. mode='week' → `WeekView`；`getISOWeekDates(anchor)` 得 7 天 → 每天 `buildCellItems` 取条目渲染；第 8 列按 `weekFilePath` 读/写周记。
3. 切模式/导航 → `applyViewState` 改 signal 并写回 `viewState`（持久化）。

## 边界与错误处理

- 周记文件不存在：第 8 列显示"新建"，点击创建；写入前不创建空文件。
- `weekAnchor` 非法/缺失 → 回退今天。
- 月视图行为、b-① 的条目与过滤不变（仅渲染路径改为共享组件，输出等价）。
- `getISOWeekDates` 以 ISO 周（周一起）为准，与现有 `WEEKDAYS_LONG`（周一…周日）一致。

## 测试

- `calendarUtils.test.ts` 扩展：`getISOWeek`（含跨年周 53 / 周 1 边界）、`getISOWeekString`、`getISOWeekDates`（返回 7 天、周一起、格式）、`weekFilePath`（含空 folder）。
- `CalendarCell` 的 `buildCellItems`：构造 dayData/taskDayData/entryDayData，断言按过滤项产出对应 CellItem、顺序、过滤关掉则不含。
- WeekView / WeeklyNoteEditor / viewState 持久化 / 模式切换：涉及 vault 与 DOM，留手动浏览器验证。

## 不做（后续 / YAGNI）

- 周视图里直接勾选任务 / 编辑条目（仍只读 + 点击跳转）。
- 周记的自动聚合统计（第 8 列是手写编辑器）。
- 月视图也支持 anchor 定位（保持无限滚动）。
- 农历 / 多周并列。
