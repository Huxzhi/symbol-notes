# 启动加载进度遮罩设计 (Startup Loading Overlay)

日期：2026-06-07
状态：已批准，待实现

## 背景与目标

程序启动恢复上次 vault、或用户手动打开/切换 vault 时，会执行 `scanAndIndex`：先递归遍历文件系统（检测文件），再解析 .md 内容（命中 IDB 缓存或重新解析）。目前这是后台静默进行的（仅 StatusBar 有个不显眼的"后台检测中"小圆点）。

目标：在加载期间显示一个**全屏阻塞遮罩**，期间无法操作，展示：
- 不确定（滚动动画）进度条
- 检测到的文件数量
- 已解析的文件数量

并且**每 0.5 秒刷新一次**显示。

## 范围

- 触发：启动自动恢复（`restoreVault`）+ 手动打开/切换 vault（`openVault`）。两者都走同一个 `scanAndIndex`。
- 不触发：文件系统变化导致的后台 rescan（保持静默）。

## 关键决策（已确认）

- 进度条：**不确定滚动动画**，不显示百分比（检测/解析总数事先未知，递归扫描时才得知）。
- "检测到的文件数量"口径：**仅文件**（`kind === 'file'`，含非 .md，排除文件夹）。
- "已解析的文件数量"：已处理完的 .md 数（缓存命中 + 重新解析都计入）。
- 闪烁处理：**延迟 300ms 显示**。加载在 300ms 内完成则遮罩完全不出现。
- 刷新节流：裸计数器高频自增，**500ms 采样**写入响应式信号。

## 架构

新增/修改：

| 文件 | 职责 |
|---|---|
| `src/vault/loadProgress.ts`（新增） | 裸计数器（detected/parsed）+ 响应式信号（visible/phase/detected/parsed）；`beginLoadProgress` / `endLoadProgress` / `incDetected` / `incParsed`；300ms 延迟显示 + 500ms 采样定时器；session 防重入守卫 |
| `src/components/LoadingOverlay.tsx`（新增） | 读取 loadProgress 信号渲染全屏遮罩 |
| `src/vault/scan.ts`（修改） | `buildScan` 加可选 `onDetected` 回调；`runPhase1` 加可选 `onParsed` 回调 |
| `src/vault/index.ts`（修改） | `scanAndIndex` 调用 begin/end 并连线回调；包 try/finally 防异常卡死 |
| `src/App.tsx`（修改） | 挂载 `<LoadingOverlay />` |

## 数据流

1. `restoreVault`（启动）或 `openVault`（手动）→ `scanAndIndex`。
2. `scanAndIndex`：`setIsIndexing(true)` 后调用 `beginLoadProgress(session)` —— 重置 detected=parsed=0、phase='scanning'、启动 300ms 延迟显示定时器 + 500ms 采样定时器。
3. 检测阶段 `buildScan(onDetected)`：每遇到 `kind==='file'` 条目 → `incDetected()`（裸计数 +1）。
4. 待解析列表确定后，phase 切到 'parsing'。
5. 解析阶段 `runPhase1(..., onParsed)`：每处理完一个 .md（unchanged 应用缓存 + changed 重新解析都算）→ `incParsed()`。
6. 完成或被新 session 取代 → `endLoadProgress(session)`：停采样、取消未触发的延迟显示、phase='done'、visible=false。

## loadProgress 模块接口

```ts
// 裸计数器（普通变量，高频自增）
// 响应式快照信号：{ visible, phase, detected, parsed }
export type LoadPhase = 'idle' | 'scanning' | 'parsing' | 'done'
export interface LoadSnapshot {
  visible: boolean
  phase: LoadPhase
  detected: number
  parsed: number
}
export const loadProgress: () => LoadSnapshot   // Solid signal accessor

export function beginLoadProgress(session: object): void
export function endLoadProgress(session: object): void
export function setLoadPhase(session: object, phase: LoadPhase): void
export function incDetected(): void
export function incParsed(): void
```

- `beginLoadProgress(session)`：记录 `currentProgressSession = session`，重置裸计数，phase='scanning'，visible 暂为 false；`setTimeout(300ms)` 后将 visible 置 true（仅当 session 仍为当前）；启动 `setInterval(500ms)` 采样把裸计数写入信号。
- `endLoadProgress(session)`：若 `session !== currentProgressSession` 则忽略（旧 session）；否则清延迟定时器、清采样定时器、做一次最终采样、phase='done'、visible=false。
- `incDetected/incParsed`：仅自增裸计数（不直接触发渲染）。
- session 守卫复用 `scanAndIndex` 已有的 `Session` 对象（`{ cancelled: boolean }`），传引用即可。

## 遮罩 UI

- `position: fixed; inset-0; z-[10001]`（高于现有 modal 的 z-10000），暗色半透明背景，居中卡片。
- 内容：
  - 标题"正在加载笔记库…"
  - 阶段文字：phase==='scanning' → "检测文件中…"；phase==='parsing' → "解析文件中…"
  - 不确定滚动动画进度条（CSS 动画，复用主题 `--accent`）
  - 两行计数："检测到 {detected} 个文件"、"已解析 {parsed} 个文件"
- 仅在 `loadProgress().visible` 为 true 时渲染（`<Show>`）。覆盖全屏即阻断操作。

## 防重入 / 异常

- `scanAndIndex` 已有 session 取代机制（新调用把旧 session.cancelled 置 true）。`begin/end` 用同一 session 做守卫，旧 session 的 end 不会关掉新遮罩。
- `scanAndIndex` 主体包 `try { ... } finally { if (currentSession === session) { setIsIndexing(false); endLoadProgress(session) } }`，异常时也能复位（修现有隐患：当前无 try/finally，throw 会让 isIndexing 永久为 true）。
- 早返回（`!isReady()`、`session.cancelled`）的处理并入 finally 守卫逻辑。

## 测试

- `loadProgress` 裸计数纯逻辑：`incDetected/incParsed/reset` + `snapshot` 正确性。
- 用 `vi.useFakeTimers()`：
  - 300ms 前 `visible` 为 false，300ms 后为 true。
  - 加载在 300ms 内 `endLoadProgress` → `visible` 始终 false。
  - 裸计数变化经 500ms 采样后反映到信号快照。
  - 旧 session 的 `endLoadProgress` 不影响当前遮罩。
- 遮罩组件 + 真实大库加载手动验证。

## 文件清单（预期）

- 新增 `src/vault/loadProgress.ts` + `src/vault/__tests__/loadProgress.test.ts`
- 新增 `src/components/LoadingOverlay.tsx`
- 改 `src/vault/scan.ts`（两个回调参数）
- 改 `src/vault/index.ts`（begin/end 连线 + try/finally）
- 改 `src/App.tsx`（挂载遮罩）
