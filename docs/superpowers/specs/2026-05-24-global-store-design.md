# Global Store & Action Layer Design

**Date:** 2026-05-24  
**Status:** Approved  
**Scope:** 替换现有 4 个分散 store（fileSystemStore / knowledgeStore / uiStore / editorStore）为统一的命名空间分组 store，设计按领域分组的 action 层。

---

## 目标

- 清晰的单向数据流：组件只读 globalStore，只调 actions
- 纯数据 store 可直接 `JSON.stringify` 做快照/持久化
- 为后续插件扩展（新命名空间）和图谱视图（跨域数据）做准备

---

## §1 Store 结构

### 两个 Store，职责分离

| Store | 内容 | 可序列化 |
|---|---|---|
| `globalStore` | fs.tree、knowledge.*、workspace.* | ✅ |
| `runtimeStore` | rootHandle、leafInstances（cmView 等） | ❌ |

`rootHandle` 已通过 `idb-keyval` 持久化，不需进 globalStore。  
`EditorView`（CM6 实例）是 DOM 绑定对象，不可序列化，归入 runtimeStore。

---

### globalStore 完整类型

```ts
interface GlobalState {
  fs: {
    tree: FileNode[]
  }

  knowledge: {
    index:       Record<string, FileMetadata>   // path → { frontmatter, outLinks, tags, aliases }
    backlinkMap: Record<string, string[]>        // targetPath → [sourcePaths]
    tagMap:      Record<string, string[]>        // tag → [paths]
    isIndexing:  boolean
  }

  workspace: {
    main:  WorkspaceNode   // 主区域递归树（split / tabs / leaf）
    left:  SidebarSplit    // 左侧边栏
    right: SidebarSplit    // 右侧面板
    activeLeafId: string | null
    theme:          ThemeId
    customCSS:      string
    showSettings:   boolean
    autoTimestamps: boolean
    showOtherFiles: boolean
  }
}
```

### runtimeStore 完整类型

```ts
interface RuntimeState {
  rootHandle:    FileSystemDirectoryHandle | null
  leafInstances: Record<string, LeafRuntimeState>
}

interface LeafRuntimeState {
  cmView:   EditorView | null
  isDirty:  boolean
  outLinks: OutLink[]
  headings: Heading[]
}
```

---

### WorkspaceNode 类型系统

```ts
// 主区域：三种节点递归组合
type WorkspaceNode = WorkspaceSplit | WorkspaceTabs | WorkspaceLeaf

interface WorkspaceSplit {
  type: 'split'
  id: string
  direction: 'horizontal' | 'vertical'
  children: WorkspaceNode[]
}

interface WorkspaceTabs {
  type: 'tabs'
  id: string
  activeLeafId: string | null
  children: WorkspaceLeaf[]
}

interface WorkspaceLeaf {
  type: 'leaf'
  id: string
  viewState: { type: string; state: Record<string, unknown> }
  pinned: boolean
}

// 侧边栏：固定为 split，带宽度与折叠状态
interface SidebarSplit {
  type: 'split'
  direction: 'horizontal'
  width: number
  collapsed: boolean
  children: WorkspaceNode[]
}
```

**viewState 示例：**
```json
{ "type": "markdown", "state": { "file": "notes/日记.md", "mode": "source" } }
{ "type": "calendar",  "state": {} }
{ "type": "image",     "state": { "file": "assets/diagram.png" } }
```

---

## §2 Action 层

### 文件结构

```
src/
  stores/
    types.ts            ← 所有类型定义
    globalStore.ts      ← createStore<GlobalState>
    runtimeStore.ts     ← createStore<RuntimeState>
  actions/
    fsActions.ts        ← 替代 fileSystemService.ts
    knowledgeActions.ts ← 替代 knowledgeService.ts（store 写入部分）
    workspaceActions.ts ← 替代 workspaceService.ts
    appActions.ts       ← theme / settings
  lib/
    knowledgeUtils.ts   ← 纯函数（extractLinks, buildBacklinkMap 等）
    viewRegistry.ts     ← 保持不变
    ...
```

### 使用约定

- **组件**：只读 `globalStore` / `runtimeStore`，只调 actions
- **actions**：内部才调 `setGlobalStore` / `setRuntimeStore`
- **lib/**：纯函数，无副作用，不接触任何 store

---

### fsActions

```ts
export const fsActions = {
  openDirectory():                              Promise<void>,
  restoreDirectory():                           Promise<void>,
  createFile(name: string):                     Promise<string | null>,  // returns path
  createDirectory(name: string):                Promise<void>,
  renameFile(oldPath: string, newPath: string): Promise<void>,
  deleteFile(path: string):                     Promise<void>,
  writeFile(path: string, content: string):     Promise<void>,
  readFile(path: string):                       Promise<string>,
}
```

### knowledgeActions

```ts
export const knowledgeActions = {
  scanDirectory():                                    Promise<void>,
  reindexFile(path: string, content: string):         Promise<void>,
  removeFileMeta(path: string):                       void,
}
```

### workspaceActions

workspace 只管布局树结构，**不负责"打开哪个文件"**——该决策由上层组件传入 `viewState`。

```ts
export const workspaceActions = {
  // Leaf 生命周期
  createLeaf(tabsId: string, viewState: ViewState): string,   // returns leafId
  closeLeaf(leafId: string):                        void,
  activateLeaf(leafId: string):                     void,
  setLeafViewState(leafId: string, vs: ViewState):  void,
  setLeafPinned(leafId: string, pinned: boolean):   void,

  // 布局
  splitLeaf(leafId: string, direction: 'horizontal' | 'vertical'): string,
  openPage(type: string):                           void,

  // 侧边栏
  toggleLeft():                                     void,
  toggleRight():                                    void,
  resizeSidebar(side: 'left' | 'right', width: number): void,
}
```

**组件"打开文件"模式：**
```ts
// 复用当前 leaf（preview 替换）
workspaceActions.setLeafViewState(currentLeafId, {
  type: 'markdown',
  state: { file: path, mode: 'source' },
})

// 新建 leaf
const leafId = workspaceActions.createLeaf(activeTabsId, {
  type: 'markdown',
  state: { file: path, mode: 'source' },
})
workspaceActions.activateLeaf(leafId)
```

### appActions

```ts
export const appActions = {
  setTheme(theme: ThemeId):           void,
  setCustomCSS(css: string):          void,
  toggleSettings():                   void,
  setAutoTimestamps(value: boolean):  void,
  setShowOtherFiles(value: boolean):  void,
}
```

---

## §3 UI 渲染模型

整个布局是对 `globalStore.workspace` 的递归渲染。

### 组件树

```
App
├── SidebarRenderer(workspace.left)    // collapsed + width → CSS
├── WorkspaceNodeRenderer(workspace.main)
│     ├── type='split' → WorkspaceSplitView（flexbox 分栏）
│     ├── type='tabs'  → WorkspaceTabsView（tab 栏 + leaf 区域）
│     └── type='leaf'  → WorkspaceLeafView（查 viewRegistry 渲染）
└── SidebarRenderer(workspace.right)
```

### DOM 缓存：所有 leaf 常驻，只切 display

OB 策略：切换 tab 不销毁 CM6 实例，光标/滚动/Undo 历史完整保留。

```tsx
// WorkspaceTabsView.tsx
<For each={props.node.children}>
  {(leaf) => (
    <div style={{
      display: leaf.id === props.node.activeLeafId ? 'block' : 'none'
    }}>
      <WorkspaceLeafView leaf={leaf} />
    </div>
  )}
</For>
```

### 侧边栏由 collapsed + width 驱动

```tsx
// SidebarRenderer.tsx
<div style={{
  width:      sidebar.collapsed ? '0px' : `${sidebar.width}px`,
  overflow:   'hidden',
  transition: 'width 200ms',
}}>
  <WorkspaceNodeRenderer node={sidebar} />
</div>
```

### 视图注册（保持现有 viewRegistry 机制）

```ts
// WorkspaceLeafView.tsx
const def = getView(leaf.viewState.type)
return <def.component viewState={leaf.viewState.state} leafId={leaf.id} />
```

---

## 迁移映射

| 现有文件 | 迁移目标 |
|---|---|
| `stores/fileSystemStore.ts` | `stores/globalStore.ts` → `fs` 命名空间 |
| `stores/knowledgeStore.ts` | `stores/globalStore.ts` → `knowledge` 命名空间 |
| `stores/uiStore.ts` | `stores/globalStore.ts` → `workspace` 命名空间（flat tabs → WorkspaceSplit 树） |
| `stores/editorStore.ts` | `stores/runtimeStore.ts` → `leafInstances` |
| `services/fileSystemService.ts` | `actions/fsActions.ts` |
| `services/knowledgeService.ts`（store 写入） | `actions/knowledgeActions.ts` |
| `services/knowledgeService.ts`（纯函数） | `lib/knowledgeUtils.ts` |
| `services/workspaceService.ts` | `actions/workspaceActions.ts` |
| — | `actions/appActions.ts`（新增） |
