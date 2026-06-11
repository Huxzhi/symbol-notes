# 主题颜色拓展 — 设计文档

日期：2026-06-11

## 目标

在现有主题系统基础上，提供：

1. 更多**预设主题**，按浅色 / 深色两组组织展示。
2. 用户可对**全部主题 CSS 颜色变量**进行调整。
3. 调色联动 CodeMirror 6（加粗色、标题色、高亮背景等语法着色）。
4. 调色时**实时预览**，「取消」回滚、「应用」提交持久化。
5. 调色行为以当前主题为基础**生成一个具名的自定义主题**；预设主题保持不可变。

## 现状

- 主题由 `<html>` 上的 `data-theme` 属性驱动（`App.tsx` 的 `createEffect` 设置）。
- 预设主题 `dark` / `light` / `nord` 定义在 `src/index.css` 的 `:root[data-theme="..."]` 块中。
- CM6 主题 `src/lib/cm6/cmTheme.ts` 全程使用 `var(--...)`，无硬编码 hex，会自动跟随 CSS 变量变化。
- 设置面板 `src/components/Settings.tsx`「外观」页有主题色卡选择器 + 原始自定义 CSS 文本框；状态在 `src/stores/settingsStore.ts`（`theme`、`customCSS` 等），整体序列化持久化到 localStorage 键 `sn-settings`。

### 现存缺陷（本次一并修复）

- `--cm-*` 系列变量（`--cm-h1`..`--cm-h4`、`--cm-strong` 加粗、`--cm-em`、`--cm-code`、`--cm-quote`、`--cm-list`、`--cm-meta`）**只在 dark 块定义**，且落在裸 `:root` 选择器上。light / nord 块未覆盖它们，导致这两个主题下编辑器标题、加粗等仍沿用深色主题的颜色。

## 技术方案

### 自定义主题如何生效：内联变量注入（方案 A）

- 预设主题继续完全由 `index.css` 的 `data-theme` 块提供，不可变。
- 自定义主题保存为一份**完整的变量快照** `vars: Record<varName, value>`。
- 应用自定义主题时：
  1. 设 `data-theme` 为该自定义主题的 `mode`（`'light'` 或 `'dark'`），让 CM6 的 `{dark}` 语义与任何未覆盖项有合理回退基底；
  2. 用 `documentElement.style.setProperty('--x', v)` 逐项注入快照中的变量值，覆盖基底。
- 应用预设主题时：设 `data-theme=presetId`，并清除所有内联变量覆盖。

理由：实时预览只需 `setProperty`，回滚只需用已保存状态重新调用 `applyTheme`；无需拼接 / 解析样式表；自包含的全量快照便于未来导入导出。

被否决的方案 B（动态注入 `<style>` 生成 `:root[data-theme="custom-id"]{...}`）需要拼字符串与解析，预览路径更绕，暂不采用。

## 模块设计

### 新增 `src/lib/theme.ts` — 主题单一事实源

集中存放，避免散落在组件内：

- **`THEME_VARS`** — 所有可编辑变量的元数据数组，每项 `{ name: string; label: string; group: string }`，分组如下：
  - 背景：`--bg-base` `--bg-surface` `--bg-elevated` `--bg-hover` `--bg-active` `--bg-active2`
  - 边框：`--border` `--border-2`
  - 文字：`--text` `--text-2` `--text-3` `--text-4`
  - 强调：`--accent` `--accent-2` `--caret`
  - 链接与标签：`--link` `--link-2` `--tag`
  - 编辑器语法：`--cm-h1` `--cm-h2` `--cm-h3` `--cm-h4` `--cm-strong`(加粗) `--cm-em` `--cm-strike` `--cm-code` `--cm-quote` `--cm-list` `--cm-meta`

  注：`--accent-bg` 不在可编辑列表中（见 index.css 简化）。

- **`PRESET_THEMES`** — `{ id: string; label: string; sub: string; mode: 'light' | 'dark'; swatch: string[] }[]`，从 `Settings.tsx` 现有的 `THEMES` 常量迁移过来，并补 `mode` 字段。
- **`snapshotTheme(): Record<string, string>`** — 用 `getComputedStyle(documentElement).getPropertyValue(name).trim()` 读出 `THEME_VARS` 中每个变量**当前实际生效**的值（无论当前是预设还是带内联覆盖的自定义主题），作为新建自定义主题的起点。即「以我现在看到的样子为基础新建」，无需临时切换 `data-theme`。
- **`applyTheme(spec)`** — 唯一的「把主题打到 DOM」函数。入参区分预设 id 与自定义主题对象：
  - 预设：`setAttribute('data-theme', id)`，并对 `THEME_VARS` 中每项 `style.removeProperty(name)`。
  - 自定义：`setAttribute('data-theme', mode)`，并对 `vars` 中每项 `style.setProperty(name, value)`。
- **`resolveTheme(id, customThemes)`** — 由 `theme` id 解析出 `applyTheme` 所需的 spec（在 `PRESET_THEMES` 与 `customThemes` 中查找；找不到则回退到默认预设 `dark`）。
- **类型** `CustomTheme { id: string; name: string; base: string; mode: 'light' | 'dark'; vars: Record<string, string> }`。

### `src/index.css` 修改

1. **补全 light / nord 的 `--cm-*` 变量**：为 `:root[data-theme="light"]` 和 `:root[data-theme="nord"]` 块各自定义协调的 `--cm-h1`..`--cm-h4` / `--cm-strong` / `--cm-em` / `--cm-strike` / `--cm-code` / `--cm-quote` / `--cm-list` / `--cm-meta`。
2. **简化 `--accent-bg`**：在三个预设块中统一改为 `--accent-bg: color-mix(in srgb, var(--accent) 13%, transparent);` 使其自动跟随 `--accent`，不再作为可编辑项暴露。

### `src/stores/settingsStore.ts` 与 `types.ts`

- `SettingsState.theme` 类型由 `ThemeId` 改为 `string`（预设或自定义 id 皆可）。保留 `ThemeId` 作为预设 id 的联合类型供别处引用。旧持久化值 `'dark'/'light'/'nord'` 天然兼容，无需迁移代码。
- 新增 `SettingsState.customThemes: CustomTheme[]`，默认 `[]`。
- 新增 actions：
  - `addCustomTheme(): string` — 以**当前生效主题**为基础：`snapshotTheme()` 取全量变量，`base` 记为当前主题 id、`mode` 取自当前主题的 mode，生成新 `CustomTheme`（默认名如「自定义 N」），追加到 `customThemes`，返回新 id。
  - `updateCustomThemeVar(id: string, name: string, value: string): void`
  - `renameCustomTheme(id: string, name: string): void`
  - `deleteCustomTheme(id: string): void` — 若删除的是当前 `theme`，回退到其 `base` 或 `'dark'`。
  - `setTheme(id: string): void`（沿用现有，放宽类型）。

### `src/App.tsx`

主题 `createEffect` 改为：
```
createEffect(() => {
  applyTheme(resolveTheme(settingsStore.theme, settingsStore.customThemes))
})
```
自定义 CSS 文本框注入逻辑保持不变。

### `src/components/Settings.tsx`「外观」页

- **主题选择区**：按 `mode` 分「浅色 / 深色」两组，列出预设 + 自定义主题，沿用现有色卡（swatch）样式。自定义主题项额外提供重命名（行内输入）与删除。
- **「+ 新建自定义主题」按钮**：`addCustomTheme()`（以当前生效主题为基础）→ 切换选中到新主题并进入编辑态。
- **颜色编辑器**（仅当选中的是自定义主题时展开）：按 `THEME_VARS` 的 `group` 分组渲染；每个变量一行：标签 + `<input type="color">` + hex 文本框（两者双向同步）。编辑时即时调用 `updateCustomThemeVar` 对应的预览写入（`setProperty`）做实时预览。
- 预设主题被选中时不显示编辑器（不可变；要改即新建）。
- **底部 应用 / 取消**：
  - 打开设置时快照当前已提交的主题状态。
  - 编辑实时写 DOM 预览（内联变量）。
  - 「取消」：丢弃草稿，`applyTheme` 重新应用已提交状态（清除预览）。
  - 「应用」：将草稿写入 `settingsStore`（持久化）。
- 保留底部原始自定义 CSS 文本框作为高级出口。

## 预览 / 提交交互细节

- `applyTheme` 是预览与提交共用的同一函数；预览路径直接对 DOM `setProperty`，提交路径写 store（store 的 `createEffect` 再驱动 `applyTheme`）。
- 「取消」必须显式 `applyTheme(已提交状态)` 来清除内联预览覆盖，因为内联样式不随 store 自动回滚。

## 数据流

```
用户调色
  → updateCustomThemeVar 草稿（实时 setProperty 预览）
  → 应用：写 settingsStore.customThemes / theme
            → localStorage(sn-settings)
            → App createEffect → applyTheme（提交态）
  → 取消：applyTheme（已保存提交态），丢弃草稿
```

## 模块边界

- `lib/theme.ts`：主题元数据 + 解析 + 应用，无 UI 依赖。
- `settingsStore.ts`：状态与持久化，依赖 `lib/theme.ts` 的类型与 `snapshotTheme`。
- `Settings.tsx`：消费 `lib/theme.ts` 的元数据渲染 UI，调用 store actions。
- `index.css`：预设主题 CSS 真值。
- `App.tsx`：把 store 主题状态接到 `applyTheme`。

## 测试

- 切换预设主题：`data-theme` 正确、内联覆盖被清除、CM6 各预设标题/加粗/高亮颜色正确（验证 light/nord 的 `--cm-*` 修复）。
- 新建自定义主题：以当前主题为基础快照出全量变量，出现在对应 浅/深 组。
- 调色实时预览：拖动取色器，编辑器与 UI 即时变色。
- 应用后刷新页面：自定义主题与选中态从 localStorage 恢复。
- 取消：预览回滚到已提交状态，草稿被丢弃。
- 删除当前选中的自定义主题：回退到其基础主题。

## 不做（YAGNI）

- 自定义主题导入 / 导出（快照结构已为此预留，但本次不实现）。
- 字体 / 间距等非颜色的主题项。
- `--accent-bg` 的独立编辑（改为派生）。
