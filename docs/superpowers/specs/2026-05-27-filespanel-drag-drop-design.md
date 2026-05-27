# FilesPanel 拖放功能设计

**日期：** 2026-05-27  
**状态：** 已批准

## 概述

为 FilesPanel 的文件树添加拖放功能，支持两个场景：
1. 在文件树内拖动文件/文件夹到其他目录（含根目录）
2. 从文件树拖入 CM6 编辑器，自动插入 `[[文件名]]` wiki 链接

使用原生 HTML5 Drag and Drop API，无额外依赖。

## 场景一：文件树内移动

### 可拖动元素
- 文件（`.md`、图片、其他文件）
- 文件夹

### 可放置目标
- 任意文件夹节点
- 根目录（滚动容器作为 drop 区域）

### 守卫条件（拒绝 drop）
- 拖到自身
- 把文件夹拖到它的子孙目录下（会形成循环）
- 拖到当前所在的父目录（原地不动，无操作）

## 场景二：拖入 CM6 编辑器

`dragstart` 时写入 `text/plain`，CM6 内置 drop 处理直接在光标处插入：

| 文件类型 | 插入内容 |
|----------|----------|
| `.md` 文件 | `[[文件名]]`（去掉 `.md` 后缀） |
| 图片文件 | `![[文件名.png]]` |
| 文件夹 | `[[文件夹名]]` |
| 其他文件 | `[[文件名]]` |

不需要 CM6 扩展，浏览器 drop 到编辑器时自动使用 `text/plain` 内容。

## 数据流

### dragstart 写入的数据

```ts
dataTransfer.setData('application/x-symbol-notes-file', path)  // 供文件树识别
dataTransfer.setData('text/plain', wikiLinkText)                // 供 CM6 插入
dataTransfer.effectAllowed = 'move'
```

### 拖放状态（FilesPanel 本地 signal）

```ts
const [dragSrc, setDragSrc] = createSignal<string | null>(null)
const [dragOver, setDragOver] = createSignal<string | null>(null)
// dragOver === '__root__' 表示悬停在根 drop 区
```

### 事件绑定

| 事件 | 绑定位置 | 行为 |
|------|----------|------|
| `dragstart` | 每个 FileTreeNode | 设置 dataTransfer，设 dragSrc |
| `dragend` | 每个 FileTreeNode | 清空 dragSrc、dragOver |
| `dragover` | 目录类型的 FileTreeNode | preventDefault，设 dragOver；无效目标设 `dropEffect='none'` 不 preventDefault |
| `dragover` | 滚动容器（根 drop 区） | 同上，dragOver = `'__root__'` |
| `dragleave` | 目录节点 + 滚动容器 | 用 `relatedTarget` 判断是否真正离开，清除 dragOver |
| `drop` | 目录节点 + 滚动容器 | 调用 `fileActions.moveEntry`，清空状态 |

## fileActions 新增接口

### 对外统一入口

```ts
fileActions.moveEntry(srcPath: string, destDirPath: string | null): Promise<void>
```

根据 `cacheStore.files[srcPath].kind` 分发到 `moveFile` 或 `moveFolder`。

### moveFile 步骤

1. 计算 `newPath = destDirPath ? `${destDirPath}/${name}` : name`
2. Guard：`newPath === srcPath` → 返回
3. `readFile(srcPath)` 读内容
4. `writeFile(newPath, content, true)` 写到新路径
5. `dirHandle.removeEntry(fileName)` 删旧文件
6. `invalidateFile(srcPath)`、`deleteFileStatEntry(srcPath)`
7. 更新 `cacheStore`：删旧条目，写新条目（复用 `renameFile` 里的 entry 构建逻辑）
8. `workspaceActions.renameLeafPath(srcPath, newPath)` 更新已打开 tab
9. `cacheActions.reindexFile(newPath, content)`
10. `updateBacklinks(backlinks, srcPath, newPath)`（复用现有函数）

> 注：`FileSystemHandle.move()` 仅在 OPFS 内可用，且不支持目录。本项目使用 `showDirectoryPicker()` 访问用户磁盘，因此采用 read-copy-delete 方案。

### moveFolder 步骤

1. 计算 `newFolderPath`
2. Guard：`newFolderPath === srcPath` 或 `newFolderPath.startsWith(srcPath + '/')` → 返回
3. Guard：`parent(srcPath) === destDirPath` → 返回（原地）
4. 从 `cacheStore.files` 收集文件夹下所有条目（包含子孙）
5. 对每个**文件**条目：`readFile` → `writeFile(新路径)` → 不单独删除
6. `parentHandle.removeEntry(folderName, { recursive: true })` 一次性删除旧目录
7. 批量更新 `cacheStore`：所有条目的 `path`/`parent` 做前缀替换（`srcPath → newFolderPath`）
8. 对每个文件条目：`invalidateFile(旧路径)`、`deleteFileStatEntry(旧路径)`、`cacheActions.reindexFile(新路径, content)`、`updateBacklinks`、`workspaceActions.renameLeafPath`

## 视觉反馈

| 状态 | 样式 |
|------|------|
| 被拖动节点 | `opacity-50` |
| 悬停中的文件夹目标 | `bg-(--bg-hover)` + `border-l-2 border-(--accent-2)` |
| 悬停在根 drop 区 | 滚动容器加 `outline outline-1 outline-(--accent-2) outline-offset-[-2px]` |
| 无效目标 | `dropEffect = 'none'`，浏览器显示禁止光标 🚫 |

**不做：**
- 不替换浏览器默认拖动预览（ghost image）
- 不做悬停在折叠文件夹时自动展开
- 不做排序动画（树是字母序固定排列）

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/stores/runtimeStore.ts` | 新增 `moveFile`、`moveFolder`、`moveEntry` |
| `src/components/panels/FilesPanel.tsx` | 拖放事件、本地拖放 signal、根 drop 区 |

`stores/types.ts` **不需要改动**，拖放状态全在 FilesPanel 本地 signal 管理。
