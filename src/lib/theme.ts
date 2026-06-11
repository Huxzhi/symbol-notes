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
