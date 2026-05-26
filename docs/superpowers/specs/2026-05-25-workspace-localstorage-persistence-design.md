# Workspace localStorage 持久化设计

**日期:** 2026-05-25  
**状态:** 待实现

## 目标

将 `workspace.layouts` 和 `workspace.activeLayoutId` 响应式持久化到 localStorage，使文件夹折叠状态、标签页布局等在页面刷新后保留。同时提取通用的 localStorage 工具模块，替换现有零散的 `saved()` 和手动 `setItem` 调用。

## 范围

- **新建** `src/lib/localStorage.ts` — 工具函数
- **修改** `src/stores/globalStore.ts` — 用工具函数读取 workspace 初始值
- **修改** `src/App.tsx` — 响应式同步 workspace 到 localStorage

`workspaceActions.ts`、`types.ts` 无需改动。

## 模块设计

### `src/lib/localStorage.ts`

三个导出函数：

**`loadFromStorage<T>(key, fallback, validate?)`**
- 读取并 JSON.parse localStorage
- 若 key 不存在、JSON 解析失败、或 validate 返回 false，返回 fallback
- 替换 `globalStore.ts` 中现有的 `saved<T>()` 函数

**`saveToStorage<T>(key, value)`**
- JSON.stringify 并写入 localStorage
- try/catch 防止 quota 超限静默失败

**`syncToStorage<T>(key, getSlice)`**
- 内部调用 `createEffect(() => saveToStorage(key, getSlice()))`
- 必须在 SolidJS 响应式上下文（组件内）调用
- SolidJS 会在 `createEffect` 中追踪 `getSlice()` 访问的所有 proxy 属性，包括嵌套的 `viewState.collapsedFolders`

### `src/stores/globalStore.ts`

- 删除现有 `saved<T>()` 函数，改为 `import { loadFromStorage } from '../lib/localStorage'`
- 现有标量设置（theme、customCSS、autoTimestamps、showOtherFiles）的读取改用 `loadFromStorage`，行为不变
- 新增 workspace layouts 的初始化读取：

```ts
const savedWorkspace = loadFromStorage(
  'sn-workspace',
  { layouts: [initialLayout], activeLayoutId: DEFAULT_LAYOUT_ID },
  (v) => typeof v === 'object' && v !== null && Array.isArray((v as any).layouts),
)
```

- store 初始化中 `layouts` 和 `activeLayoutId` 使用 `savedWorkspace` 中的值

### `src/App.tsx`

在 `App()` 组件内现有 `createEffect` 旁边添加：

```ts
syncToStorage('sn-workspace', () => ({
  layouts: globalStore.workspace.layouts,
  activeLayoutId: globalStore.workspace.activeLayoutId,
}))
```

## 数据格式

localStorage key: `sn-workspace`

```json
{
  "layouts": [ ...WorkspaceLayout[] ],
  "activeLayoutId": "default"
}
```

## 兼容性与错误处理

- 读取失败（key 不存在 / JSON 无效 / validate 失败）→ 回退到 `initialLayout`，无报错
- 写入失败（quota exceeded）→ 静默失败，不影响运行时
- 现有 localStorage keys（`sn-theme` 等）保持不变，不做合并

## 不变的部分

- `appActions.ts` 中 theme/customCSS/autoTimestamps/showOtherFiles 的手动 setItem 调用**保持不变**（本次不统一）
- `workspace.showSettings` 不持久化（临时 UI 状态）

## 测试

`loadFromStorage` 是纯函数，在 node 环境下可直接用 vitest + mock localStorage 测试：
- 返回 fallback（key 不存在）
- 返回 fallback（JSON 解析失败）
- 返回 fallback（validate 失败）
- 正常返回 parsed 值
