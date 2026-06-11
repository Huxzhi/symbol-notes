# 主题颜色拓展 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在多套按明暗分组的预设主题之上，复制出可逐项调整全部颜色变量（含 CM6 语法着色）的具名自定义主题，调色实时预览、可取消回滚。

**Architecture:** 预设主题继续由 `index.css` 的 `data-theme` 块提供且不可变；自定义主题以一份完整 CSS 变量快照保存在 `settingsStore`，通过一个统一的 `applyTheme()` 函数用内联 `style.setProperty` 注入到 `:root`。App 的主题 `createEffect` 是唯一的提交态应用路径，调色直接写 store 即可借它实现实时预览。

**Tech Stack:** SolidJS（`createStore`/`createEffect`）、CodeMirror 6（`var(--...)` 着色）、Tailwind 4、Vitest（node env）。

测试约定：本仓库测试运行在 node 环境（`vite.config.ts` 的 `test.environment: 'node'`），只对纯逻辑/store 做单元测试，不测 DOM/CM6 渲染。故 `applyTheme`/`snapshotTheme`（操作 `document`）与 Settings UI 用 `tsc --noEmit` + 手动验证，不写单测——与现有约定一致。

参考 spec：`docs/superpowers/specs/2026-06-11-theme-color-customization-design.md`

## 文件结构

- **Create** `src/lib/theme.ts` — 主题单一事实源：类型、`THEME_VARS`、`PRESET_THEMES`、`resolveTheme`（纯）、`applyTheme`/`snapshotTheme`（DOM）。
- **Create** `src/lib/__tests__/theme.test.ts` — `resolveTheme` 与 `THEME_VARS` 完整性测试。
- **Modify** `src/index.css` — 为 light/nord 补全 `--cm-*`；三个预设的 `--accent-bg` 改为派生。
- **Modify** `src/stores/types.ts` — `SettingsState.theme: string`、新增 `customThemes`。
- **Modify** `src/stores/settingsStore.ts` — `customThemes` 默认值 + 4 个自定义主题 action + `setCustomThemes`。
- **Create** `src/stores/__tests__/settingsStore.test.ts` — 自定义主题 action 测试。
- **Modify** `src/App.tsx` — 主题 effect 改用 `applyTheme(resolveTheme(...))`。
- **Modify** `src/components/Settings.tsx` — 外观页：分组主题选择器 + 新建/重命名/删除 + 颜色编辑器 + 取消回滚。

---

## Task 1: `theme.ts` 纯逻辑（类型、元数据、resolveTheme）

**Files:**
- Create: `src/lib/theme.ts`
- Test: `src/lib/__tests__/theme.test.ts`

- [ ] **Step 1: 写失败测试**

`src/lib/__tests__/theme.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { resolveTheme, THEME_VARS, PRESET_THEMES, type CustomTheme } from '../theme'

const custom: CustomTheme = {
  id: 'custom-1', name: '我的', base: 'dark', mode: 'dark',
  vars: { '--accent': '#ff0000' },
}

describe('resolveTheme', () => {
  it('preset id 解析为 preset spec', () => {
    expect(resolveTheme('nord', [])).toEqual({ kind: 'preset', id: 'nord' })
  })
  it('custom id 解析为 custom spec（带 mode 与 vars）', () => {
    expect(resolveTheme('custom-1', [custom])).toEqual({
      kind: 'custom', mode: 'dark', vars: { '--accent': '#ff0000' },
    })
  })
  it('未知 id 回退到 dark 预设', () => {
    expect(resolveTheme('nope', [])).toEqual({ kind: 'preset', id: 'dark' })
  })
})

describe('THEME_VARS / PRESET_THEMES', () => {
  it('变量名唯一且都以 -- 开头', () => {
    const names = THEME_VARS.map((v) => v.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names.every((n) => n.startsWith('--'))).toBe(true)
  })
  it('不包含派生变量 --accent-bg', () => {
    expect(THEME_VARS.some((v) => v.name === '--accent-bg')).toBe(false)
  })
  it('每个预设都有 mode', () => {
    expect(PRESET_THEMES.every((t) => t.mode === 'light' || t.mode === 'dark')).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/__tests__/theme.test.ts`
Expected: FAIL — 找不到模块 `../theme`。

- [ ] **Step 3: 实现 `src/lib/theme.ts`（仅纯逻辑部分）**

```ts
export type ThemeMode = 'light' | 'dark'

export interface ThemeVarMeta {
  name: string // CSS 变量名，含前导 --
  label: string
  group: string
}

export interface PresetTheme {
  id: string
  label: string
  sub: string
  mode: ThemeMode
  swatch: string[]
}

export interface CustomTheme {
  id: string
  name: string
  base: string // 派生自的主题 id
  mode: ThemeMode
  vars: Record<string, string>
}

export type ThemeSpec =
  | { kind: 'preset'; id: string }
  | { kind: 'custom'; mode: ThemeMode; vars: Record<string, string> }

export const THEME_VARS: ThemeVarMeta[] = [
  { name: '--bg-base', label: '基础背景', group: '背景' },
  { name: '--bg-surface', label: '面板背景', group: '背景' },
  { name: '--bg-elevated', label: '浮层背景', group: '背景' },
  { name: '--bg-hover', label: '悬停背景', group: '背景' },
  { name: '--bg-active', label: '选中背景', group: '背景' },
  { name: '--bg-active2', label: '选中背景(强)', group: '背景' },

  { name: '--border', label: '边框', group: '边框' },
  { name: '--border-2', label: '边框(强)', group: '边框' },

  { name: '--text', label: '主文字', group: '文字' },
  { name: '--text-2', label: '次文字', group: '文字' },
  { name: '--text-3', label: '弱文字', group: '文字' },
  { name: '--text-4', label: '极弱文字', group: '文字' },

  { name: '--accent', label: '强调色', group: '强调' },
  { name: '--accent-2', label: '强调色(亮)', group: '强调' },
  { name: '--caret', label: '光标', group: '强调' },

  { name: '--link', label: '链接', group: '链接与标签' },
  { name: '--link-2', label: '链接(次)', group: '链接与标签' },
  { name: '--tag', label: '标签', group: '链接与标签' },

  { name: '--cm-h1', label: '标题 1', group: '编辑器语法' },
  { name: '--cm-h2', label: '标题 2', group: '编辑器语法' },
  { name: '--cm-h3', label: '标题 3', group: '编辑器语法' },
  { name: '--cm-h4', label: '标题 4-6', group: '编辑器语法' },
  { name: '--cm-strong', label: '加粗', group: '编辑器语法' },
  { name: '--cm-em', label: '斜体', group: '编辑器语法' },
  { name: '--cm-strike', label: '删除线', group: '编辑器语法' },
  { name: '--cm-code', label: '行内代码', group: '编辑器语法' },
  { name: '--cm-quote', label: '引用', group: '编辑器语法' },
  { name: '--cm-list', label: '列表标记', group: '编辑器语法' },
  { name: '--cm-meta', label: '元信息', group: '编辑器语法' },
]

export const PRESET_THEMES: PresetTheme[] = [
  { id: 'dark', label: '深空', sub: 'Dark', mode: 'dark', swatch: ['#0f0f1c', '#6c63ff', '#7ec8e3', '#cccccc'] },
  { id: 'light', label: '晴日', sub: 'Light', mode: 'light', swatch: ['#f8f8fc', '#5a52e8', '#2980b9', '#2a2a3c'] },
  { id: 'nord', label: '极光', sub: 'Nord', mode: 'dark', swatch: ['#2e3440', '#88c0d0', '#81a1c1', '#eceff4'] },
]

export function resolveTheme(themeId: string, customThemes: CustomTheme[]): ThemeSpec {
  const custom = customThemes.find((t) => t.id === themeId)
  if (custom) return { kind: 'custom', mode: custom.mode, vars: custom.vars }
  const preset = PRESET_THEMES.find((t) => t.id === themeId)
  if (preset) return { kind: 'preset', id: preset.id }
  return { kind: 'preset', id: 'dark' }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/lib/__tests__/theme.test.ts`
Expected: PASS（6 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/theme.ts src/lib/__tests__/theme.test.ts
git commit -m "feat(theme): theme metadata + resolveTheme"
```

---

## Task 2: `theme.ts` DOM 函数（applyTheme / snapshotTheme）

**Files:**
- Modify: `src/lib/theme.ts`（追加两个函数）

- [ ] **Step 1: 追加实现**

在 `src/lib/theme.ts` 末尾追加：

```ts
/** 把主题应用到 <html>：预设清除内联覆盖；自定义则逐项 setProperty。 */
export function applyTheme(spec: ThemeSpec): void {
  const el = document.documentElement
  if (spec.kind === 'preset') {
    el.setAttribute('data-theme', spec.id)
    for (const v of THEME_VARS) el.style.removeProperty(v.name)
    return
  }
  el.setAttribute('data-theme', spec.mode)
  for (const v of THEME_VARS) {
    const val = spec.vars[v.name]
    if (val) el.style.setProperty(v.name, val)
    else el.style.removeProperty(v.name)
  }
}

/** 读取 <html> 上当前实际生效的全部主题变量值（含内联覆盖），作为新建自定义主题的起点。 */
export function snapshotTheme(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement)
  const out: Record<string, string> = {}
  for (const v of THEME_VARS) out[v.name] = cs.getPropertyValue(v.name).trim()
  return out
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 通过，无错误。

- [ ] **Step 3: 提交**

```bash
git add src/lib/theme.ts
git commit -m "feat(theme): applyTheme + snapshotTheme DOM helpers"
```

---

## Task 3: `index.css` — 补全 light/nord 的 `--cm-*`，派生 `--accent-bg`

**Files:**
- Modify: `src/index.css`（dark 块 18-47、light 块 50-76、nord 块 79-105）

- [ ] **Step 1: 改 dark 块的 `--accent-bg` 为派生**

把 `src/index.css` 中 dark 块内：

```css
  --accent-bg:   rgba(108,99,255,.13);
```

改为：

```css
  --accent-bg:   color-mix(in srgb, var(--accent) 13%, transparent);
```

- [ ] **Step 2: 改 light 块的 `--accent-bg` 为派生，并补全 `--cm-*`**

把 light 块内：

```css
  --accent-bg:   rgba(90,82,232,.1);
```

改为：

```css
  --accent-bg:   color-mix(in srgb, var(--accent) 13%, transparent);
```

并在 light 块 `--caret: #5a52e8;` 之后、块结束的 `}` 之前，加入：

```css
  --cm-h1: #5a52e8; --cm-h2: #7a72f0; --cm-h3: #8a83e0;
  --cm-h4: #a7a1e8; --cm-strong: #1a1a28; --cm-em: #2980b9;
  --cm-strike: #9898b0; --cm-code: #7a52a8; --cm-quote: #6a6a80;
  --cm-list: #5a52e8; --cm-meta: #9898b0;
```

- [ ] **Step 3: 改 nord 块的 `--accent-bg` 为派生，并补全 `--cm-*`**

把 nord 块内：

```css
  --accent-bg:   rgba(136,192,208,.15);
```

改为：

```css
  --accent-bg:   color-mix(in srgb, var(--accent) 15%, transparent);
```

并在 nord 块 `--caret: #88c0d0;` 之后、块结束的 `}` 之前，加入：

```css
  --cm-h1: #88c0d0; --cm-h2: #8fbcbb; --cm-h3: #81a1c1;
  --cm-h4: #5e81ac; --cm-strong: #eceff4; --cm-em: #81a1c1;
  --cm-strike: #7b8494; --cm-code: #b48ead; --cm-quote: #aeb3be;
  --cm-list: #88c0d0; --cm-meta: #7b8494;
```

- [ ] **Step 4: 构建验证 CSS 合法**

Run: `npx vite build`
Expected: 构建成功，无 CSS 解析错误。

- [ ] **Step 5: 提交**

```bash
git add src/index.css
git commit -m "fix(theme): per-theme --cm-* for light/nord; derive --accent-bg"
```

---

## Task 4: `types.ts` + `settingsStore.ts` — customThemes 状态与 actions

**Files:**
- Modify: `src/stores/types.ts:57`（`ThemeId`）与 `:109-115`（`SettingsState`）
- Modify: `src/stores/settingsStore.ts`
- Test: `src/stores/__tests__/settingsStore.test.ts`

- [ ] **Step 1: 写失败测试**

`src/stores/__tests__/settingsStore.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { settingsStore, settingsActions } from '../settingsStore'

beforeEach(() => {
  settingsActions.setCustomThemes([])
  settingsActions.setTheme('dark')
})

describe('settingsStore custom themes', () => {
  it('addCustomTheme 追加一个主题并返回其 id', () => {
    const id = settingsActions.addCustomTheme('nord', 'dark', { '--accent': '#abc' })
    expect(typeof id).toBe('string')
    const t = settingsStore.customThemes.find((x) => x.id === id)
    expect(t).toBeTruthy()
    expect(t!.base).toBe('nord')
    expect(t!.mode).toBe('dark')
    expect(t!.vars['--accent']).toBe('#abc')
  })

  it('updateCustomThemeVar 改写单个变量', () => {
    const id = settingsActions.addCustomTheme('dark', 'dark', { '--accent': '#000' })
    settingsActions.updateCustomThemeVar(id, '--accent', '#fff')
    expect(settingsStore.customThemes.find((x) => x.id === id)!.vars['--accent']).toBe('#fff')
  })

  it('renameCustomTheme 改名', () => {
    const id = settingsActions.addCustomTheme('dark', 'dark', {})
    settingsActions.renameCustomTheme(id, '夜航')
    expect(settingsStore.customThemes.find((x) => x.id === id)!.name).toBe('夜航')
  })

  it('deleteCustomTheme 删除；若删的是当前主题则回退到其 base', () => {
    const id = settingsActions.addCustomTheme('nord', 'dark', {})
    settingsActions.setTheme(id)
    settingsActions.deleteCustomTheme(id)
    expect(settingsStore.customThemes.find((x) => x.id === id)).toBeUndefined()
    expect(settingsStore.theme).toBe('nord')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/stores/__tests__/settingsStore.test.ts`
Expected: FAIL — `settingsActions.setCustomThemes`/`addCustomTheme` 不存在。

- [ ] **Step 3: 改 `types.ts`**

把 `src/stores/types.ts:57`：

```ts
export type ThemeId = 'dark' | 'light' | 'nord'
```

改为（保留 `ThemeId` 表示内置预设 id，新增 `CustomTheme` 引用）：

```ts
export type ThemeId = 'dark' | 'light' | 'nord'

import type { CustomTheme } from '../lib/theme'
export type { CustomTheme }
```

并把 `SettingsState`（约 109-115 行）改为：

```ts
export interface SettingsState {
  theme: string                 // 预设或自定义主题 id
  customThemes: CustomTheme[]
  customCSS: string
  autoTimestamps: boolean
  showOtherFiles: boolean
  pluginStates: Record<string, boolean>
}
```

> 注：`import type` 放在文件顶部更整洁；若 linter 反对块中 import，请把 `import type { CustomTheme } from '../lib/theme'` 移到 `types.ts` 顶部其它 import 旁，仅保留此处的 `export type { CustomTheme }` 或直接在顶部 import 后于 `SettingsState` 使用。

- [ ] **Step 4: 改 `settingsStore.ts`**

把 `defaults`（6-12 行）改为含 `customThemes`：

```ts
const defaults: SettingsState = {
  theme: 'dark',
  customThemes: [],
  customCSS: '',
  autoTimestamps: true,
  showOtherFiles: true,
  pluginStates: {},
}
```

把顶部类型 import 与 `setTheme` 签名放宽，并在 `settingsActions` 对象中加入新 action。完整的 `settingsActions`：

```ts
import type { SettingsState, CustomTheme, ThemeMode } from './types'
// 注意：ThemeMode 来自 lib/theme；如 types 未 re-export，请改为
//   import type { CustomTheme, ThemeMode } from '../lib/theme'
//   import type { SettingsState } from './types'

export const settingsActions = {
  setTheme(theme: string): void {
    setSettingsStore('theme', theme)
  },
  setCustomThemes(themes: CustomTheme[]): void {
    setSettingsStore('customThemes', themes)
  },
  addCustomTheme(base: string, mode: ThemeMode, vars: Record<string, string>): string {
    const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const n = settingsStore.customThemes.length + 1
    const theme: CustomTheme = { id, name: `自定义 ${n}`, base, mode, vars }
    setSettingsStore('customThemes', (list) => [...list, theme])
    return id
  },
  updateCustomThemeVar(id: string, name: string, value: string): void {
    setSettingsStore('customThemes', (t) => t.id === id, 'vars', name, value)
  },
  renameCustomTheme(id: string, name: string): void {
    setSettingsStore('customThemes', (t) => t.id === id, 'name', name)
  },
  deleteCustomTheme(id: string): void {
    const t = settingsStore.customThemes.find((x) => x.id === id)
    setSettingsStore('customThemes', (list) => list.filter((x) => x.id !== id))
    if (settingsStore.theme === id) setSettingsStore('theme', t?.base ?? 'dark')
  },
  setCustomCSS(css: string): void {
    setSettingsStore('customCSS', css)
  },
  setAutoTimestamps(value: boolean): void {
    setSettingsStore('autoTimestamps', value)
  },
  setShowOtherFiles(value: boolean): void {
    setSettingsStore('showOtherFiles', value)
  },
  setPluginState(id: string, enabled: boolean): void {
    setSettingsStore('pluginStates', id, enabled)
  },
}
```

> `ThemeMode` 需要从 `lib/theme` 取得。最稳妥：在 `types.ts` 中也 `export type { ThemeMode }`（与 `CustomTheme` 一起从 `../lib/theme` re-export），或在 `settingsStore.ts` 直接从 `../lib/theme` import。二选一，保持单一来源。

把文件第 1 行附近原 `import type { SettingsState, ThemeId } from './types'` 与底部 `export type { ThemeId }` 保留即可（`ThemeId` 仍存在）。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run src/stores/__tests__/settingsStore.test.ts`
Expected: PASS（4 个用例）。

- [ ] **Step 6: 类型检查**

Run: `npx tsc --noEmit`
Expected: 通过。

- [ ] **Step 7: 提交**

```bash
git add src/stores/types.ts src/stores/settingsStore.ts src/stores/__tests__/settingsStore.test.ts
git commit -m "feat(settings): customThemes state + actions"
```

---

## Task 5: `App.tsx` — 主题 effect 接入 applyTheme

**Files:**
- Modify: `src/App.tsx:33`（import）与 `:69-71`（effect）

- [ ] **Step 1: 加 import**

在 `src/App.tsx` 现有 import 区（`settingsStore` import 旁）加入：

```ts
import { applyTheme, resolveTheme } from './lib/theme'
```

- [ ] **Step 2: 改主题 effect**

把 `src/App.tsx:69-71`：

```ts
  createEffect(() => {
    document.documentElement.setAttribute('data-theme', settingsStore.theme)
  })
```

改为：

```ts
  createEffect(() => {
    applyTheme(resolveTheme(settingsStore.theme, settingsStore.customThemes))
  })
```

> 该 effect 在执行时会读取 `resolveTheme` 返回 spec 的 `vars[name]`（对自定义主题），从而订阅每个变量——调色直接写 store 即可借此实时预览。

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 通过。

- [ ] **Step 4: 提交**

```bash
git add src/App.tsx
git commit -m "feat(theme): drive themes through applyTheme/resolveTheme"
```

---

## Task 6: `Settings.tsx` — 外观页重做（分组选择器 + 颜色编辑器 + 取消回滚）

**Files:**
- Modify: `src/components/Settings.tsx`

- [ ] **Step 1: 替换顶部 import 与本地常量**

把文件顶部 import（1-6 行）改为：

```tsx
import { createSignal, For, Match, Show, Switch } from "solid-js";
import { Dynamic } from "solid-js/web";
import { settingsActions, settingsStore } from "../stores/settingsStore";
import { getRegisteredPlugins } from "../lib/pluginRegistry";
import { getSettingsTabs } from "../lib/pluginRegistry";
import {
  PRESET_THEMES,
  THEME_VARS,
  snapshotTheme,
  type ThemeMode,
} from "../lib/theme";
```

删除文件内原 `const THEMES = [...]`（15-35 行）——改用 `PRESET_THEMES`。`SHORTCUTS`、`Toggle` 保留不动。

- [ ] **Step 2: 重做组件内主题相关状态与辅助**

在 `Settings` 组件内，把 `draftTheme` 相关删除，替换为：进入时快照已提交主题态（用于取消回滚），其余颜色操作直接写 store（实时预览靠 App 的 effect）。

把组件开头（约 62-82 行的 signal 声明与 `apply`）改为：

```tsx
  const [section, setSection] = createSignal("appearance");
  const [draftCSS, setDraftCSS] = createSignal(settingsStore.customCSS);
  const [draftAutoTs, setDraftAutoTs] = createSignal(settingsStore.autoTimestamps);
  const [draftShowOtherFiles, setDraftShowOtherFiles] = createSignal(settingsStore.showOtherFiles);

  // 取消回滚：进入设置时快照已提交的主题态
  const themeSnapshot = {
    theme: settingsStore.theme,
    customThemes: JSON.parse(JSON.stringify(settingsStore.customThemes)),
  };

  const presetById = (id: string) => PRESET_THEMES.find((p) => p.id === id);
  const customById = (id: string) => settingsStore.customThemes.find((c) => c.id === id);
  const selected = () => settingsStore.theme;
  const selectedCustom = () => customById(selected());

  const currentMode = (): ThemeMode => {
    const c = customById(selected());
    if (c) return c.mode;
    return presetById(selected())?.mode ?? "dark";
  };

  // 统一的卡片数据：预设用静态 swatch；自定义从 vars 推导
  type Card = { id: string; label: string; sub: string; swatch: string[] };
  const customSwatch = (vars: Record<string, string>) =>
    ["--bg-base", "--accent", "--link", "--text"].map((n) => vars[n] ?? "#888");
  const cardsFor = (mode: ThemeMode): Card[] => [
    ...PRESET_THEMES.filter((p) => p.mode === mode).map((p) => ({
      id: p.id, label: p.label, sub: p.sub, swatch: p.swatch,
    })),
    ...settingsStore.customThemes.filter((c) => c.mode === mode).map((c) => ({
      id: c.id, label: c.name, sub: "自定义", swatch: customSwatch(c.vars),
    })),
  ];

  const newCustomTheme = () => {
    const id = settingsActions.addCustomTheme(selected(), currentMode(), snapshotTheme());
    settingsActions.setTheme(id);
  };

  const close = props.onClose;

  // 应用：提交非主题草稿后关闭（主题已实时写入并持久化）
  const apply = () => {
    settingsActions.setCustomCSS(draftCSS());
    settingsActions.setAutoTimestamps(draftAutoTs());
    settingsActions.setShowOtherFiles(draftShowOtherFiles());
    close();
  };

  // 取消：把主题态回滚到进入时的快照后关闭
  const cancel = () => {
    settingsActions.setCustomThemes(themeSnapshot.customThemes);
    settingsActions.setTheme(themeSnapshot.theme);
    close();
  };
```

- [ ] **Step 3: 外层关闭入口改用 cancel**

把根容器 backdrop 点击（约 90-92 行）与 Header 的 ✕ 按钮（约 98-103 行）、底部「取消」按钮（约 354-359 行）中调用的 `close` 改为 `cancel`：

- backdrop：`if (e.target === e.currentTarget) cancel();`
- ✕ 按钮：`onClick={cancel}`
- 「取消」按钮：`onClick={cancel}`

「应用」按钮仍 `onClick={apply}`。

> 设计意图：主题预览是实时写 store 的，取消必须显式回滚 store，App 的 effect 才会把 DOM 复原。

- [ ] **Step 4: 重写「外观」Match 块**

把 `<Match when={section() === "appearance"}>...</Match>`（约 141-182 行）整体替换为：

```tsx
              <Match when={section() === "appearance"}>
                <For each={["light", "dark"] as ThemeMode[]}>
                  {(mode) => (
                    <>
                      <div class="text-[10px] t-3 mb-2.5 uppercase tracking-widest">
                        {mode === "light" ? "浅色" : "深色"}
                      </div>
                      <div class="flex flex-wrap gap-2 mb-4">
                        <For each={cardsFor(mode)}>
                          {(t) => (
                            <button
                              class={`w-[104px] rounded-lg border-2 p-3 cursor-pointer transition-colors text-center ${selected() === t.id ? "border-(--accent) bg-(--accent-bg)" : "border-(--border) hover:border-(--border-2)"}`}
                              onClick={() => settingsActions.setTheme(t.id)}
                            >
                              <div class="flex gap-1 mb-2 justify-center">
                                <For each={t.swatch}>
                                  {(c) => (
                                    <div
                                      class="w-4 h-4 rounded-full border border-white/10"
                                      style={{ background: c }}
                                    />
                                  )}
                                </For>
                              </div>
                              <div class={`text-[12px] font-medium truncate ${selected() === t.id ? "text-(--accent)" : "t-base"}`}>
                                {t.label}
                              </div>
                              <div class="text-[10px] t-3">{t.sub}</div>
                            </button>
                          )}
                        </For>
                        <Show when={mode === currentMode()}>
                          <button
                            class="w-[104px] rounded-lg border-2 border-dashed border-(--border-2) p-3 cursor-pointer text-(--text-3) hover:border-(--accent) hover:text-(--accent) transition-colors text-[12px]"
                            onClick={newCustomTheme}
                          >
                            + 新建自定义
                          </button>
                        </Show>
                      </div>
                    </>
                  )}
                </For>

                {/* 颜色编辑器：仅自定义主题可编辑 */}
                <Show when={selectedCustom()}>
                  {(theme) => (
                    <div class="mt-1 mb-5">
                      <div class="flex items-center gap-2 mb-3">
                        <input
                          class="flex-1 bg-(--bg-base) border border-(--border) rounded px-2 py-1 text-[12px] t-base outline-none focus:border-(--accent)"
                          value={theme().name}
                          onInput={(e) => settingsActions.renameCustomTheme(theme().id, e.currentTarget.value)}
                        />
                        <button
                          class="px-2.5 py-1 text-[11px] rounded border border-(--border) text-(--text-3) hover:text-(--accent) hover:border-(--accent) transition-colors cursor-pointer"
                          onClick={() => settingsActions.deleteCustomTheme(theme().id)}
                        >
                          删除
                        </button>
                      </div>
                      <For each={[...new Set(THEME_VARS.map((v) => v.group))]}>
                        {(group) => (
                          <div class="mb-3">
                            <div class="text-[10px] t-3 mb-1.5 uppercase tracking-widest">{group}</div>
                            <div class="grid grid-cols-2 gap-x-4 gap-y-1.5">
                              <For each={THEME_VARS.filter((v) => v.group === group)}>
                                {(v) => (
                                  <div class="flex items-center gap-2">
                                    <input
                                      type="color"
                                      class="w-6 h-6 shrink-0 rounded cursor-pointer bg-transparent border border-(--border)"
                                      value={normalizeHex(theme().vars[v.name])}
                                      onInput={(e) => settingsActions.updateCustomThemeVar(theme().id, v.name, e.currentTarget.value)}
                                    />
                                    <span class="text-[11px] t-2 w-16 shrink-0">{v.label}</span>
                                    <input
                                      class="flex-1 min-w-0 bg-(--bg-base) border border-(--border) rounded px-1.5 py-0.5 text-[11px] t-base font-mono outline-none focus:border-(--accent)"
                                      value={theme().vars[v.name] ?? ""}
                                      onChange={(e) => settingsActions.updateCustomThemeVar(theme().id, v.name, e.currentTarget.value)}
                                    />
                                  </div>
                                )}
                              </For>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  )}
                </Show>

                <div class="text-[10px] t-3 mb-2 uppercase tracking-widest">自定义 CSS</div>
                <textarea
                  class="w-full h-36 bg-(--bg-base) border border-(--border) rounded p-2.5 text-[12px] t-base font-mono resize-none outline-none transition-colors focus:border-(--accent)"
                  placeholder="/* 在此输入自定义 CSS */"
                  value={draftCSS()}
                  onInput={(e) => setDraftCSS(e.currentTarget.value)}
                  spellcheck={false}
                />
              </Match>
```

- [ ] **Step 5: 加 `normalizeHex` 辅助**

`<input type="color">` 要求 `#rrggbb`。在 `Settings` 组件内（或文件模块级）加入：

```tsx
  // <input type=color> 只接受 #rrggbb；非 hex（如 color-mix/rgb）回退到中性灰避免控件报错
  const normalizeHex = (v: string | undefined): string => {
    if (v && /^#[0-9a-fA-F]{6}$/.test(v.trim())) return v.trim();
    if (v && /^#[0-9a-fA-F]{3}$/.test(v.trim())) {
      const h = v.trim().slice(1);
      return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
    }
    return "#888888";
  };
```

> 旁边的文本框始终显示/编辑原始值，故即便取色器回退灰色，用户仍可手填任意 CSS 颜色。

- [ ] **Step 6: 类型检查**

Run: `npx tsc --noEmit`
Expected: 通过。

- [ ] **Step 7: 构建**

Run: `npx vite build`
Expected: 成功。

- [ ] **Step 8: 手动验证（`npm run dev`）**

逐项确认：
1. 「外观」页按 浅色/深色 两组列出 3 个预设 + 一个「+ 新建自定义」卡片（仅出现在当前主题所属模式那组）。
2. 切换 light/nord：编辑器标题、加粗、行内代码颜色随主题变化（验证 `--cm-*` 修复）。
3. 点「+ 新建自定义」：在当前模式组新增一张卡并选中，下方展开分组颜色编辑器。
4. 拖动任一取色器：UI 与编辑器实时变色。
5. 改文本框为非 hex（如 `color-mix(in srgb, red 50%, blue)`）：生效，取色器显示灰色但不报错。
6. 重命名/删除自定义主题正常；删除当前选中项回退到其基础主题。
7. 点「应用」关闭后刷新页面：自定义主题与选中态从 localStorage 恢复。
8. 重新打开设置、改色、点「取消」：颜色回滚到打开前状态。

- [ ] **Step 9: 提交**

```bash
git add src/components/Settings.tsx
git commit -m "feat(settings): grouped theme picker + per-variable color editor"
```

---

## Self-Review 记录

- **Spec 覆盖**：预设按明暗分组(Task 6)、全变量可编辑(Task 1 THEME_VARS + Task 6 编辑器)、CM6 联动(Task 3 + cmTheme 已用 var)、实时预览+取消回滚(Task 5 effect + Task 6 snapshot/cancel)、生成自定义主题(Task 4 addCustomTheme + Task 6 新建按钮)、`--accent-bg` 派生与不暴露(Task 1 + Task 3)、持久化(Task 4 store 自带)——均有对应任务。
- **类型一致性**：`CustomTheme`/`ThemeMode`/`ThemeSpec`/`PRESET_THEMES`/`THEME_VARS`/`resolveTheme`/`applyTheme`/`snapshotTheme` 在 Task 1-2 定义，Task 4-6 引用名一致；store action 名（`addCustomTheme`/`updateCustomThemeVar`/`renameCustomTheme`/`deleteCustomTheme`/`setCustomThemes`/`setTheme`）跨 Task 4 与 Task 6 一致。
- **占位符**：无 TBD/TODO；每个改动步骤含完整代码。
- **风险点**：`ThemeMode` 的 import 来源（types re-export vs 直接从 lib/theme）已在 Task 4 标注二选一，保持单一来源。
