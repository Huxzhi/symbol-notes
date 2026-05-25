# 每日笔记（Daily Note）功能设计

**日期：** 2026-05-25
**状态：** 已批准，待实现

---

## 概述

在 Ribbon 新增「每日笔记」按钮，点击后自动跳转到今日日期对应的 Markdown 文件。
若文件不存在则按配置模板创建，支持指定目标工作区自动切换。
所有配置在现有 Settings 面板新增的「每日笔记」分组中管理。

---

## 第一节：数据模型

### 新增配置结构

在 `src/stores/types.ts` 的 `WorkspaceState` 中增加：

```ts
interface DailyNoteConfig {
  dirTemplate: string      // 目录模板，如 "日记/{YYYY}/{MM}"
  fileTemplate: string     // 文件名模板（不含 .md），如 "{YYYY-MM-DD}"
  templateContent: string  // 新建文件时写入的初始内容
  targetLayoutId: string   // 目标工作区 ID；"" 表示不切换
}

// WorkspaceState 新增字段：
// dailyNote: DailyNoteConfig
```

### Token 规则

路径模板支持以下占位符，展开时用当天日期替换：

| Token      | 说明       | 示例    |
|------------|------------|---------|
| `{YYYY}`   | 四位年份   | `2026`  |
| `{MM}`     | 两位月份   | `05`    |
| `{DD}`     | 两位日期   | `25`    |
| `{YYYY-MM-DD}` | 连字符日期 | `2026-05-25` |

最终文件路径：`{dirTemplate}/{fileTemplate}.md`

示例：`dirTemplate="日记/{YYYY}/{MM}"`, `fileTemplate="{YYYY-MM-DD}"` → `日记/2026/05/2026-05-25.md`

### 持久化

与现有 `theme`、`autoTimestamps` 同样方式，使用 `localStorage`，key 前缀 `sn-dailyNote-*`：

```
sn-dailyNote-dirTemplate
sn-dailyNote-fileTemplate
sn-dailyNote-templateContent
sn-dailyNote-targetLayoutId
```

默认值：

```ts
{
  dirTemplate: '日记/{YYYY}/{MM}',
  fileTemplate: '{YYYY-MM-DD}',
  templateContent: '',
  targetLayoutId: '',
}
```

---

## 第二节：核心 Action

### 新文件：`src/actions/dailyNoteActions.ts`

```
openToday():
  1. 读取 globalStore.workspace.dailyNote
  2. 展开模板路径（用今日日期替换 token）
       dirPath  = expandTemplate(dirTemplate)
       filePath = expandTemplate(dirTemplate + '/' + fileTemplate) + '.md'
  3. 若 targetLayoutId 非空 → workspaceActions.switchLayout(targetLayoutId)
  4. 检查 globalStore.fs.tree 中是否存在 filePath（内存遍历，无额外 IO）
       - 存在 → openFileInWorkspace(filePath)
       - 不存在 → fsActions.createFile(filePath)
                  若 templateContent 非空 → fsActions.writeFile(filePath, templateContent)
                  → openFileInWorkspace(filePath)
```

`expandTemplate(tpl: string, date: Date): string` — 纯函数，替换 token，放在 `src/lib/dailyNoteUtils.ts`。

### 工具提取：`src/lib/workspaceUtils.ts`

`FilesPanel` 与 `CalendarPanel` 均有重复的 `openFileInWorkspace` / `findLeafWithFile` 实现。
将其提取到 `workspaceUtils.ts`，两处改为 import，消除重复。

`openFileInWorkspace(path: string, options?: { newTab?: boolean; pin?: boolean }): void`

---

## 第三节：Settings UI

### 修改文件：`src/components/Settings.tsx`

左侧导航新增分组（插入在「文件」之后）：

```
外观 | 文件 | 每日笔记 | 快捷键
```

「每日笔记」分组内容：

```
目录模板
  [input: "日记/{YYYY}/{MM}"]
  说明：{YYYY} {MM} {DD} 将替换为今日日期

文件名模板
  [input: "{YYYY-MM-DD}"]
  预览：→ 日记/2026/05/2026-05-25.md   （实时展开，用今日日期）

目标工作区
  [select: 不切换（当前工作区）| 工作区1 | 工作区2 ...]
  选项来自 globalStore.workspace.layouts，第一项值为 ""

初始模板
  [textarea, 多行]
  说明：新建今日笔记时写入此内容
```

预览行随输入实时更新，调用 `expandTemplate` 展开当前草稿值。

配置随其他设置在点「应用」时统一写入 globalStore 并持久化 localStorage。

---

## 第四节：Ribbon 按钮

### 修改文件：`src/components/Ribbon.tsx`

新增图标 `NotebookPen`（来自 `lucide-solid`），插入位置：

```
PanelLeft     切换左栏
Search        文件列表
CalendarDays  日历面板
CalendarRange 日历大图
NotebookPen   ← 新增：每日笔记
Network       知识图谱
─────
Settings      设置
```

激活态判断（高亮）：当 main 区当前活跃 leaf 的 `viewState.state.file` 等于今日展开路径时高亮，与 `calendarPageActive()` 同样模式：

```ts
const todayNoteActive = () => {
  const { activeLeafId } = activeLayout()
  if (!activeLeafId) return false
  const leaf = findLeafInTree(activeRoot().main, activeLeafId)
  const cfg = globalStore.workspace.dailyNote
  const todayPath = expandTemplate(cfg.dirTemplate + '/' + cfg.fileTemplate, new Date()) + '.md'
  return leaf?.viewState.state.file === todayPath
}
```

点击直接调用 `dailyNoteActions.openToday()`，无弹窗。

---

## 文件变更清单

| 操作   | 文件路径                                      | 说明                                  |
|--------|-----------------------------------------------|---------------------------------------|
| 新建   | `src/lib/dailyNoteUtils.ts`                   | `expandTemplate` 纯函数               |
| 新建   | `src/lib/workspaceUtils.ts`                   | 提取 `openFileInWorkspace` / `findLeafWithFile` |
| 新建   | `src/actions/dailyNoteActions.ts`             | `openToday()` action                  |
| 修改   | `src/stores/types.ts`                         | 新增 `DailyNoteConfig`，扩展 `WorkspaceState` |
| 修改   | `src/stores/globalStore.ts`                   | 新增 `dailyNote` 初始值与 localStorage 读取 |
| 修改   | `src/components/Settings.tsx`                 | 新增「每日笔记」分组                  |
| 修改   | `src/components/Ribbon.tsx`                   | 新增 `NotebookPen` 按钮               |
| 修改   | `src/components/panels/FilesPanel.tsx`        | 改用 `workspaceUtils` 的共享函数      |
| 修改   | `src/components/panels/CalendarPanel.tsx`     | 改用 `workspaceUtils` 的共享函数      |

---

## 范围边界

- **不做**：每日笔记历史列表、日历视图联动高亮今日格
- **不做**：模板支持动态变量（如 `{{title}}`、`{{date}}`），仅支持路径 token
- **不做**：文件夹不存在时的错误提示 UI（`createFile` 已自动创建中间目录）
