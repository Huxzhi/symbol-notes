# 主题独立文件 + 遮罩颜色缓存防闪 + 插件数据落 vault — 设计稿

日期：2026-06-20

## 1. 背景与目标

上一个功能（`2026-06-19-vault-boot-sequence-theme-cache`）把**整份解析后主题**缓存进
IndexedDB，并在启动时 `applyTheme` 给整个应用着色，以此防闪。本设计收窄并理顺这一思路：

- **主题源头仍在 `.symbol-notes`**（vault 内，随 vault 走），不放 IndexedDB。
- 把主题三件套（`theme` / `customThemes` / `customCSS`）从 `settings.json` 拆到独立的
  **`.symbol-notes/theme.json`**；`settings.json` 只留非主题配置。
- IndexedDB 只缓存 **loading 遮罩用到的 6 个颜色变量**，用于「主题还没从 `theme.json`
  读出来」那段时间让遮罩不闪烁——不是主题的真实来源。
- 由此**移除**上个功能引入的 `themeHydrated` 闸门与「IDB 整份主题缓存」：内容在 hydrate
  前一直被遮罩盖住，闸门不再必要。
- **顺带**：把每个插件的配置从 localStorage `sn-plugin-<id>` 迁到
  `.symbol-notes/plugins/<id>/data.json`（随 vault），未激活时仅内存（详见 §6）。

### 非目标

- 不改 workspace 全链路、`indexStorage`（文件解析缓存）、`LocalAdapter`（文件句柄）。
- 不改 `connectVaultConfig` 的揭遮罩时序结构（active/unknown+exists → 先 hydrate 再揭；
  declined/unknown 无配置 → 先揭再走），只在其中多 hydrate 一份 `theme.json`。

## 2. 数据归属（最终）

```
IndexedDB（按浏览器，本地）            .symbol-notes/（随 vault，主题源头）
├─ 文件句柄        (LocalAdapter)      ├─ workspace.json  (workspace)            ← 不变
├─ 文件解析缓存    (indexStorage)      ├─ settings.json   (pluginStates,
├─ vault 配置 meta (vaultConfig)       │     autoTimestamps, showOtherFiles)
└─ 遮罩颜色快照 ★新(themeCache)        ├─ theme.json  ★新 (theme,
     sn-mask-colors                    │     customThemes, customCSS)
                                       └─ plugins/<id>/data.json ★新（每插件配置）
```

**插件配置不再进 localStorage**：现状每个插件的配置存在 localStorage `sn-plugin-<id>`
（见 `pluginRegistry.loadPlugin`，部分插件还直接 `loadFromStorage` 读），改为
`.symbol-notes/plugins/<id>/data.json`，按 vault 走（详见 §6）。

`SettingsState`（内存形状，6 字段）**不变**；仅持久化按两组拆分：

- `ThemeSettings = Pick<SettingsState, 'theme' | 'customThemes' | 'customCSS'>` → `theme.json`
- `VaultSettings = Pick<SettingsState, 'pluginStates' | 'autoTimestamps' | 'showOtherFiles'>` → `settings.json`

两个别名加到 `src/stores/types.ts`。所有消费方（`Settings.tsx` / `App.tsx` 等）仍读
`settingsStore`，不受影响。

**遮罩颜色快照** = `LoadingOverlay` 实际用到的 6 个 CSS 变量的「计算后取值」：
`--bg-elevated`、`--border-2`、`--text`、`--bg-active`、`--accent`、`--text-2`。

## 3. 防闪机制：遮罩自带缓存色，与主题应用解耦

### 3.1 `src/lib/themeCache.ts` 重写

移除上个功能的 `getCachedTheme` / `writeCachedTheme` / `themeHydrated` / `setThemeHydrated`
与 `isThemeSpec`。新接口：

- `const MASK_VARS: readonly string[]` = 上述 6 个变量名。
- `snapshotMaskColors(): Record<string, string>` — 用 `getComputedStyle(document.documentElement)`
  取 `MASK_VARS` 的当前生效值（trim）。仅在浏览器可用；不在 node 测试调用。
- `getMaskColors(): Promise<Record<string, string> | null>` — 从 IDB key `sn-mask-colors`
  读；非对象/空返回 `null`。
- `writeMaskColors(colors: Record<string, string>): Promise<void>` — 写 IDB（fire-and-forget，
  try/catch 吞错）。
- `maskColors` 信号 + `setMaskColors(c)`：boot 时由 IDB 播种，供 `LoadingOverlay` 读。
- 模块加载时顺手 `void del('sn-theme-cache')` 清掉上个功能的旧键（幂等、吞错）。

`isThemeSpec`/`ThemeSpec` 仍保留在 `src/lib/theme.ts`（`applyTheme`/`resolveTheme` 需要），
只是 themeCache 不再用它。

### 3.2 启动（`src/index.tsx`）

```tsx
import { render } from 'solid-js/web'
import App from './App'
import { getMaskColors, setMaskColors } from './lib/themeCache'
import './index.css'

// 防闪：渲染前读回上次的遮罩颜色，使 loading 遮罩首帧即正确着色。
// 主题本体走 .symbol-notes/theme.json，扫描后才 hydrate。
async function boot(): Promise<void> {
  const mask = await getMaskColors()
  if (mask) setMaskColors(mask)
  render(() => <App />, document.getElementById('root')!)
}

void boot()
```

**不再在启动时 `applyTheme`**——`<html>` 维持默认 `data-theme="dark"`（CSS 兜底），但
内容被遮罩盖住，看不到。

### 3.3 `src/components/LoadingOverlay.tsx`

改用 `maskColors()` 的值做**内联样式**，取不到则回退到 `var(--…)`：

```tsx
import { Show } from 'solid-js'
import { loadProgress } from '../vault/loadProgress'
import { maskColors } from '../lib/themeCache'

export function LoadingOverlay() {
  const p = loadProgress
  const c = (name: string) => maskColors()[name] || `var(${name})`
  return (
    <Show when={p().visible}>
      <div
        class="fixed inset-0 z-[10001] flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.6)' }}
      >
        <div
          class="rounded-lg shadow-xl px-6 py-5 flex flex-col gap-3 border"
          style={{
            'min-width': '300px',
            background: c('--bg-elevated'),
            'border-color': c('--border-2'),
          }}
        >
          <div class="text-[14px] font-semibold" style={{ color: c('--text') }}>
            正在读取本地文件夹…
          </div>
          <div
            class="relative h-1.5 w-full overflow-hidden rounded-full"
            style={{ background: c('--bg-active') }}
          >
            <div
              class="loading-overlay-bar absolute inset-y-0 left-0 w-1/3 rounded-full"
              style={{ background: c('--accent') }}
            />
          </div>
          <div class="text-[12px]" style={{ color: c('--text-2') }}>
            检测到 {p().detected} 个文件
          </div>
        </div>
      </div>
    </Show>
  )
}
```

遮罩着色因此完全不依赖 `<html>` 上的主题变量，`applyTheme` 清内联覆盖时不会互相干扰。

### 3.4 `src/App.tsx`

去掉 `themeHydrated` 闸门；主题 effect 改回直接应用，并在应用后刷新遮罩颜色缓存：

```tsx
import { applyTheme, resolveTheme } from './lib/theme'
import { snapshotMaskColors, writeMaskColors } from './lib/themeCache'
// …
  createEffect(() => {
    const spec = resolveTheme(settingsStore.theme, settingsStore.customThemes)
    applyTheme(spec)
    void writeMaskColors(snapshotMaskColors()) // 刷新遮罩缓存供下次启动
  })
```

`customCSS` 的 effect 保持不变。

## 4. 主题流程 + 时序对策

主题源头在 `.symbol-notes`，仍走「扫描 → 遮罩内 hydrate → 揭遮罩」。

- `vaultConfig.readConfigFiles()` 多读一份 `theme.json`，返回
  `{ workspace, settings, theme }`（`settings` 为非主题部分，`theme` 为主题部分）。
  **任一文件缺失/解析失败/格式不对 → 该份返回 `null`**，上层 hydrate 据此走默认值（见 §5.3）。
  不做任何 legacy 迁移：不从旧 `settings.json` 里抠主题字段。
- `connectVaultConfig` 揭遮罩时序**结构不变**；`hydrateVaultConfig` 现在 hydrate 三份。
- **时序细节（关键）：** Solid 的 `createEffect` 是微任务延迟的。若 hydrate 设完 store 后
  立刻 `endScanOverlay`，可能在 App 的主题 effect 跑之前就揭了遮罩 → 揭开瞬间内容仍是默认
  深色。**对策：** `hydrateTheme(payload)` 内设完 store **同步 `applyTheme(resolveTheme(...))`**，
  不依赖 App 的延迟 effect，保证揭遮罩前内容已正确着色。App 的 effect 仍保留，负责运行时
  切主题与刷新遮罩缓存。

## 5. 持久化拆分 + 缺失处理

### 5.1 settingsStore 两路持久化

`src/stores/settingsStore.ts` 用两个独立 `createEffect`（靠 Solid 细粒度追踪天然分流——
各自只读自己关心的字段，互不触发）：

```ts
createRoot(() => {
  // 非主题 → settings.json（gate isConfigActive + 防抖，在 saveSettings 内）
  createEffect(() =>
    vaultConfig.saveSettings({
      pluginStates: settingsStore.pluginStates,
      autoTimestamps: settingsStore.autoTimestamps,
      showOtherFiles: settingsStore.showOtherFiles,
    }),
  )
  // 主题 → theme.json（gate + 防抖，在 saveTheme 内）
  createEffect(() =>
    vaultConfig.saveTheme({
      theme: settingsStore.theme,
      customThemes: settingsStore.customThemes,
      customCSS: settingsStore.customCSS,
    }),
  )
})
```

hydrate 拆成两个入口：

- `hydrateSettings(payload: Partial<VaultSettings>)` — 与默认值合并写非主题字段（同现状，
  但只动这三字段）。
- `hydrateTheme(payload: Partial<ThemeSettings>)` — 写主题三字段，**随后同步**
  `applyTheme(resolveTheme(settingsStore.theme, settingsStore.customThemes))`（见 §4 对策）。

### 5.2 vaultConfig 改动

`src/vault/vaultConfig.ts`：

- 新增 `const THEME_FILE = 'theme.json'`。
- `parseSettings` 拆/复用：`parseVaultSettings`（非主题）与 `parseTheme`（主题）——均为
  「非数组对象即返回 `Partial`，否则 `null`」的宽松解析。
- `readConfigFiles()` 多读 `theme.json`，返回 `{ workspace, settings, theme }`。
- `createConfigFolder(ws, vaultSettings, theme)` 写三份文件
  （workspace.json / settings.json / theme.json）。
- `saveSettings(s: VaultSettings)` 写 settings.json（仅非主题字段）。
- 新增 `saveTheme(t: ThemeSettings)` 写 theme.json（防抖 + `isConfigActive` gate，
  与 saveSettings 同构，独立 timer）。
- `migratePath(newPath, ws, vaultSettings, theme)` 一并迁主题。
- `vault/index.ts` 的 `snapshotStores()` / `createConfigFolder` 调用相应改为传三段。

### 5.3 缺失/损坏 → 默认值（不迁移）

**不做任何迁移。** 各配置文件独立处理，格式不对就当它不存在、用默认值，并让后续落盘
重新生成一份干净的：

- `theme.json` 缺失/损坏（`readConfigFiles` 的 `theme === null`）→ `settingsStore` 主题三
  字段保持默认（`hydrateTheme` 不调用）。用户首次改主题或 `createConfigFolder` 时
  `saveTheme` 写出新 `theme.json`。
- `settings.json` 缺失/损坏（`settings === null`）→ 非主题三字段保持默认（`hydrateSettings`
  不调用）。
- `workspace.json` 同理（既有行为不变）。
- 老 vault 里 `settings.json` 残留的主题字段：被 `parseVaultSettings` 只取非主题三字段而
  忽略；下次 `saveSettings` 落盘自然清掉，无需专门处理。

## 6. 插件数据持久化（plugins/&lt;id&gt;/data.json）

把每个插件的配置从 localStorage `sn-plugin-<id>` 迁到 `.symbol-notes/plugins/<id>/data.json`，
未激活配置时仅内存（同 settings/workspace）。

### 6.1 核心难点：插件早于 vault 启动

`startPlugins()` 在 App 模块加载时跑（`registerPlugin`→`startPlugins`），**早于** vault 连接
（扫描+授权）。所以插件配置不能再在 `loadPlugin` 里同步读盘，只能像 settings 那样**异步
hydrate**：内存 store 初始为空（消费方 merge 各自 `defaults`），vault 连接后注入 data.json。

此外，配置 store 现在活在 `loadPlugin` 闭包里、随插件启停重建；改为**模块级、按 id 持有**，
启停不丢、hydrate/persist 都能稳定访问。

### 6.2 新模块 `src/lib/pluginData.ts`

按 id 持有响应式内存 store + 各自的落盘 effect：

- `getPluginConfig(id: string): Record<string, unknown>` — 返回该 id 的 store 快照
  （`{ ...store }`，在追踪作用域内响应式）。**不含 defaults**，消费方自行 merge。
- `setPluginConfig(id: string, patch: Record<string, unknown>): void` — 合并进 store。
- `hydratePluginData(id: string, data: Record<string, unknown>): void` — 覆盖式注入（data.json → store）。
- 内部：首次访问某 id 时 `createRoot` 内建 `createStore({})` + `createEffect(() =>
  vaultConfig.savePluginData(id, { ...config }))`（落盘 gate 在 `isConfigActive` + 防抖，
  见 §6.4）。模块加载时的初次 fire 因无 adapter 被 gate 掉，不会产生 hydrate 前的脏写
  （与 settingsStore 同理）。

### 6.3 消费方改造

- `pluginRegistry.loadPlugin`：删 `loadFromStorage`/`saveToStorage` 那段；`ctx.settings.getConfig
  (defaults)` 改为 `{ ...defaults, ...getPluginConfig(def.id) }`；`setConfig(patch)` 改为
  `setPluginConfig(def.id, patch)`。
- `daily-note/openDailyNote.ts`：`dailyConfig()` 的 `loadFromStorage('sn-plugin-daily-note')`
  改为 `getPluginConfig('daily-note')`。
- `excalidraw/ExcalidrawViewer.tsx`：`loadFromStorage('sn-plugin-excalidraw')` 改为
  `getPluginConfig('excalidraw')`。
- `excalidraw/index.tsx` 的 `updateExcalidrawPluginConfig(patch)`：改为
  `setPluginConfig('excalidraw', patch)`。
- `templates/store.ts`：删本地 signal + `sn-templates` localStorage；`templatesFolder()` 改为
  读 `getPluginConfig('templates').folder ?? 'templates'`，`setTemplatesFolder(folder)` 改为
  `setPluginConfig('templates', { folder })`。（插件 id 为 `templates`。）

> 这些直读消费方在 hydrate 前被调用会拿到默认值（与「配置尚未加载」一致），hydrate 后即正确；
> 均为低频、可接受。

### 6.4 vaultConfig 增量

- `const PLUGINS_DIR = 'plugins'`；`pluginDataPath(id) = joinConfigPath(base, 'plugins/<id>/data.json')`。
- `readPluginData(id): Promise<Record<string, unknown> | null>` — 读该文件，缺失/损坏 → `null`。
- `savePluginData(id, data)` — 先 `createDirectory('plugins/<id>')` 再写；**按 id 防抖**
  （`Map<string, timer>`）+ `isConfigActive` gate，与 `saveSettings` 同构。
- `createConfigFolder` 增参 `pluginData: Record<string, Record<string, unknown>>`：为每个
  非空配置写一份 data.json（启用配置文件夹时快照当前插件配置）。
- `migratePath` 经 `createConfigFolder` 一并迁插件数据（已有结构，传参补全即可）。

### 6.5 hydrate 接入

- `vault/index.ts` 的 `hydrateVaultConfig`：在 hydrate workspace/settings/theme 后，调
  `hydrateAllPluginData()` —— 对 `getRegisteredPlugins()` 每个插件**并行** `readPluginData(id)`，
  非 `null` 则 `hydratePluginData(id, data)`。即使插件此刻未启用也 hydrate（store 模块级持有）。
- `snapshotStores`/`createVaultConfigFromStores`（vault/index.ts）：用**动态 import**
  （避免 `vault ↔ pluginRegistry` 静态环）取 `getRegisteredPlugins` + `getPluginConfig`，
  拼出 `pluginData` map 传给 `createConfigFolder`。

## 7. 模块边界与依赖

- `src/lib/themeCache.ts`：依赖 `idb-keyval` + `solid-js`（信号）；暴露
  `MASK_VARS`/`snapshotMaskColors`/`getMaskColors`/`writeMaskColors`/`maskColors`/`setMaskColors`。
  不再依赖 `src/lib/theme.ts` 的 ThemeSpec。
- `src/components/LoadingOverlay.tsx`：依赖 `maskColors`。
- `src/index.tsx`：boot 读 `getMaskColors` → `setMaskColors` → render。
- `src/App.tsx`：主题 effect 应用 + `writeMaskColors(snapshotMaskColors())`；删闸门。
- `src/stores/settingsStore.ts`：两路持久化 + `hydrateSettings`/`hydrateTheme`；`hydrateTheme`
  内 `applyTheme`（import 自 `src/lib/theme`）。
- `src/lib/pluginData.ts` ★新：按 id 内存 store + 落盘 effect；暴露
  `getPluginConfig`/`setPluginConfig`/`hydratePluginData`。依赖 `solid-js` + `vaultConfig`。
- `src/lib/pluginRegistry.ts`：`loadPlugin` 配置改走 `pluginData`（删 localStorage 段）。
- `src/plugins/daily-note/openDailyNote.ts` / `excalidraw/ExcalidrawViewer.tsx` /
  `excalidraw/index.tsx` / `lib/templates/store.ts`：直读/直写改走 `pluginData`。
- `src/vault/vaultConfig.ts`：theme.json 读写 + `saveTheme`；plugins/<id>/data.json 读写
  + `savePluginData`；`createConfigFolder`/`migratePath` 补 pluginData。
- `src/vault/index.ts`：`hydrateVaultConfig` 读三份（缺失各自跳过）+ `hydrateAllPluginData`；
  删 `setThemeHydrated`（4 处）与其 import；`snapshotStores`/create 调用补主题 + 插件数据。
- `src/stores/types.ts`：加 `ThemeSettings` / `VaultSettings` 两个 Pick 别名。

## 8. 测试与验证

纯逻辑单测（node 环境，mock `idb-keyval`）：

- `themeCache`：`getMaskColors` 对合法/非法/缺失的返回；`writeMaskColors` 调 `set` 的键值。
  （`snapshotMaskColors` 依赖 DOM，不在 node 测试覆盖。）
- `vaultConfig`：`parseTheme`/`parseVaultSettings` 校验（合法对象返回、损坏返回 `null`）；
  `readConfigFiles` 三文件组合（含 theme.json 缺失/损坏 → `theme` 为 `null`）；`readPluginData`
  对缺失/损坏返回 `null`、`pluginDataPath` 拼接；`joinConfigPath` 既有测试不动。
- `pluginData`：`getPluginConfig`/`setPluginConfig`/`hydratePluginData` 的读写/覆盖语义
  （可 mock `vaultConfig.savePluginData` 验证落盘调用）。
- `settingsStore`：`hydrateSettings` 只动非主题字段、`hydrateTheme` 只动主题字段（mock
  `applyTheme` 或验证 store 结果）。

手动验证（`npm run dev`）：

1. 任意主题用户刷新：loading 遮罩首帧即正确颜色（无闪）；揭遮罩后内容主题正确、无跳变。
2. 切到 nord/浅色/自定义后刷新：遮罩颜色随之更新（验证 `writeMaskColors` 生效）。
3. `theme.json` 不存在/手动写坏：主题回落默认值，不报错；改一次主题后生成干净的 theme.json。
4. 新建配置文件夹：生成 workspace.json + settings.json（无主题字段）+ theme.json
   + 各插件 plugins/<id>/data.json（当前非空配置）。
5. 改主题 → `theme.json` 落盘；改插件开关/显示设置 → `settings.json` 落盘；两者互不串写。
6. 改 daily-note 文件夹 / excalidraw 网格 / templates 模板夹 → 对应 plugins/<id>/data.json
   落盘；刷新后值保留、相关功能（开日记/画板默认/模板列表）读到正确配置。

提交前：`npm run build`（含 `tsc`）与 `npx vitest run` 均通过。
