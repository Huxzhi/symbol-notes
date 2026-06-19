# Vault 本地配置文件夹（`.symbol-notes/`）设计

日期：2026-06-19
状态：已批准设计，待实现计划

## 背景与动机

当前 app 的两类配置都存在浏览器 `localStorage`：

- `sn-workspace` —— 分屏 / 标签布局（`{ layouts, activeLayoutId }`，见 `workspaceStore.ts`）。
- `sn-settings` —— 主题、自定义主题、`customCSS`、`autoTimestamps`、`showOtherFiles`、`pluginStates`（见 `settingsStore.ts`）。

`localStorage` 是**全局的、不区分 vault** 的：在不同 vault 间切换会共用同一份配置、互相串扰。本设计模仿 Obsidian 的 `.obsidian/` 思路，在选定 vault 的顶层创建一个隐藏配置文件夹，把上述两类配置改为**按 vault 本地存储**，使每个 vault 拥有独立的布局与设置。

## 目标

- 在 vault 顶层维护一个隐藏配置文件夹（默认 `.symbol-notes/`），保存 workspace 与 settings。
- 打开 vault 时自动读取该文件夹；不存在时提示用户是否创建；用户拒绝则本次会话仅用内存、不落盘。
- 拒绝的决定按 vault 记住，下次（含开机自动恢复）不再反复提示；可在设置页重新启用。
- 配置文件夹的相对路径可在设置页修改。
- 配置文件夹是该 vault 配置的**唯一真相来源**；两个 store 不再读写 `localStorage`。

## 非目标

- 不做多 vault 注册表 / 多 vault 同时管理（app 当前只记住一个 vault）。
- 不把 IndexedDB 里的文件 stat / meta 索引缓存搬进配置文件夹（那是性能缓存，与本设计无关）。
- 不为「自定义的非点开头路径出现在文件树」做特殊隐藏处理（见已知限制）。
- 不做配置文件的外部编辑冲突合并（解析失败时回退默认即可）。
- **不做旧 localStorage 配置的迁移**（当前处于开发阶段，已有 `sn-workspace` / `sn-settings` 直接丢弃）。

## 关键决策（已确认）

| 决策点 | 结论 |
| --- | --- |
| 配置范围 | workspace + settings 两类都搬进 vault |
| 持久化模型 | vault 配置文件夹为唯一真相；不迁移旧 localStorage（开发阶段丢弃）；拒绝则本次仅内存 |
| 默认文件夹名 | `.symbol-notes`（点开头，扫描器自动隐藏；不与真正的 Obsidian `.obsidian` 冲突） |
| 拒绝后的行为 | 按 vault 记住拒绝，不再反复弹窗；设置页可重新启用 |
| store↔磁盘绑定方式 | 新建 `vault/vaultConfig.ts` 协调层 + 改写两个 store 的持久化 `createEffect`（方案 A） |

## 架构

### 1. 磁盘布局

```
<vault>/.symbol-notes/
  ├─ workspace.json   # = 原 sn-workspace：{ layouts, activeLayoutId }
  └─ settings.json    # = 原 sn-settings：theme/customThemes/customCSS/autoTimestamps/showOtherFiles/pluginStates
```

点前缀使 `LocalAdapter.listAll` / `scanTree` 中的 `if (name.startsWith('.')) continue` 自动跳过该文件夹，因此它对文件树 / 索引不可见。

### 2. vault 外的指针元数据（解决先有鸡还是先有蛋）

读取配置文件前，需要先知道「配置文件夹的相对路径」与「用户是否已拒绝」。这两项不能存在 vault 内部，否则无法在读之前判断。存入 IndexedDB（复用已有的 `idb-keyval`，当前已用于 `rootHandle`）：

```ts
// 与「当前记住的那个 vault」绑定。open() 选择新文件夹时重置。
interface VaultConfigMeta {
  path: string                                 // 默认 '.symbol-notes'
  status: 'active' | 'declined' | 'unknown'    // unknown = 尚未探测/老用户升级首次
}
```

因为 app 目前只记住一个 vault（单个 `rootHandle` 键），用单条伴随记录即可，不需要多 vault 注册表（YAGNI）。`open()` 覆盖 `rootHandle` 时同步重置该记录，二者始终代表「当前记住的 vault」。

### 3. 新模块 `src/vault/vaultConfig.ts`

职责（IO 隔离在此，store 只管状态）：

- 持有 `path` / `status`，提供 `isActive()`。
- `loadVaultConfig()`：经 `vaultFs()` adapter 的 `readText` 读 `<path>/workspace.json`、`<path>/settings.json`，解析 + 校验，返回 payload（缺失或解析失败返回 null）。
- `saveWorkspace(payload)` / `saveSettings(payload)`：防抖（~800ms）经 adapter `writeText` 落盘（`writeText` 会自动创建嵌套目录）。
- `createConfigFolder(seed)`：创建文件夹并写入种子内容，置 `status='active'`，持久化 meta。
- `decline()`：置 `status='declined'`，持久化 meta。
- `setPath(newPath)`：迁移到新相对路径并重新落盘。
- 探测 + 提示的编排（见数据流）。

**所有配置 IO 走 adapter 直读直写，绕开 `io.ts` 的 `contentCache` 与索引层**，以保持分层（配置文件不属于 indexing 流程）。

可单测的纯函数（payload 校验、meta 状态判定）拆出并配 `__tests__`（node 环境，不碰浏览器 API），与现有测试策略一致。

### 4. store 改造（`settingsStore.ts` / `workspaceStore.ts`）

- 现有 `createRoot(() => createEffect(() => saveToStorage(...)))` 改为：`createEffect(() => { if (vaultConfig.isActive()) vaultConfig.saveWorkspace/saveSettings(slice) })`。非 active 时不写任何地方（仅内存）。
- store 初始化：**只从默认值初始化，彻底不读 localStorage**（移除现有的 `loadFromStorage(...)`）。这两个 store 不再依赖 `localStorage`。
- 新增 hydrate 入口：`hydrateWorkspace(payload)` / `hydrateSettings(payload)`，供 `vaultConfig` 读到磁盘内容后注入 store（覆盖式）。theme/customCSS 经 `App.tsx` 既有 `createEffect` 响应式生效，无需额外防闪处理。

### 5. 数据流

**`openVault()`（用户新选文件夹，`vault/index.ts`）：**

1. 照常 `scanAndIndex()`。
2. 重置 meta，探测 `<path>/settings.json` 是否存在：
   - **存在** → `loadVaultConfig()` → `hydrate*` 两个 store → `status='active'`。
   - **不存在** → 弹 `ConfirmModal`「在此 vault 创建 `.symbol-notes/` 保存布局与设置？」
     - 确认 → `createConfigFolder(当前 store 状态)`（即默认值 + 本次会话内已做的改动）→ `status='active'`。
     - 拒绝 → `decline()` → 本次仅内存。

**`restoreVault()`（开机，同一文件夹）：**

1. 读 meta。
2. `active` → `loadVaultConfig()` → `hydrate*`。
3. `declined` → 不做任何持久化（store 保持默认值）。
4. `unknown`（老用户升级首次）→ 按 `openVault()` 的「探测 + 提示」分支处理。

### 6. 设置页（`Settings.tsx`）

新增「vault 配置」一节：

- 显示当前状态：active（含路径）/ declined / 无 vault 打开。
- 相对路径输入框，默认 `.symbol-notes`；修改触发 `setPath`（迁移并重新落盘）。
- `declined` 状态下提供「启用配置文件夹」按钮（等价于触发创建流程）。

## 错误处理与边界

- 配置文件解析 / 校验失败 → 回退默认值 + toast 提示，不崩溃。
- 自定义的**非点开头**相对路径会出现在文件树中（已知限制；默认 `.symbol-notes` 点开头不受影响）。文档说明即可，不做特殊隐藏。
- 重新 `openVault()` 一个曾经 declined 的文件夹会重置 meta，从而重新提示——可接受（「记住拒绝」主要覆盖开机 `restore` 路径）。
- 写盘失败（权限 / 配额）→ toast 提示，不阻断编辑。

## 测试策略

- `vaultConfig` 纯函数单测：payload 形状校验、meta 状态机判定。
- IO / adapter / 提示编排不做单测（依赖浏览器 API，与现有约定一致）。
- 提交前跑 `npm run build`（含 tsc）与 `npx vitest run`。

## 涉及文件（预估）

- 新增：`src/vault/vaultConfig.ts` + `src/vault/__tests__/vaultConfig.test.ts`
- 改动：`src/stores/settingsStore.ts`、`src/stores/workspaceStore.ts`（持久化副作用 + hydrate 入口）
- 改动：`src/vault/index.ts`（`openVault` / `restoreVault` 接入探测 + 提示编排）
- 改动：`src/vault/fs/LocalAdapter.ts`（如需 `restore()` 时同步重置 meta / 可能复用现有 idb-keyval 使用方式）
- 改动：`src/components/Settings.tsx`（vault 配置一节）
