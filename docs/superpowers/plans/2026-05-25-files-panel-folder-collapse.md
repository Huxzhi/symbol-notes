# FilesPanel 文件夹折叠 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** FilesPanel 支持文件夹折叠/展开，状态通过 leaf viewState 存储；移除文件图标，文件夹前显示 ▸/▾ 指示符。

**Architecture:** `FilesPanel` 接受 `ViewComponentProps`（`leafId + viewState`，`WorkspaceLeafView` 已传递），将 `collapsedFolders: string[]` 读写进 `viewState.collapsedFolders`，通过已有的 `workspaceActions.setLeafViewState` 更新。`FileTreeNode` 新增 `collapsedFolders` 和 `onToggle` props 来驱动渲染。

**Tech Stack:** SolidJS, TypeScript, Vitest

---

## 文件变更清单

| 文件 | 操作 |
|------|------|
| `src/components/panels/FilesPanel.tsx` | Modify — 所有核心改动 |
| `src/__tests__/filesPanelHelpers.test.ts` | Create — 测试 toggle 纯函数 |

`workspaceActions.ts` 和 `types.ts` 无需改动。

---

### Task 1: 提取并测试 toggleInArray 辅助函数

**Files:**
- Create: `src/__tests__/filesPanelHelpers.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/__tests__/filesPanelHelpers.test.ts`：

```ts
import { describe, it, expect } from 'vitest'

// 从 FilesPanel 导出的纯函数（Task 2 实现后才存在）
import { toggleInArray } from '../components/panels/FilesPanel'

describe('toggleInArray', () => {
  it('adds path when not present', () => {
    expect(toggleInArray(['a', 'b'], 'c')).toEqual(['a', 'b', 'c'])
  })
  it('removes path when already present', () => {
    expect(toggleInArray(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
  })
  it('handles empty array', () => {
    expect(toggleInArray([], 'x')).toEqual(['x'])
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run src/__tests__/filesPanelHelpers.test.ts
```

预期：FAIL，错误为 `Cannot find module '../components/panels/FilesPanel'` 或 named export 不存在。

---

### Task 2: 在 FilesPanel 实现并导出 toggleInArray

**Files:**
- Modify: `src/components/panels/FilesPanel.tsx`

- [ ] **Step 1: 在文件顶部（imports 之后，组件之前）添加纯函数**

在 `FilesPanel.tsx` 的 `const IMAGE_EXTS = ...` 行之前插入：

```ts
export function toggleInArray(arr: string[], val: string): string[] {
  return arr.includes(val) ? arr.filter(p => p !== val) : [...arr, val]
}
```

- [ ] **Step 2: 运行测试，确认通过**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run src/__tests__/filesPanelHelpers.test.ts
```

预期：3 tests PASS。

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/filesPanelHelpers.test.ts src/components/panels/FilesPanel.tsx
git commit -m "test: add toggleInArray helper and tests for FilesPanel collapse logic"
```

---

### Task 3: 更新 FileTreeNode — 移除文件图标，添加折叠 props

**Files:**
- Modify: `src/components/panels/FilesPanel.tsx:55-110`

- [ ] **Step 1: 删除 fileIcon 函数**

删除整个 `fileIcon` 函数（第 26-30 行）：

```ts
// 删除这段：
function fileIcon(name: string): string {
  if (name.endsWith(MD_EXT)) return '◻'
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return IMAGE_EXTS.has(ext) ? '⊡' : '◫'
}
```

- [ ] **Step 2: 更新 FileTreeNode 的 props 类型，加入 collapsedFolders 和 onToggle**

将：
```ts
function FileTreeNode(props: { entry: FileMapEntry; depth: number }) {
```

改为：
```ts
function FileTreeNode(props: {
  entry: FileMapEntry
  depth: number
  collapsedFolders: string[]
  onToggle: (path: string) => void
}) {
```

- [ ] **Step 3: 在 FileTreeNode 内添加 isCollapsed 派生信号**

在 `const show = ...` 行之后添加：

```ts
const isCollapsed = () =>
  props.entry.kind === 'directory' && props.collapsedFolders.includes(props.entry.path)
```

- [ ] **Step 4: 更新 onClick — 文件夹点击调用 onToggle**

将：
```ts
onClick={() => {
  if (props.entry.kind !== 'file') return
  if (!canOpen(props.entry.name)) return
  workspaceActions.openFile(props.entry.path)
}}
```

改为：
```ts
onClick={() => {
  if (props.entry.kind === 'directory') {
    props.onToggle(props.entry.path)
    return
  }
  if (!canOpen(props.entry.name)) return
  workspaceActions.openFile(props.entry.path)
}}
```

- [ ] **Step 5: 更新指示符 span — 文件夹显示 ▸/▾，文件无图标**

将：
```tsx
<span class="text-[9px] text-(--text-3)">
  {props.entry.kind === 'directory'
    ? '▸'
    : fileIcon(props.entry.name)}
</span>
```

改为：
```tsx
<Show when={props.entry.kind === 'directory'}>
  <span class="text-[9px] text-(--text-3)">
    {isCollapsed() ? '▸' : '▾'}
  </span>
</Show>
```

- [ ] **Step 6: 将子节点渲染包裹进折叠判断，并传递新 props**

将：
```tsx
<Show when={props.entry.kind === 'directory'}>
  <For each={childrenOf(props.entry.path)}>
    {(child) => (
      <FileTreeNode
        entry={child}
        depth={props.depth + 1}
      />
    )}
  </For>
</Show>
```

改为：
```tsx
<Show when={props.entry.kind === 'directory' && !isCollapsed()}>
  <For each={childrenOf(props.entry.path)}>
    {(child) => (
      <FileTreeNode
        entry={child}
        depth={props.depth + 1}
        collapsedFolders={props.collapsedFolders}
        onToggle={props.onToggle}
      />
    )}
  </For>
</Show>
```

- [ ] **Step 7: 确认 TypeScript 编译无错误**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1 | head -30
```

预期：有关 `FilesPanel` 签名的错误（因为 FilesPanel 还没改），其余无误。

---

### Task 4: 更新 FilesPanel 接受 ViewComponentProps，实现 handleToggle

**Files:**
- Modify: `src/components/panels/FilesPanel.tsx:114-212`

- [ ] **Step 1: 更新 imports — 加入 ViewComponentProps，移除不再使用的 createSignal（先检查其他用途）**

`createSignal` 仍被 `createMode` / `newName` 使用，保留。将 import 中的类型改为：

```ts
import type { FileMapEntry, ViewComponentProps } from '../../stores/types'
```

（删除 `FileMapEntry` 之外原有的类型如果有的话；`ViewComponentProps` 已在 types.ts 中定义。）

- [ ] **Step 2: 更新 FilesPanel 签名**

将：
```ts
export function FilesPanel() {
```

改为：
```ts
export function FilesPanel(props: ViewComponentProps) {
```

- [ ] **Step 3: 在 createSignal 声明之后添加 collapsedFolders 派生和 handleToggle**

在：
```ts
const [newName, setNewName] = createSignal('')
```

之后添加：
```ts
const collapsedFolders = () =>
  (props.viewState.collapsedFolders as string[] | undefined) ?? []

const handleToggle = (path: string) => {
  workspaceActions.setLeafViewState(props.leafId, {
    type: 'files',
    state: { ...props.viewState, collapsedFolders: toggleInArray(collapsedFolders(), path) },
  })
}
```

- [ ] **Step 4: 更新 FilesPanel JSX 中的 FileTreeNode 调用，传入新 props**

将：
```tsx
<For each={childrenOf(null)}>
  {(entry) => (
    <FileTreeNode
      entry={entry}
      depth={0}
    />
  )}
</For>
```

改为：
```tsx
<For each={childrenOf(null)}>
  {(entry) => (
    <FileTreeNode
      entry={entry}
      depth={0}
      collapsedFolders={collapsedFolders()}
      onToggle={handleToggle}
    />
  )}
</For>
```

- [ ] **Step 5: 确认 TypeScript 编译无错误**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1 | head -30
```

预期：无错误输出。

- [ ] **Step 6: 运行全部测试**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run
```

预期：所有测试 PASS。

- [ ] **Step 7: Commit**

```bash
git add src/components/panels/FilesPanel.tsx
git commit -m "feat: FilesPanel folder collapse via viewState, remove file icons, show ▸/▾ indicator"
```

---

## 验证清单（手动）

完成后在浏览器中验证：

- [ ] 文件夹条目前显示 `▾`（展开状态）
- [ ] 点击文件夹后变为 `▸`，子文件隐藏
- [ ] 再次点击恢复 `▾`，子文件显示
- [ ] 嵌套文件夹各自独立折叠
- [ ] 文件条目前无图标
- [ ] 点击文件仍正常打开
- [ ] 双击文件仍在新 tab 打开（pinned）
- [ ] 新建文件/文件夹功能不受影响
