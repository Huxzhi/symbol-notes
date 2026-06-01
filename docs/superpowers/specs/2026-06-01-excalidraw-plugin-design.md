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

Obsidian Excalidraw 有两种存储模式，通过 frontmatter 的 `excalidraw-plugin` 字段区分：

| 模式 | frontmatter 值 | 代码块标记 | 内容 |
|------|---------------|-----------|------|
| 明文 | `parsed` | ` ```json ` | 原始 JSON 字符串 |
| 压缩 | `compressed` | ` ```compressed-json ` | LZ-String base64 压缩字符串 |

**读时自动识别模式，写时保留原文件的模式。** 新建文件默认用 `parsed`（可读性好，方便 git diff）。

### 依赖

压缩模式需要 `lz-string` 包（~5KB，无依赖）：

```json
"lz-string": "^1.5.0"
```

### 解析（`.excalidraw.md` → `ExcalidrawData`）

```
1. 从 frontmatter 读取 mode = 'parsed' | 'compressed'
2. 正则提取 %%...%% 块内容：
   parsed:     /%%[\s\S]*?```json\s*\n([\s\S]*?)\n```[\s\S]*?%%/
   compressed: /%%[\s\S]*?```compressed-json\s*\n([\s\S]*?)\n```[\s\S]*?%%/
3. parsed:     直接 JSON.parse(match)
   compressed: JSON.parse(LZString.decompressFromBase64(match))
4. 返回 { data: ExcalidrawData, mode }
```

若匹配失败或解析出错，抛出错误并显示提示，不挂载 Excalidraw 组件。

### 序列化（`ExcalidrawData` → `.excalidraw.md`）

接收 `(data, mode)` 两个参数，重建完整 Obsidian 格式：

```markdown
---
excalidraw-plugin: <parsed|compressed>
tags: [excalidraw]
---
==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this panel. ⚠==

# Text Elements
<id>:: <text>   ← 从 elements 中 type === "text" 条目自动生成

%%
# Drawing
```<json|compressed-json>
<原始 JSON 字符串 | LZString.compressToBase64(JSON.stringify(data))>
```
%%
```

**Text Elements 生成规则**：遍历 `elements`，过滤 `type === 'text'` 且 `text` 非空的条目，输出 `${element.id}:: ${element.text}`，每条一行。两种模式均需生成，供 Obsidian 全文搜索使用。

### 空白文件模板（新建时写入，默认 parsed 模式）

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
"@excalidraw/excalidraw": "latest",
"lz-string": "^1.5.0"
```

`react`、`react-dom`、`@excalidraw/excalidraw` 通过动态 `import()` 加载，仅在首次打开 `.excalidraw.md` 文件时触发，不影响初始 bundle。`lz-string` 体积极小（~5KB），可静态 import。

`@types/react`、`@types/react-dom`、`@types/lz-string` 加入 `devDependencies`。

---

## 7. 不在此次范围内

- 嵌入 `![[drawing.excalidraw.md]]` 预览（后续可用 `exportToSvg` 实现）
- Excalidraw 文件的 backlink / outLinks 索引
- 协作/多人编辑
