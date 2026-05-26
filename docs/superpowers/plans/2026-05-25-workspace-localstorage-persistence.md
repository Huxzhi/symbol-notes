# Workspace localStorage 持久化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 workspace layouts/activeLayoutId 响应式持久化到 localStorage，并提取通用工具模块替换现有零散的 `saved()` 函数。

**Architecture:** 新建 `src/lib/localStorage.ts`，提供 `loadFromStorage`（同步读取，带 validate 回退）、`saveToStorage`（写入）、`syncToStorage`（`createEffect` 包装，响应式同步）三个函数。`globalStore.ts` 改用 `loadFromStorage` 初始化所有 workspace 字段（含新增的 layouts）；`App.tsx` 在组件内调用 `syncToStorage` 建立响应式写入。

**Tech Stack:** SolidJS, TypeScript, Vitest

---

## 文件变更清单

| 文件 | 操作 |
|------|------|
| `src/lib/localStorage.ts` | Create — 三个工具函数 |
| `src/__tests__/localStorage.test.ts` | Create — `loadFromStorage` / `saveToStorage` 单测 |
| `src/stores/globalStore.ts` | Modify — 删 `saved()`，改用 `loadFromStorage`，加 workspace 加载 |
| `src/App.tsx` | Modify — 加 `syncToStorage` 调用 |

---

### Task 1: 测试并实现 `loadFromStorage` 和 `saveToStorage`

**Files:**
- Create: `src/__tests__/localStorage.test.ts`
- Create: `src/lib/localStorage.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/__tests__/localStorage.test.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadFromStorage, saveToStorage } from '../lib/localStorage'

const mockStore: Record<string, string> = {}
const localStorageMock = {
  getItem: vi.fn((key: string) => mockStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { mockStore[key] = value }),
}

beforeEach(() => {
  Object.keys(mockStore).forEach(k => delete mockStore[k])
  vi.clearAllMocks()
  vi.stubGlobal('localStorage', localStorageMock)
})

describe('loadFromStorage', () => {
  it('returns fallback when key does not exist', () => {
    expect(loadFromStorage('missing', 42)).toBe(42)
  })

  it('returns parsed value when key exists', () => {
    mockStore['x'] = JSON.stringify({ a: 1 })
    expect(loadFromStorage('x', null)).toEqual({ a: 1 })
  })

  it('returns fallback when JSON is invalid', () => {
    mockStore['bad'] = 'not-json{'
    expect(loadFromStorage('bad', 'default')).toBe('default')
  })

  it('returns fallback when validate returns false', () => {
    mockStore['v'] = JSON.stringify([1, 2, 3])
    expect(loadFromStorage('v', 'fb', (v) => typeof v === 'string')).toBe('fb')
  })

  it('returns value when validate returns true', () => {
    mockStore['v'] = JSON.stringify('hello')
    expect(loadFromStorage('v', '', (v) => typeof v === 'string')).toBe('hello')
  })
})

describe('saveToStorage', () => {
  it('serializes value to localStorage', () => {
    saveToStorage('k', { foo: 'bar' })
    expect(localStorageMock.setItem).toHaveBeenCalledWith('k', '{"foo":"bar"}')
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run src/__tests__/localStorage.test.ts
```

预期：FAIL — `Cannot find module '../lib/localStorage'`

- [ ] **Step 3: 实现 `loadFromStorage` 和 `saveToStorage`**

创建 `src/lib/localStorage.ts`（仅这两个函数，`syncToStorage` 在 Task 2 添加）：

```ts
export function loadFromStorage<T>(
  key: string,
  fallback: T,
  validate?: (v: unknown) => boolean,
): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed = JSON.parse(raw) as unknown
    if (validate && !validate(parsed)) return fallback
    return parsed as T
  } catch {
    return fallback
  }
}

export function saveToStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch { /* quota exceeded */ }
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run src/__tests__/localStorage.test.ts
```

预期：6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/localStorage.ts src/__tests__/localStorage.test.ts
git commit -m "feat: add loadFromStorage/saveToStorage localStorage utilities with tests"
```

---

### Task 2: 添加 `syncToStorage` 到 localStorage.ts

**Files:**
- Modify: `src/lib/localStorage.ts`

- [ ] **Step 1: 在文件顶部添加 SolidJS import，在文件末尾添加 `syncToStorage`**

在 `src/lib/localStorage.ts` 开头加：

```ts
import { createEffect } from 'solid-js'
```

在文件末尾追加：

```ts
export function syncToStorage<T>(key: string, getSlice: () => T): void {
  createEffect(() => saveToStorage(key, getSlice()))
}
```

- [ ] **Step 2: TypeScript 检查**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1 | head -20
```

预期：无错误

- [ ] **Step 3: 运行全部测试（localStorage 测试仍应通过）**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run
```

预期：所有测试 PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/localStorage.ts
git commit -m "feat: add syncToStorage reactive localStorage sync utility"
```

---

### Task 3: 更新 `globalStore.ts` — 替换 `saved()`，加载 workspace layouts

**Files:**
- Modify: `src/stores/globalStore.ts`

- [ ] **Step 1: 替换 import，删除 `saved()` 函数**

在 `src/stores/globalStore.ts` 顶部，将现有 import 改为：

```ts
import { createStore } from 'solid-js/store'
import { loadFromStorage } from '../lib/localStorage'
import type {
  GlobalState, ThemeId, WorkspaceNode, WorkspaceLeaf,
  WorkspaceLayout, WorkspaceRoot,
} from './types'
```

删除第 7–14 行的 `saved()` 函数：

```ts
// 删除：
function saved<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw !== null ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
```

- [ ] **Step 2: 在 `initialLayout` 定义之后，store 创建之前，加入 workspace 加载逻辑**

在 `initialLayout` 的闭合 `}` 之后（第 55 行）、`const [globalStore, setGlobalStore] = ...` 之前插入：

```ts
const savedWs = loadFromStorage<{ layouts: WorkspaceLayout[]; activeLayoutId: string }>(
  'sn-workspace',
  { layouts: [initialLayout], activeLayoutId: DEFAULT_LAYOUT_ID },
  (v) =>
    typeof v === 'object' &&
    v !== null &&
    Array.isArray((v as Record<string, unknown>).layouts) &&
    typeof (v as Record<string, unknown>).activeLayoutId === 'string',
)
```

- [ ] **Step 3: 更新 store 初始化 — 用 `loadFromStorage` 替换 4 处 `saved()`，用 `savedWs` 初始化 layouts**

将 `createStore<GlobalState>({...})` 中的 workspace 字段改为：

```ts
workspace: {
  layouts: savedWs.layouts,
  activeLayoutId: savedWs.activeLayoutId,
  theme: loadFromStorage<ThemeId>('sn-theme', 'dark'),
  customCSS: loadFromStorage<string>('sn-customCSS', ''),
  showSettings: false,
  autoTimestamps: loadFromStorage<boolean>('sn-autoTimestamps', true),
  showOtherFiles: loadFromStorage<boolean>('sn-showOtherFiles', true),
},
```

- [ ] **Step 4: TypeScript 检查**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1 | head -20
```

预期：无错误

- [ ] **Step 5: 运行全部测试**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run
```

预期：所有测试 PASS（含原有 workspaceHelpers 测试）

- [ ] **Step 6: Commit**

```bash
git add src/stores/globalStore.ts
git commit -m "refactor(globalStore): replace saved() with loadFromStorage, load workspace layouts from storage"
```

---

### Task 4: 更新 `App.tsx` — 响应式同步 workspace 到 localStorage

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 添加 `syncToStorage` import**

在 `src/App.tsx` 顶部 import 区域加一行：

```ts
import { syncToStorage } from './lib/localStorage'
```

- [ ] **Step 2: 在 `App()` 内现有两个 `createEffect` 之后添加 `syncToStorage` 调用**

在：

```ts
createEffect(() => {
  customStyleEl.textContent = globalStore.workspace.customCSS
})
```

之后插入：

```ts
syncToStorage('sn-workspace', () => ({
  layouts: globalStore.workspace.layouts,
  activeLayoutId: globalStore.workspace.activeLayoutId,
}))
```

- [ ] **Step 3: TypeScript 检查**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit 2>&1 | head -20
```

预期：无错误

- [ ] **Step 4: 运行全部测试**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run
```

预期：所有测试 PASS

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: reactively sync workspace layouts to localStorage via syncToStorage"
```

---

## 验证清单（手动）

- [ ] 打开应用，折叠一个文件夹
- [ ] 刷新页面，折叠状态保持
- [ ] 打开多个标签页，刷新页面，标签页恢复
- [ ] 切换 layout，刷新页面，activeLayoutId 恢复
- [ ] 清空 `localStorage.removeItem('sn-workspace')` 后刷新，应用正常启动（回退到默认布局）
