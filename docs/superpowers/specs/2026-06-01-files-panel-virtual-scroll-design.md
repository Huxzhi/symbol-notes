# 文件面板虚拟滚动设计

**日期：** 2026-06-01  
**目标规模：** 5000+ 文件  
**技术选型：** `@tanstack/solid-virtual`

## 背景

`FilesPanel` 当前使用递归 `FileTreeNode` 组件渲染文件树，展开文件夹时所有可见节点都创建真实 DOM 节点。文件数量大时（千级以上）页面卡顿明显。

## 架构

```
vaultStore.files + collapsedFolders
        ↓  createMemo（flattenTree）
   FlatRow[]  —— 拍平的可见节点有序数组（含 depth）
        ↓  createVirtualizer（@tanstack/solid-virtual）
   只渲染视口内 ± overscan 的行，绝对定位
```

### 核心数据结构

```typescript
interface FlatRow {
  entry: FileMeta   // 含 path / name / kind / parent / size / mtime 等
  depth: number     // 缩进层级，用于 padding-left 计算
}
```

`entry.parent` 已包含父目录路径，拖拽时直接使用，无需额外字段。

### flattenTree 逻辑

```typescript
function flattenTree(
  parentPath: string | null,
  depth: number,
  collapsed: string[],
): FlatRow[] {
  const rows: FlatRow[] = []
  for (const entry of childrenOf(parentPath)) {
    if (entry.kind === 'file' && isOtherFile(entry.name) && !settingsStore.showOtherFiles) continue
    rows.push({ entry, depth })
    if (entry.kind === 'directory' && !collapsed.includes(entry.path)) {
      rows.push(...flattenTree(entry.path, depth + 1, collapsed))
    }
  }
  return rows
}
```

在 `createMemo` 内调用，SolidJS 自动追踪 `vaultStore.files` 和 `collapsedFolders` 的变化。

## 组件变更

### 删除

- `FileTreeNode`（递归组件）

### 新增

- `FileRow`：单行组件，接收 `row: FlatRow`、`style`（绝对定位 top/height）及所有 drag/rename 回调，不渲染子节点。

### FilesPanel 滚动区结构

```jsx
<div ref={scrollEl} class="overflow-y-auto flex-1">

  {/* 新建输入框：在虚拟列表外，固定显示在顶部 */}
  <Show when={isCreating()}>
    <CreateInput ... />
  </Show>

  {/* 撑起总滚动高度，margin-top: 4px 替代原 py-1 上边距 */}
  <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative', 'margin-top': '4px' }}>
    <For each={virtualizer.getVirtualItems()}>
      {(vItem) => (
        <FileRow
          row={flatRows()[vItem.index]}
          style={{
            position: 'absolute',
            top: `${vItem.start}px`,
            height: '22px',
          }}
          ...handlers
        />
      )}
    </For>
  </div>
</div>
```

## 行高

固定 **22px**，通过 `height: 22px; line-height: 22px` 强制在 CSS 中固定，避免测量误差。

`createVirtualizer` 配置：

```typescript
const virtualizer = createVirtualizer({
  get count() { return flatRows().length },
  getScrollElement: () => scrollEl ?? null,
  estimateSize: () => 22,
  overscan: 10,
})
```

`overscan: 10` 在视口上下各多渲染 10 行，快速滚动不白屏，且覆盖拖拽边缘情况。

## 拖拽

### 目标判断（扩展现有逻辑）

| 放置位置 | 目标目录 |
|----------|----------|
| 文件夹行 | 该文件夹路径（`entry.path`）|
| 文件行 | 该文件的父目录（`entry.parent`，`null` 表示根目录）|
| 空白区 | 根目录（`null`）|

`dragOver` signal 存储"有效目标目录路径"（文件夹用自身 path，文件用 `entry.parent`），高亮逻辑对相应目录行做 outline 样式。

### 视口外节点

视口外的文件夹不在 DOM 中，无法作为拖拽目标。用户需滚动到目标文件夹后放下，与 Obsidian 行为一致，可接受。

## Rename 处理

触发 rename 时先滚动到目标行，确保 input 在 DOM 中：

```typescript
const idx = flatRows().findIndex(r => r.entry.path === targetPath)
if (idx !== -1) virtualizer.scrollToIndex(idx, { align: 'auto' })
fileActions.beginRename(targetPath)
```

`align: 'auto'`：目标已在视口内则不滚动。

## 依赖

```
npm add @tanstack/solid-virtual
```

无其他新依赖。

## 不在本次范围内

- 动态行高（多行文件名等）
- 拖拽到视口外文件夹的自动滚动（autoscroll on drag）
- 搜索面板（`search/index.tsx`）的虚拟化
