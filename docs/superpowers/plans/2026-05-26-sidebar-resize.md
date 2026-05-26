# Sidebar Drag Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让左右侧边栏通过拖拽 handle 调整宽度，拖到 < 50px 时自动折叠，宽度实时写入 workspaceStore 持久化。

**Architecture:** 在 `workspaceStore` 新增 `setSidebarWidth` action；在 `SidebarRenderer` 加 `side` prop，渲染常显细线 resize handle，用 Pointer Capture API 实现 drag；App.tsx 传 `side` prop。折叠时 handle 随 sidebar 隐藏（width: 0），展开仍由 Ribbon 按钮控制。

**Tech Stack:** SolidJS, TypeScript, Tailwind CSS v4, Pointer Capture API

---

### Task 1: 在 workspaceStore 新增 `setSidebarWidth` action

**Files:**
- Modify: `src/stores/workspaceStore.ts`

- [ ] **Step 1: 在 `workspaceActions` 对象末尾添加 action**

在 `src/stores/workspaceStore.ts` 的 `workspaceActions` 对象中，找到 `toggleSidebar` action 之后，添加：

```ts
  setSidebarWidth(side: 'left' | 'right', width: number): void {
    setRoot(side, 'width', width)
  },
```

完整上下文（替换这段）：

```ts
  toggleSidebar(side: 'left' | 'right'): void {
    setRoot(side, 'collapsed', (v: boolean) => !v)
  },

  setSidebarWidth(side: 'left' | 'right', width: number): void {
    setRoot(side, 'width', width)
  },

  activateSidebarLeaf(side: 'left' | 'right', leafId: string): void {
```

- [ ] **Step 2: 验证 TypeScript 编译通过**

```bash
npx tsc --noEmit
```

Expected: 无错误输出

- [ ] **Step 3: Commit**

```bash
git add src/stores/workspaceStore.ts
git commit -m "feat: add setSidebarWidth action to workspaceStore"
```

---

### Task 2: 更新 SidebarRenderer — 加 side prop + resize handle + drag 逻辑

**Files:**
- Modify: `src/components/workspace/SidebarRenderer.tsx`

- [ ] **Step 1: 用新实现替换 SidebarRenderer.tsx 全部内容**

```tsx
import { createSignal, For } from 'solid-js'
import { workspaceActions } from '../../stores/workspaceStore'
import { WorkspaceNodeRenderer } from './WorkspaceNodeRenderer'

export function SidebarRenderer(props: { node: any; side: 'left' | 'right' }) {
  const sidebar = () => props.node
  const [isDragging, setIsDragging] = createSignal(false)

  let startX = 0
  let initWidth = 0

  function onPointerDown(e: PointerEvent) {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    startX = e.clientX
    initWidth = sidebar().width
    setIsDragging(true)
  }

  function onPointerMove(e: PointerEvent) {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return
    const delta = e.clientX - startX
    const newWidth = props.side === 'left' ? initWidth + delta : initWidth - delta
    if (newWidth < 50) {
      workspaceActions.toggleSidebar(props.side)
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      setIsDragging(false)
      return
    }
    workspaceActions.setSidebarWidth(props.side, Math.min(newWidth, 800))
  }

  function onPointerUp(e: PointerEvent) {
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    setIsDragging(false)
  }

  const handle = (
    <div
      class="w-1 shrink-0 cursor-col-resize bg-(--border) hover:bg-(--accent) transition-colors self-stretch"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )

  return (
    <div
      class={`overflow-hidden shrink-0 h-full bg-(--bg-surface) flex border-(--border)
        ${isDragging() ? '' : 'transition-[width] duration-200'}`}
      style={{ width: sidebar().collapsed ? '0px' : `${sidebar().width}px` }}
    >
      {props.side === 'right' && handle}
      <div class="flex-1 flex flex-col overflow-hidden min-h-0 min-w-0">
        <For each={sidebar().children}>
          {(node) => (
            <div class="flex-1 min-h-0 overflow-hidden">
              <WorkspaceNodeRenderer node={node} />
            </div>
          )}
        </For>
      </div>
      {props.side === 'left' && handle}
    </div>
  )
}
```

**关键点说明：**
- `isDragging` signal 用于拖拽期间禁用 `transition-[width]`（防止每次 mousemove 都触发动画，导致卡顿）；点击 toggle 折叠时仍有过渡动画
- `setPointerCapture` 确保鼠标移出 handle 后仍能接收事件，无需 document 监听
- `hasPointerCapture` 检查防止 `onPointerMove` 在非拖拽状态误触发
- left sidebar 的 handle 在右侧（`props.side === 'left' && handle` 放在内容之后）
- right sidebar 的 handle 在左侧（`props.side === 'right' && handle` 放在内容之前）
- `Math.min(newWidth, 800)` 防止拖拽过宽

- [ ] **Step 2: 验证 TypeScript 编译通过**

```bash
npx tsc --noEmit
```

Expected: 无错误输出

- [ ] **Step 3: Commit**

```bash
git add src/components/workspace/SidebarRenderer.tsx
git commit -m "feat: add drag resize handle to SidebarRenderer"
```

---

### Task 3: App.tsx 传 side prop

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 给两个 SidebarRenderer 加 side prop**

找到 `src/App.tsx` 中渲染 SidebarRenderer 的两行：

```tsx
<SidebarRenderer node={activeRoot().left} />
```
改为：
```tsx
<SidebarRenderer node={activeRoot().left} side="left" />
```

以及：
```tsx
<SidebarRenderer node={activeRoot().right} />
```
改为：
```tsx
<SidebarRenderer node={activeRoot().right} side="right" />
```

- [ ] **Step 2: 验证 TypeScript 编译通过**

```bash
npx tsc --noEmit
```

Expected: 无错误输出

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: pass side prop to SidebarRenderer"
```

---

### Task 4: 手动验证

**Files:** 无代码改动

- [ ] **Step 1: 启动开发服务器**

```bash
npm run dev
```

- [ ] **Step 2: 验证左侧边栏拖拽**

打开浏览器，在左侧边栏右边缘看到 1px 细线（颜色 `--border`）：
- 鼠标悬停 handle → 变成 `--accent` 颜色 + `col-resize` 光标
- 向右拖拽 → 侧边栏变宽，宽度写入 store（刷新页面后宽度保持）
- 向左拖拽到 < 50px → 侧边栏自动折叠（`collapsed = true`），handle 消失
- 拖拽期间不出现动画卡顿

- [ ] **Step 3: 验证右侧边栏拖拽**

在右侧边栏左边缘看到细线：
- 向左拖拽 → 变宽
- 向右拖拽到 < 50px → 自动折叠

- [ ] **Step 4: 验证 Ribbon 按钮展开/折叠不受影响**

点击 Ribbon 中的 `PanelLeft` 按钮 → 侧边栏展开/折叠动画正常（有 `transition-[width] duration-200`）

- [ ] **Step 5: 验证宽度持久化**

拖拽调整宽度 → 刷新页面 → 宽度恢复到拖拽后的值（存在 localStorage `sn-workspace` 中）
