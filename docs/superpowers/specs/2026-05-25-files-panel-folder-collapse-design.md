# FilesPanel 文件夹折叠功能设计

**日期:** 2026-05-25  
**状态:** 待实现

## 目标

为 FilesPanel 添加文件夹折叠/展开功能，折叠状态通过 leaf 的 viewState 存储，后续 workspace 整体持久化时自动生效。同时移除文件前的图标，并在文件夹前显示折叠/展开指示符。

## 范围

- `src/components/panels/FilesPanel.tsx`
- `src/actions/workspaceActions.ts`（仅确认 `setLeafViewState` 可直接使用，无需改动）
- `src/stores/types.ts`（无需改动，`ViewState.state` 已是 `Record<string, unknown>`）

## 架构

### ViewState 结构

files panel leaf 的 viewState.state 扩展为：

```ts
{
  collapsedFolders: string[]  // 折叠文件夹的路径数组，默认 []
}
```

初始值（`globalStore.ts` 中 `leaf-files` 的 `state: {}`）不需要改动，FilesPanel 读取时做空值兜底。

### 组件签名

`FilesPanel` 改为接受 `ViewComponentProps`：

```ts
export function FilesPanel(props: ViewComponentProps) { ... }
```

`WorkspaceLeafView` 已经传递 `leafId`、`isActive`、`viewState` 给所有注册组件，无需改动调用侧。

### `FileTreeNode` props 扩展

```ts
{
  entry: FileMapEntry
  depth: number
  collapsedFolders: string[]
  onToggle: (path: string) => void
}
```

## 组件行为

### 文件条目

- **移除图标**：不显示 `◻`、`⊡`、`◫` 等图标
- 文件名直接显示，样式不变

### 文件夹条目

- 前缀指示符：`▾`（展开）或 `▸`（折叠）
- 点击文件夹行：调用 `onToggle(entry.path)`，不打开文件
- 子节点：折叠时不渲染（`<Show when={!isCollapsed()}>` 包裹 `<For>`）

### `isCollapsed` 计算

```ts
const isCollapsed = () =>
  props.entry.kind === 'directory' &&
  props.collapsedFolders.includes(props.entry.path)
```

### `handleToggle` 逻辑（在 FilesPanel 中）

```ts
function handleToggle(path: string) {
  const current = (props.viewState.collapsedFolders as string[] | undefined) ?? []
  const next = current.includes(path)
    ? current.filter(p => p !== path)
    : [...current, path]
  workspaceActions.setLeafViewState(props.leafId, {
    type: 'files',
    state: { ...props.viewState, collapsedFolders: next },
  })
}
```

## 数据流

```
用户点击文件夹
  → FileTreeNode.onClick → props.onToggle(path)
  → FilesPanel.handleToggle(path)
  → 计算新 collapsedFolders 数组
  → workspaceActions.setLeafViewState(leafId, { type:'files', state:{ collapsedFolders } })
  → globalStore 更新 → SolidJS 响应式重渲染
  → FileTreeNode isCollapsed() 重新求值
  → 子节点 Show/hide
```

## 不变的部分

- 双击文件打开新 tab（pinned）逻辑不变
- `showOtherFiles` 过滤逻辑不变
- 创建文件/文件夹的 UI 和逻辑不变
- `childrenOf()`、`displayName()` 等辅助函数不变

## 边界情况

- 文件夹被删除后，其路径留在 `collapsedFolders` 中无害（不会匹配到任何条目，渲染时自然消失）
- 深度嵌套：子文件夹的折叠状态独立，父文件夹折叠时子文件夹状态保留（下次展开父文件夹时恢复）

## 持久化

当前：viewState 存在内存中，页面刷新后重置为 `{}`（即全部展开）。  
后续：workspace 整体持久化实现后，`collapsedFolders` 自动随 leaf viewState 一起保存，无需额外改动。
