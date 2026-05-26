# Sidebar Drag Resize Design

**Date:** 2026-05-26  
**Status:** Approved

## Goal

让左右两侧边栏支持鼠标拖拽调整宽度。拖拽小于 50px 时自动折叠；展开/折叠仍通过 Ribbon 按钮控制（与 Obsidian 一致）。宽度变化实时写入 `workspaceStore`，随 localStorage 持久化。

---

## Architecture

### Store 层

在 `workspaceStore.ts` 的 `workspaceActions` 中新增一个 action：

```ts
setSidebarWidth(side: 'left' | 'right', width: number): void
```

内部调用 `setRoot(side, 'width', width)`，直接更新 `SidebarSplit.width`。

不需要新增类型，`SidebarSplit.width: number` 已存在。

### 组件层

**`SidebarRenderer`** 新增 `side: 'left' | 'right'` prop（由 App.tsx 传入）。

在 sidebar 的内侧边缘渲染一个 resize handle div：
- left sidebar → handle 在右侧边缘
- right sidebar → handle 在左侧边缘

Handle 样式：
- 宽度：`4px`（hit area），中间 `1px` 可见线
- 颜色：`bg-(--border)`，hover 变 `bg-(--accent)`
- 光标：`cursor-col-resize`
- 折叠状态下（`collapsed = true`）handle 不渲染

### Drag 逻辑（Pointer Capture API）

```
onPointerDown:
  e.currentTarget.setPointerCapture(e.pointerId)
  startX = e.clientX
  initWidth = sidebar().width

onPointerMove:
  delta = e.clientX - startX
  newWidth = side === 'left' ? initWidth + delta : initWidth - delta
  if newWidth < 50:
    workspaceActions.toggleSidebar(side)   // 折叠
    e.currentTarget.releasePointerCapture(e.pointerId)
    return
  workspaceActions.setSidebarWidth(side, clamp(newWidth, 50, 800))

onPointerUp:
  e.currentTarget.releasePointerCapture(e.pointerId)
```

Pointer Capture 的好处：拖拽时鼠标移出元素也能持续接收事件，无需挂 document 监听器，`onPointerUp` 自动清理。

---

## Files Changed

| 文件 | 变更内容 |
|------|----------|
| `src/stores/workspaceStore.ts` | 新增 `setSidebarWidth` action |
| `src/components/workspace/SidebarRenderer.tsx` | 新增 `side` prop，加 resize handle，实现 drag 逻辑 |
| `src/App.tsx` | 给 `<SidebarRenderer>` 传 `side="left"` / `side="right"` |

---

## Constraints

- **最小宽度：50px**（拖到 50px 以下直接折叠，不存中间态）
- **最大宽度：800px**（clamp 上限，防止撑满屏幕）
- 展开永远通过 Ribbon 按钮，不支持"拖拽 handle 从折叠展开"
- 折叠时 handle 隐藏（sidebar width 为 0，handle 无处渲染）
- 宽度写入 workspaceStore → 自动持久化到 localStorage（现有机制）

---

## Out of Scope

- 触摸屏 / touch 事件支持
- 双击 handle 重置为默认宽度
- 拖拽时显示宽度 tooltip
