# 启动分阶段加载（并发扫描 + 后台解析）— 设计

日期：2026-06-10
状态：已确认，待写实现计划

## 背景与目标

当前启动 `scanAndIndex` 把"FS 遍历 → 解析 → 建索引"全程压在全屏 `LoadingOverlay` 下，且：
- FS 遍历（`LocalAdapter.listAll`）对每个文件**串行** `await getFile()` 取 size/mtime——大库慢，且首屏要等它跑完。
- 解析阶段**逐文件 `setVaultStore`**，上千文件上千次响应式重排 → 解析期间点击卡死。

目标：把启动重构成分阶段流程，**扫描完即可交互**，解析在后台补全且不卡 UI。

## 分阶段流程

| 阶段 | 行为 | UI |
|---|---|---|
| 0 扫描 | 并发遍历目录（有界并发 stat），得到全部条目（path/kind/parent/size/mtime） | **全屏遮挡** |
| 1 露出 | `setVaultStore('files', 仅 stat 的 FileMeta)` → 撤遮挡 | 显示工作区 + 文件树，可交互 |
| 2 解析 | 后台逐个解析 md（hash 缓存 + mtime 命中），结果**攒在本地 map，不动 store** | 右上角 toast 显示 `解析中 X/N`，提示双链/task 暂不完整 |
| 2.5 合并 | 全部解析完，**一次** `setVaultStore` 把完整 FileMeta 合并进 store | — |
| 3 索引 | `buildBacklinks/Tags/Tasks` 建跨文件索引 | toast 转"解析完成"并消失，双链/task 就绪 |

一致性：阶段 0 拿到的就是当前 FS 真实快照，无陈旧数据问题。

## 组件与改动

### 1. 有界并发扫描 `src/vault/fs/LocalAdapter.ts` + helper

新增通用 helper（放 `src/vault/fs/concurrency.ts` 或 scan.ts）：

```ts
export async function mapWithConcurrency<T, R>(
  items: T[], limit: number, fn: (item: T, i: number) => Promise<R>,
): Promise<R[]>
```

`LocalAdapter` 新增 `scanTree(concurrency = 32): Promise<DirEntry[]>`：
- 先递归 `handle.entries()` **只枚举结构**（不 `getFile`），收集目录条目（立即可定）与文件条目（连同 `FileSystemFileHandle`）。
- 再用 `mapWithConcurrency(fileHandles, concurrency, h => h.getFile())` **有界并发**取 size/mtime，回填文件条目。
- 返回完整 `DirEntry[]`（目录 + 文件）。`.` 开头跳过（沿用现有）。
- `FileSystemAdapter` 接口加 `scanTree(concurrency?: number): Promise<DirEntry[]>`。
- `listAll` 保留（`rescanTree` 仍用）。

每完成一个文件 stat 调一次进度计数（沿用 `incDetected`），驱动遮挡里的"检测到 N 个文件"。

### 2. `src/vault/scan.ts` — `buildScan` 用 `scanTree`，`runPhase1` 不写 store

- `buildScan`：改为 `const entries = await adapter.scanTree()`（经 io 暴露 `scanTree`），由 `DirEntry[]` 构造 `files`（与现状同：目录/文件 FileMeta，内容字段走 `EMPTY_CONTENT`，stat 来自条目）。
- `runPhase1` → 重构为 `parseAll(session, unchanged, changed, activeHashes, onProgress)`：
  - 仍按 stat 缓存分 `unchanged`/`changed`，`unchanged` 走 `getManyMeta`，`changed` 读文件 + hash + `getCachedMeta`/解析 + `setCachedMeta`（逻辑不变）。
  - **不再 `setVaultStore`**；把每个文件的 `ContentFields`（frontmatter/outLinks/etags/tags/aliases/created/updated/dated/lists）攒进一个 `Map<string, ContentFields>` 返回。
  - 每处理一个文件调 `onProgress(done, total)`（驱动 toast）。
  - 保留分批 `yieldToMain()`（让出主线程，保证可点）。

### 3. `src/vault/index.ts` — `scanAndIndex` 编排重构

新流程：

```
beginLoadProgress(session)                       // 阶段0 遮挡（300ms 延迟显示）
const entries = await buildScan()                // 并发扫描
if (cancelled) return
setVaultStore('files', files)                    // 阶段1 仅 stat
endScanOverlay(session)                           // 撤全屏遮挡

const toast = startParseToast()                   // 右上角常驻 toast
const results = await parseAll(session, unchanged, changed, activeHashes,
  (done, total) => updateToast(toast, `解析中 ${done}/${total}…（双链/task 暂不完整）`))
if (cancelled) { dismissToast(toast); return }

setVaultStore('files', produce((files) => {       // 阶段2.5 一次性合并
  for (const [path, fields] of results) {
    const f = files[path]; if (f) Object.assign(f, fields)
  }
}))

buildBacklinks(mdFiles); buildTags(mdFiles); buildTasks(mdFiles)  // 阶段3
finishParseToast(toast)                            // 转"解析完成"2s 后消失
pruneFileStatCache / pruneCache                    // 不变
```

- `produce` 已在本文件 import；一次 `setVaultStore` = 一次响应式更新（零逐文件churn）。
- `mdFiles` 从合并后的 `vaultStore.files` 取（与现状同）。
- session 取消检查在各 await 后保留（沿用）。

### 4. `src/vault/loadProgress.ts` + `LoadingOverlay.tsx` — 遮挡只管扫描

- 遮挡只在**阶段 0**可见。新增 `endScanOverlay(session)`：校验 session 后 `setSnapshot(s => ({ ...s, visible: false }))` 并停掉 count-up 定时器；在阶段 1（撤遮挡）调用。`endLoadProgress` 仍在最末收尾。
- `LoadingOverlay` 简化为只显示扫描信息（"读取本地文件夹…检测到 N 个文件"）；删掉第二/三阶段那两行（解析/构建移到 toast）。
- 解析/构建进度不再走 overlay。`parsing`/`building` 相关的 overlay 文案与 `parsedTotal` 在 overlay 中移除（loadProgress 的计数可保留供内部用或一并精简）。

### 5. `src/stores/toastStore.ts` — 支持可更新的常驻进度 toast

最小扩展：
- `showToast(...)` **返回 `id: number`**（其余不变）。
- 新增 `updateToast(id: number, msg: string): void`（`setToastStore('items', i => i.id===id, 'msg', msg)`，不存在则忽略）。
- 进度 toast 用 `showToast('解析中 0/…', { requireClick: true, level: 'info' })`（常驻不自动消失），过程中 `updateToast`，阶段 3 完成后 `dismissToast(id)` 并可 `showToast('解析完成', { duration: 2000 })`。
- `ToastContainer` 已是 `fixed top-3 right-3`（右上角），无需改。

## 数据流

1. 阶段0：`scanTree`（有界并发）→ `DirEntry[]` → `files`（stat-only）。
2. 阶段1：`setVaultStore('files')` → 文件树/工作区出现，撤遮挡。
3. 阶段2：`parseAll` 后台解析（缓存优先）→ `Map<path, ContentFields>`，toast 进度。
4. 阶段2.5：`produce` 一次性合并完整 FileMeta。
5. 阶段3：建双链/标签/任务索引 → toast 完成。

## 边界与错误处理

- 解析期间用户打开/编辑文件：编辑器独立读盘解析，正常工作；`reindexFile` 单文件写 store。阶段 2.5 用 `produce` **就地合并**（读当前 `files` 逐 path `Object.assign`），不整体替换，避免覆盖期间的单文件更新。
- 取消（切库/重扫）：各阶段 await 后检查 `session.cancelled`，提前返回并 `dismissToast`。
- 有界并发：默认 32，避免一次性打满句柄；可常量调。
- 大文件（> `MAX_PARSE_BYTES`）：阶段 2 跳过解析（沿用现有判断），FileMeta 保持 stat-only。
- 空库 / 无 md：toast 直接完成。

## 测试

- `mapWithConcurrency`：单测并发上限不超、保序、全部完成、错误传播。
- `toastStore`：`showToast` 返回递增 id；`updateToast` 改对应 msg；`updateToast` 不存在 id 时 no-op。
- `parseAll`：可对其纯逻辑部分（unchanged/changed 分流、结果聚合）做单测（注入假的缓存读取）；或保留现有 scan 测试覆盖。
- 阶段编排 / 遮挡撤除 / toast 展示 / 大库性能：手动浏览器验证（需真实 vault）。

## 不做（后续 / YAGNI）

- 持久化整库索引快照（方案 A 的 stale-while-revalidate）——本设计靠"并发扫描 + 后台解析"已达"扫描完即用"，不引入陈旧一致性问题。
- Web Worker 把解析搬离主线程——先靠"攒批一次写 + 让出主线程"，实测仍卡再议。
- `rescanTree` 的并发化（本期只优化启动 `buildScan`）。
