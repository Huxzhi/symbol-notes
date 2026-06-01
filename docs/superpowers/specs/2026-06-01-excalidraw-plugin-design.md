# Excalidraw 插件设计

**日期**: 2026-06-01  
**状态**: 已批准

## 概述

以插件形式集成 Excalidraw 绘图编辑器，支持打开、编辑、新建 Obsidian 兼容的 `.excalidraw.md` 文件。使用 `@excalidraw/excalidraw` React 组件动态挂载到 SolidJS 视图中。

---

## 1. 文件路由修复

### 问题

`workspaceStore.openFile` 用 `path.slice(path.lastIndexOf('.'))` 提取扩展名，对 `drawing.excalidraw.md` 只能得到 `.md`，导致被 EditorPlugin 拦截而非 Excalidraw 插件。

### 方案

将 `FileViewDef.canAcceptFile(ext: string)` 改为 `canAcceptFile(path: string)`，传完整路径，各插件自行判断。

**受影响文件：**

| 文件 | 改动 |
|------|------|
| `src/lib/pluginRegistry.ts` | `FileViewDef.canAcceptFile` 参数改为 `path: string`；`getFileViewForExt` 重命名为 `getFileViewForPath(path)` |
| `src/stores/workspaceStore.ts` | 两处调用：删除 `ext` 局部变量，直接传 `path` 给 `getFileViewForPath` |
| `src/plugins/files/FilesPanel.tsx` | 同上，传完整 `path` |
| `src/plugins/editor/index.tsx` | `canAcceptFile: (p) => p.endsWith('.md') && !p.endsWith('.excalidraw.md')` |

---

## 2. 文件格式

### 解析（`.excalidraw.md` → `ExcalidrawData`）

从文件内容中用正则提取 `%%...%%` 块内的 JSON：

```
/%%\s*\n```json\s*\n([\s\S]*?)\n```\s*\n%%/
```

若匹配失败（格式损坏），抛出错误并显示提示。

### 序列化（`ExcalidrawData` → `.excalidraw.md`）

重建完整 Obsidian 格式：

```markdown
---
excalidraw-plugin: parsed
tags: [excalidraw]
---
==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this panel. ⚠==

# Text Elements
<id>:: <text>   ← 从 elements 中 type === "text" 条目自动生成

%%
# Drawing
```json
{...JSON...}
```
%%
```

**Text Elements 生成规则**：遍历 `elements`，过滤 `type === 'text'` 且 `text` 非空的条目，输出 `${element.id}:: ${element.text}`，每条一行。这是 Obsidian 全文搜索所依赖的区域。

### 空白文件模板（新建时写入）

```markdown
---
excalidraw-plugin: parsed
tags: [excalidraw]
---
==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this panel. ⚠==

# Text Elements

%%
# Drawing
```json
{"type":"excalidraw","version":2,"source":"symbol-notes","elements":[],"appState":{"gridSize":null,"viewBackgroundColor":"#ffffff"},"files":{}}
```
%%
```

---

## 3. 插件文件结构

```
src/plugins/excalidraw/
  index.tsx              ← 插件注册：视图、ribbon、右键菜单
  ExcalidrawViewer.tsx   ← SolidJS 组件，挂载 React Excalidraw
  excalidrawFormat.ts    ← parseExcalidrawMd / serializeExcalidrawMd
```

---

## 4. ExcalidrawViewer 组件

### 生命周期

```
onMount
  → readFile(path)
  → parseExcalidrawMd(content)
  → dynamic import('@excalidraw/excalidraw')
  → ReactDOM.createRoot(container)
  → root.render(<Excalidraw initialData={data} onChange={handleChange} />)

onChange (debounce 1000ms)
  → serialize → writeFile
  → 设置 dirty = true，tab 标题显示未保存标记

Ctrl+S（键盘事件）
  → 立即 serialize → writeFile
  → dirty = false

isActive 变 false（切换 tab）
  → 若 dirty，立即保存

onCleanup
  → reactRoot.unmount()
```

### Props

使用现有的 `ViewComponentProps`（`leafId`、`viewState.file`、`isActive`）。

### 错误处理

- 文件读取失败：显示错误提示 div，不挂载 React
- JSON 解析失败：同上，提示"文件格式损坏"
- React/Excalidraw 动态 import 失败：提示"绘图组件加载失败"

---

## 5. 新建文件

### Ribbon 图标

- 位置：左侧 Ribbon，图标使用 `lucide-solid` 的 `PenLine`
- 行为：在 vault 根目录创建 `Untitled.excalidraw.md`；若已存在则尝试 `Untitled 1.excalidraw.md`、`Untitled 2.excalidraw.md`……直到找到可用名称
- 创建后立即 `openFile` 打开

### Files 面板右键菜单

- 触发位置：右键点击文件夹条目
- 菜单项：`新建 Excalidraw 绘图`
- 行为：在该文件夹下创建 `Untitled.excalidraw.md`（同上递增逻辑），创建后打开

---

## 6. 依赖

```json
"react": "^18",
"react-dom": "^18",
"@excalidraw/excalidraw": "latest"
```

三个包均通过动态 `import()` 加载，仅在首次打开 `.excalidraw.md` 文件时触发，不影响初始 bundle。

`@types/react` 和 `@types/react-dom` 加入 `devDependencies`。

---

## 7. 不在此次范围内

- 嵌入 `![[drawing.excalidraw.md]]` 预览（后续可用 `exportToSvg` 实现）
- Excalidraw 文件的 backlink / outLinks 索引
- 协作/多人编辑
