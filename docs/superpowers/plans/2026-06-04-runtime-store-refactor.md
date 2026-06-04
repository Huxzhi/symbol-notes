# runtimeStore 领域拆分重构计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `RuntimeState` 中的四个字段按语义分配到正确的领域，消灭 `runtimeStore` 作为"杂物箱"的角色。

**Architecture:** 三个领域（vault / workspace / settings）各自管理自己的状态。`fileOp` 归属 files 插件私有，`showSettings` 归属 App 组件，`isIndexing` 归属 vaultIndexer，`leafInstances` 归属 workspace，`fs` 归属 vault。全部完成后 `RuntimeState` 类型和 `runtimeStore` store 对象可删除，文件只剩 `fileActions` 和 `appActions`。

**Tech Stack:** SolidJS (createSignal, createStore), TypeScript

---

## 当前 RuntimeState 字段归属分析

| 字段 | 当前位置 | 目标位置 |
|------|---------|---------|
| `showSettings` | runtimeStore | App.tsx 本地 signal |
| `isIndexing` | runtimeStore | vaultIndexer 模块级 signal |
| `fileOp` | runtimeStore | plugins/files/fileOpStore.ts (插件私有) |
| `leafInstances` | runtimeStore | workspaceStore 模块级 store |
| `fs` | runtimeStore | vaultStore 模块级 signal |

## 文件变更清单

| 操作 | 文件 | 变更 |
|------|-----|------|
| 新建 | `src/plugins/files/fileOpStore.ts` | fileOp signal + beginCreate/beginRename/cancelOp |
| 修改 | `src/stores/types.ts` | 逐步删除 RuntimeState 字段；最终删除 RuntimeState |
| 修改 | `src/stores/runtimeStore.ts` | 逐步删除各字段和对应 actions |
| 修改 | `src/stores/workspaceStore.ts` | 添加 leafInstances store；删除 setRuntimeStore 导入 |
| 修改 | `src/stores/vaultStore.ts` | 添加 vaultFs signal |
| 修改 | `src/services/vaultIndexer.ts` | 导出 isIndexing signal；删除 setRuntimeStore 导入 |
| 修改 | `src/App.tsx` | 本地 showSettings signal；传 onClose prop |
| 修改 | `src/components/Settings.tsx` | 接收 onClose prop 替代 setRuntimeStore |
| 修改 | `src/plugins/files/FilesPanel.tsx` | 使用 fileOpStore |
| 修改 | `src/plugins/files/index.tsx` | 使用 fileOpStore；删除 fileActions 导入 |
| 修改 | `src/plugins/editor/EditorViewer.tsx` | setLeafInstances from workspaceStore; vaultFs() |
| 修改 | `src/plugins/outline/index.tsx` | leafInstances from workspaceStore |
| 修改 | `src/components/StatusBar.tsx` | leafInstances from workspaceStore; isIndexing from vaultIndexer |
| 修改 | `src/components/workspace/WorkspaceTabsView.tsx` | leafInstances from workspaceStore |
| 修改 | `src/lib/pluginRegistry.ts` | leafInstances from workspaceStore; vaultFs() |
| 修改 | `src/lib/cm6/embedExtension.ts` | vaultFs() |
| 修改 | `src/plugins/editor/ImageViewer.tsx` | vaultFs() |
| 修改 | `src/plugins/excalidraw/ExcalidrawViewer.tsx` | vaultFs() |

---

## Task 1: showSettings → App.tsx 本地 signal

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Settings.tsx`
- Modify: `src/stores/runtimeStore.ts`
- Modify: `src/stores/types.ts`

- [ ] **Step 1: 修改 Settings.tsx 接受 onClose prop**

```tsx
// src/components/Settings.tsx — 第 4、46 行附近
// 删除：
import { setRuntimeStore } from '../stores/runtimeStore'
// 修改函数签名：
export function Settings(props: { onClose(): void }) {
  // 删除：const close = () => setRuntimeStore('showSettings', false)
  const close = props.onClose
  // 其余不变
```

- [ ] **Step 2: 修改 App.tsx，添加本地 signal，更新 AppPlugin 和 Show**

```tsx
// src/App.tsx — 在文件顶部 import 区之后添加（模块级）
import { createSignal } from 'solid-js'

const [showSettings, setShowSettings] = createSignal(false)

// AppPlugin setup 中：
ctx.ribbon({
  id: 'settings',
  title: '设置',
  getIcon: () => <SettingsIcon size={18} />,
  onClick: () => setShowSettings(v => !v),
  position: 'bottom',
})

// App() 组件中，删除 runtimeStore 导入（或保留仅 appActions），Show 改为：
<Show when={showSettings()}>
  <Settings onClose={() => setShowSettings(false)} />
</Show>
```

- [ ] **Step 3: 从 runtimeStore.ts 删除 showSettings 相关代码**

```ts
// src/stores/runtimeStore.ts — 初始状态删除：
//   showSettings: false,
// appActions 删除 toggleSettings 和 isSettingsOpen 方法
```

- [ ] **Step 4: 从 types.ts 删除 showSettings 字段**

```ts
// src/stores/types.ts — RuntimeState 删除：
//   showSettings: boolean
```

- [ ] **Step 5: 运行类型检查和测试**

```bash
cd /home/huxzhi/4-code/symbol-notes
npx tsc --noEmit
npx vitest run
```

Expected: 0 errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/Settings.tsx src/stores/runtimeStore.ts src/stores/types.ts
git commit -m "refactor: showSettings → App.tsx local signal"
```

---

## Task 2: isIndexing → vaultIndexer 模块级 signal

**Files:**
- Modify: `src/services/vaultIndexer.ts`
- Modify: `src/components/StatusBar.tsx`
- Modify: `src/stores/runtimeStore.ts`
- Modify: `src/stores/types.ts`

- [ ] **Step 1: 在 vaultIndexer.ts 顶部添加导出 signal，替换 setRuntimeStore 调用**

```ts
// src/services/vaultIndexer.ts
// 删除：import { setRuntimeStore } from '../stores/runtimeStore'
// 添加（顶部）：
import { createSignal } from 'solid-js'
export const [isIndexing, setIsIndexing] = createSignal(false)

// 将文件中所有：
//   setRuntimeStore('isIndexing', true)  → setIsIndexing(true)
//   setRuntimeStore('isIndexing', false) → setIsIndexing(false)
```

- [ ] **Step 2: StatusBar.tsx 改用 vaultIndexer 的 isIndexing**

```tsx
// src/components/StatusBar.tsx
// 替换：import { runtimeStore } from '../stores/runtimeStore'
// 添加：import { isIndexing } from '../services/vaultIndexer'
// 将：runtimeStore.isIndexing → isIndexing()
// （runtimeStore.leafInstances 保留到 Task 4 再改）
```

- [ ] **Step 3: 从 runtimeStore.ts 和 types.ts 删除 isIndexing**

```ts
// runtimeStore.ts 初始状态删除：isIndexing: false,
// types.ts RuntimeState 删除：isIndexing: boolean
```

- [ ] **Step 4: 类型检查 + 测试 + Commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/services/vaultIndexer.ts src/components/StatusBar.tsx src/stores/runtimeStore.ts src/stores/types.ts
git commit -m "refactor: isIndexing → vaultIndexer module signal"
```

---

## Task 3: fileOp → 插件私有 fileOpStore

**Files:**
- Create: `src/plugins/files/fileOpStore.ts`
- Modify: `src/plugins/files/FilesPanel.tsx`
- Modify: `src/plugins/files/index.tsx`
- Modify: `src/stores/runtimeStore.ts`
- Modify: `src/stores/types.ts`

- [ ] **Step 1: 新建 fileOpStore.ts**

```ts
// src/plugins/files/fileOpStore.ts
import { createSignal } from 'solid-js'

export type FileOp =
  | { type: 'create-file' | 'create-folder'; prefix: string }
  | { type: 'rename'; path: string }
  | null

export const [fileOp, setFileOp] = createSignal<FileOp>(null)

export function beginCreate(mode: 'file' | 'folder', prefix = ''): void {
  setFileOp({ type: mode === 'file' ? 'create-file' : 'create-folder', prefix })
}

export function beginRename(path: string): void {
  setFileOp({ type: 'rename', path })
}

export function cancelOp(): void {
  setFileOp(null)
}
```

- [ ] **Step 2: 修改 FilesPanel.tsx，使用 fileOpStore**

```tsx
// src/plugins/files/FilesPanel.tsx
// 删除 fileActions 中 beginCreate/beginRename/cancelOp/commitCreate/commitRename 的引用
// 添加：
import { fileOp, beginCreate, beginRename, cancelOp } from './fileOpStore'

// FilesPanel 和 FileRow 内部：
// runtimeStore.fileOp     → fileOp()
// fileActions.cancelOp()  → cancelOp()
// fileActions.beginCreate(...) → beginCreate(...)

// confirmCreate() 内联实现（原 commitCreate 逻辑）：
const confirmCreate = async () => {
  const val = createValue().trim()
  if (!val) { cancelOp(); return }
  const op = fileOp()
  if (!op || (op.type !== 'create-file' && op.type !== 'create-folder')) return
  setFileOp(null)
  if (op.type === 'create-file') {
    const path = await fileActions.createFile(
      (op as { prefix: string }).prefix + val
    )
    if (path) workspaceActions.openFile(path, { newTab: true, pin: true })
  } else {
    await fileActions.createFolder((op as { prefix: string }).prefix + val)
  }
}

// confirmRename() 内联实现（原 commitRename 逻辑）：
const confirmRename = async () => {
  const val = renameValue().trim()
  if (!val) { cancelOp(); return }
  cancelOp()
  try { await fileActions.renameFile(entry().path, val) }
  catch (err) { showError(err instanceof Error ? err.message : '重命名失败') }
}
```

- [ ] **Step 3: 修改 files/index.tsx，使用 fileOpStore**

```tsx
// src/plugins/files/index.tsx
// 删除：import { fileActions } from '../../stores/runtimeStore'
// 添加：
import { beginCreate, beginRename } from './fileOpStore'

// 上下文菜单中：
// fileActions.beginRename(path) → beginRename(path)
// fileActions.beginCreate('file', path + '/') → beginCreate('file', path + '/')
// fileActions.beginCreate('folder', path + '/') → beginCreate('folder', path + '/')
```

- [ ] **Step 4: 从 runtimeStore.ts 删除 fileOp 状态和相关 actions**

```ts
// runtimeStore.ts
// 初始状态删除：fileOp: null,
// fileActions 删除：beginCreate、beginRename、cancelOp、commitCreate、commitRename
```

- [ ] **Step 5: 从 types.ts 删除 FileOp 和 RuntimeState.fileOp**

```ts
// types.ts
// 删除 FileOp 类型（已移到 fileOpStore.ts）
// RuntimeState 删除：fileOp: FileOp
```

- [ ] **Step 6: 类型检查 + 测试 + Commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/plugins/files/fileOpStore.ts src/plugins/files/FilesPanel.tsx src/plugins/files/index.tsx src/stores/runtimeStore.ts src/stores/types.ts
git commit -m "refactor: fileOp → files plugin-private fileOpStore"
```

---

## Task 4: leafInstances → workspaceStore 模块级 store

**Files:**
- Modify: `src/stores/workspaceStore.ts`
- Modify: `src/stores/types.ts`
- Modify: `src/stores/runtimeStore.ts`
- Modify: `src/plugins/editor/EditorViewer.tsx`
- Modify: `src/plugins/outline/index.tsx`
- Modify: `src/components/StatusBar.tsx`
- Modify: `src/components/workspace/WorkspaceTabsView.tsx`
- Modify: `src/lib/pluginRegistry.ts`

- [ ] **Step 1: 在 workspaceStore.ts 添加 leafInstances store；删除 setRuntimeStore 导入**

```ts
// src/stores/workspaceStore.ts
// 删除：import { setRuntimeStore } from './runtimeStore'
// 顶部添加（在 createStore<WorkspaceState> 之后）：
import type { LeafRuntimeState } from './types'

const [leafInstances, setLeafInstances] = createStore<Record<string, LeafRuntimeState>>({})
export { leafInstances, setLeafInstances }

// 文件内部所有 setRuntimeStore('leafInstances', produce(...)) 替换为：
//   setLeafInstances(produce(...))
// clearAllLeaves() 中 setRuntimeStore('leafInstances', {}) 替换为：
//   setLeafInstances({})
```

- [ ] **Step 2: EditorViewer.tsx 改用 workspaceStore 的 setLeafInstances**

```tsx
// src/plugins/editor/EditorViewer.tsx
// 删除：import { runtimeStore, setRuntimeStore } from '../../stores/runtimeStore'
//   （保留 fileActions 从 runtimeStore 的导入）
// 添加：
import { setLeafInstances } from '../../stores/workspaceStore'

// setRuntimeStore('leafInstances', props.leafId, ...) → setLeafInstances(props.leafId, ...)
// runtimeStore.fs → vaultFs() (在 Task 5 完成，此处暂时保留或同步处理)
```

- [ ] **Step 3: pluginRegistry.ts 改用 workspaceStore.leafInstances**

```ts
// src/lib/pluginRegistry.ts
// 删除 runtimeStore 中 leafInstances 的读取，改为：
import { leafInstances } from '../stores/workspaceStore'

// activeOutLinks: () => { const id = ...; return id ? (leafInstances[id]?.outLinks ?? []) : [] }
// activeHeadings: () => { const id = ...; return id ? (leafInstances[id]?.headings ?? []) : [] }
// 同时删除 runtimeStore 从 pluginRegistry 的导入（如果只剩 leafInstances 用途）
```

- [ ] **Step 4: 其余读取文件改用 workspaceStore.leafInstances**

```tsx
// src/plugins/outline/index.tsx
// import { leafInstances } from '../../stores/workspaceStore'
// runtimeStore.leafInstances[activeLeafId] → leafInstances[activeLeafId]

// src/components/StatusBar.tsx
// import { leafInstances } from '../stores/workspaceStore'
// runtimeStore.leafInstances[activeLeafId] → leafInstances[activeLeafId]

// src/components/workspace/WorkspaceTabsView.tsx
// import { leafInstances } from '../stores/workspaceStore'
// runtimeStore.leafInstances[leaf.id] → leafInstances[leaf.id]
```

- [ ] **Step 5: 从 runtimeStore.ts 和 types.ts 删除 leafInstances**

```ts
// runtimeStore.ts 初始状态删除：leafInstances: {},
// types.ts RuntimeState 删除：leafInstances: Record<string, LeafRuntimeState>
```

- [ ] **Step 6: 类型检查 + 测试 + Commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/stores/workspaceStore.ts src/stores/types.ts src/stores/runtimeStore.ts \
  src/plugins/editor/EditorViewer.tsx src/plugins/outline/index.tsx \
  src/components/StatusBar.tsx src/components/workspace/WorkspaceTabsView.tsx \
  src/lib/pluginRegistry.ts
git commit -m "refactor: leafInstances → workspaceStore, remove setRuntimeStore from workspaceStore"
```

---

## Task 5: fs → vaultStore 模块级 signal

**Files:**
- Modify: `src/stores/vaultStore.ts`
- Modify: `src/stores/runtimeStore.ts`
- Modify: `src/stores/types.ts`
- Modify: `src/lib/pluginRegistry.ts`
- Modify: `src/lib/cm6/embedExtension.ts`
- Modify: `src/plugins/editor/EditorViewer.tsx`
- Modify: `src/plugins/editor/ImageViewer.tsx`
- Modify: `src/plugins/excalidraw/ExcalidrawViewer.tsx`
- Modify: `src/plugins/files/FilesPanel.tsx`

- [ ] **Step 1: vaultStore.ts 顶部添加 vaultFs signal**

```ts
// src/stores/vaultStore.ts
// 添加到文件顶部（import 区之后）：
import { createSignal } from 'solid-js'
import type { FileSystemAdapter } from '../services/fs/types'

const [_vaultFs, setVaultFs] = createSignal<FileSystemAdapter | null>(null)
export const vaultFs = _vaultFs
export { setVaultFs }
```

- [ ] **Step 2: runtimeStore.ts 的 openVault/restoreVault 改用 setVaultFs**

```ts
// src/stores/runtimeStore.ts
// 添加：import { setVaultFs } from './vaultStore'
// openVault 中：setRuntimeStore('fs', adapter) → setVaultFs(adapter)
// restoreVault 中：setRuntimeStore('fs', adapter) → setVaultFs(adapter)
// 初始状态删除：fs: null,
```

- [ ] **Step 3: 所有读取 runtimeStore.fs 的文件改用 vaultFs()**

```ts
// src/lib/pluginRegistry.ts
// import { vaultFs } from '../stores/vaultStore'
// ready: () => vaultFs() !== null

// src/lib/cm6/embedExtension.ts
// import { vaultFs } from '../../stores/vaultStore'
// runtimeStore.fs → vaultFs()
// （同时删除 runtimeStore 导入，如果只用了 fs）

// src/plugins/editor/EditorViewer.tsx
// import { vaultFs } from '../../stores/vaultStore'
// () => runtimeStore.fs → () => vaultFs()

// src/plugins/editor/ImageViewer.tsx
// import { vaultFs } from '../../stores/vaultStore'
// runtimeStore.fs → vaultFs()

// src/plugins/excalidraw/ExcalidrawViewer.tsx
// import { vaultFs } from '../../stores/vaultStore'
// runtimeStore.fs → vaultFs()

// src/plugins/files/FilesPanel.tsx
// import { vaultFs } from '../../stores/vaultStore'
// runtimeStore.fs → vaultFs()
// runtimeStore.fs?.name → vaultFs()?.name
```

- [ ] **Step 4: 从 types.ts 删除 RuntimeState.fs；如果 RuntimeState 为空则删除整个类型**

```ts
// types.ts
// RuntimeState 删除：fs: FileSystemAdapter | null
// 如果 RuntimeState 此时已无字段，删除整个 RuntimeState interface
// 同时删除 FileSystemAdapter import（如果不再使用）
```

- [ ] **Step 5: 清理 runtimeStore.ts**

此时 `runtimeStore` store 对象和 `setRuntimeStore` 函数不再被导出（没有状态）。
文件只剩 `fileActions` 和 `appActions`：

```ts
// src/stores/runtimeStore.ts
// 删除：
//   import { createStore, produce } from 'solid-js/store'
//   const [runtimeStore, setRuntimeStore] = createStore<RuntimeState>({})
//   export { runtimeStore, setRuntimeStore }
// 保留所有 fileActions 和 appActions 的实现
// appActions 中 openVault/restoreVault 已经使用 setVaultFs，不再需要 setRuntimeStore
```

- [ ] **Step 6: 类型检查 + 测试 + Commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/stores/vaultStore.ts src/stores/runtimeStore.ts src/stores/types.ts \
  src/lib/pluginRegistry.ts src/lib/cm6/embedExtension.ts \
  src/plugins/editor/EditorViewer.tsx src/plugins/editor/ImageViewer.tsx \
  src/plugins/excalidraw/ExcalidrawViewer.tsx src/plugins/files/FilesPanel.tsx
git commit -m "refactor: fs → vaultStore signal; runtimeStore now only exports fileActions/appActions"
```

---

## 最终架构验证

完成所有 Task 后：

```
src/stores/
  vaultStore.ts    — files, backlinks, stemIndex, vaultFs (FileSystemAdapter)
  workspaceStore.ts — layout, leafInstances (非序列化), 无 setRuntimeStore 依赖
  settingsStore.ts  — theme, pluginStates (不变)
  runtimeStore.ts   — 只剩 fileActions + appActions (可选改名)
  types.ts          — RuntimeState 类型删除

src/plugins/files/
  fileOpStore.ts    — 插件私有 fileOp signal

src/services/
  vaultIndexer.ts   — 导出 isIndexing signal

src/App.tsx         — 本地 showSettings signal
```

`runtimeStore` 存储对象（`createStore` 返回的那个）不再存在。文件可以后续改名为 `vaultOps.ts` 或类似名称，但不在本次重构范围内。
