# BuJo 信号字符整行高亮（第二期 a）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按列表项的 signifier 给整行加一层淡背景色（前导符号原样保留），在主编辑器与 dashboard 预览生效。

**Architecture:** 新增 ViewPlugin `bujoHighlight`，读 Phase 1 已有的 `listsField`（不重解析），自带 `signifier→CSS class` 语义映射，对可见行加 `Decoration.line`。配套 CSS 进 `cmTheme`，并把 `listsField`+`bujoHighlight` 纳入 `livePreviewExtension` bundle。

**Tech Stack:** TypeScript、CodeMirror 6（ViewPlugin/Decoration/RangeSetBuilder）、Vitest。

参考 spec：`docs/superpowers/specs/2026-06-09-bujo-signifier-highlight-design.md`

---

## 文件结构

- Create: `src/lib/cm6/bujoHighlight.ts` — `SIGNIFIER_CLASS`、`buildLineClassMap`、`bujoHighlight` ViewPlugin
- Create: `src/lib/cm6/__tests__/bujoHighlight.test.ts` — 纯逻辑单测
- Modify: `src/lib/cm6/cmTheme.ts` — 五条整行背景 CSS
- Modify: `src/lib/cm6/livePreviewExtension.ts` — 把 `listsField`+`bujoHighlight` 纳入 bundle

---

## Task 1: bujoHighlight 插件 + 纯逻辑单测

**Files:**
- Create: `src/lib/cm6/bujoHighlight.ts`
- Create: `src/lib/cm6/__tests__/bujoHighlight.test.ts`

- [ ] **Step 1: 写失败测试 `src/lib/cm6/__tests__/bujoHighlight.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { SIGNIFIER_CLASS, buildLineClassMap } from '../bujoHighlight'
import type { ListItem } from '../../../stores/types'

function item(over: Partial<ListItem>): ListItem {
  return {
    text: '', visual: '', line: 0, lineCount: 1, symbol: '-',
    signifier: null, status: null, checked: false, task: false,
    fields: {}, tags: [], ...over,
  }
}

describe('SIGNIFIER_CLASS', () => {
  it('maps the five BuJo signifiers to classes', () => {
    expect(SIGNIFIER_CLASS).toEqual({
      '-': 'cm-bujo-event',
      '=': 'cm-bujo-mood',
      '~': 'cm-bujo-idea',
      '!': 'cm-bujo-important',
      '&': 'cm-bujo-attention',
    })
  })
})

describe('buildLineClassMap', () => {
  it('maps a line to its signifier class', () => {
    const m = buildLineClassMap([item({ line: 2, signifier: '-' })])
    expect(m.get(2)).toBe('cm-bujo-event')
  })

  it('maps each known signifier', () => {
    const m = buildLineClassMap([
      item({ line: 0, signifier: '=' }),
      item({ line: 1, signifier: '~' }),
      item({ line: 2, signifier: '!' }),
      item({ line: 3, signifier: '&' }),
    ])
    expect(m.get(0)).toBe('cm-bujo-mood')
    expect(m.get(1)).toBe('cm-bujo-idea')
    expect(m.get(2)).toBe('cm-bujo-important')
    expect(m.get(3)).toBe('cm-bujo-attention')
  })

  it('skips plain lists, tasks, and unknown signifiers', () => {
    const m = buildLineClassMap([
      item({ line: 0, signifier: null }),               // 普通列表
      item({ line: 1, signifier: null, status: ' ', task: true }), // 任务
      item({ line: 2, signifier: '*' }),                // 不在表内
    ])
    expect(m.size).toBe(0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/cm6/__tests__/bujoHighlight.test.ts`
Expected: FAIL（`bujoHighlight` 模块/导出不存在）

- [ ] **Step 3: 实现 `src/lib/cm6/bujoHighlight.ts`**

```ts
import { RangeSetBuilder } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { listsField } from './listsField'
import type { ListItem } from '../../stores/types'

/** 渲染插件自有的语义映射：signifier → 整行背景 class。解析层不涉及含义。 */
export const SIGNIFIER_CLASS: Record<string, string> = {
  '-': 'cm-bujo-event',
  '=': 'cm-bujo-mood',
  '~': 'cm-bujo-idea',
  '!': 'cm-bujo-important',
  '&': 'cm-bujo-attention',
}

/** 纯函数：列表项 → (0-based 行号 → class)，只收 signifier 命中映射表的项。 */
export function buildLineClassMap(items: ListItem[]): Map<number, string> {
  const map = new Map<number, string>()
  for (const it of items) {
    const cls = it.signifier ? SIGNIFIER_CLASS[it.signifier] : undefined
    if (cls) map.set(it.line, cls)
  }
  return map
}

function buildBujoDecos(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const byLine = buildLineClassMap(view.state.field(listsField))
  if (byLine.size === 0) return builder.finish()
  for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos)
      const cls = byLine.get(line.number - 1)
      if (cls) builder.add(line.from, line.from, Decoration.line({ class: cls }))
      pos = line.to + 1
    }
  }
  return builder.finish()
}

export const bujoHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildBujoDecos(view)
    }
    update(update: ViewUpdate) {
      // signifier 仅随文档变化；不依赖光标，故不监听 selectionSet
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildBujoDecos(update.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/lib/cm6/__tests__/bujoHighlight.test.ts`
Expected: PASS（5 个用例）

- [ ] **Step 5: 提交**

```bash
git add src/lib/cm6/bujoHighlight.ts src/lib/cm6/__tests__/bujoHighlight.test.ts
git commit -m "feat(bujo): add bujoHighlight ViewPlugin and signifier class map"
```

---

## Task 2: 配色 CSS + 接入 livePreview bundle + 验证

**Files:**
- Modify: `src/lib/cm6/cmTheme.ts:203-211`（`.cm-list-bullet::before` 之后插入）
- Modify: `src/lib/cm6/livePreviewExtension.ts`（import + 导出 bundle）

- [ ] **Step 1: 加五条背景 CSS `src/lib/cm6/cmTheme.ts`**

在 `.cm-list-bullet::before` 规则块（以 `backgroundColor: 'var(--text)',` 与 `},` 结尾）之后、紧接的 `},`（关闭整个 rules 对象）之前，插入：

```ts
    '.cm-bujo-event':     { backgroundColor: 'color-mix(in srgb, #4aa3ff 12%, transparent)' },
    '.cm-bujo-mood':      { backgroundColor: 'color-mix(in srgb, #56c596 12%, transparent)' },
    '.cm-bujo-idea':      { backgroundColor: 'color-mix(in srgb, #9d8dff 14%, transparent)' },
    '.cm-bujo-important': { backgroundColor: 'color-mix(in srgb, #ff5a5a 14%, transparent)' },
    '.cm-bujo-attention': { backgroundColor: 'color-mix(in srgb, #ffcc44 16%, transparent)' },
```

参考插入后结构：

```ts
    '.cm-list-bullet::before': {
      content: '""',
      display: 'block',
      width: '4px',
      height: '4px',
      borderRadius: '50%',
      flexShrink: '0',
      backgroundColor: 'var(--text)',
    },
    '.cm-bujo-event':     { backgroundColor: 'color-mix(in srgb, #4aa3ff 12%, transparent)' },
    '.cm-bujo-mood':      { backgroundColor: 'color-mix(in srgb, #56c596 12%, transparent)' },
    '.cm-bujo-idea':      { backgroundColor: 'color-mix(in srgb, #9d8dff 14%, transparent)' },
    '.cm-bujo-important': { backgroundColor: 'color-mix(in srgb, #ff5a5a 14%, transparent)' },
    '.cm-bujo-attention': { backgroundColor: 'color-mix(in srgb, #ffcc44 16%, transparent)' },
  },
  { dark: true },
)
```

- [ ] **Step 2: 接入 bundle `src/lib/cm6/livePreviewExtension.ts`**

在顶部 import 区（`import { detectFrontmatter } from './frontmatterField'` 与已有
`import { completionLineEdit, todayISO } from './listsField'` 附近）加入：

```ts
import { listsField } from './listsField'
import { bujoHighlight } from './bujoHighlight'
```

把文件末尾的导出：

```ts
export const livePreviewExtension = [inlinePreviewPlugin, blockPreviewField]
```

改为：

```ts
export const livePreviewExtension = [listsField, inlinePreviewPlugin, blockPreviewField, bujoHighlight]
```

（`listsField` 是模块级单例；`EditorViewer` 已单独纳入同一引用，CM6 按引用去重，无副作用。bundle 含 `listsField` 保证 dashboard 的 `PlanEditor` 也有该字段，高亮两处生效。）

- [ ] **Step 3: 类型检查 + 全量测试 + 构建**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc 无错误；测试全绿；构建成功。

- [ ] **Step 4: 手动验证**

Run: `npm run dev`，新建/打开一篇笔记，输入：

```
- - 看了场电影
- = 今天很开心
- ~ 想到一个点子
- ! 重要的事
- & 留意一下
- [ ] 一个任务
- 普通列表项
```

Expected：
- `- -`/`- =`/`- ~`/`- !`/`- &` 五行各显**淡蓝/绿/紫/红/黄**整行背景；前导符号 `-`/`=`/`~`/`!`/`&` 原样可见。
- 任务行与普通列表行**无背景**。
- 在 dashboard 的今日/周/月计划预览里同样生效。
- 切换深/浅/nord 主题，背景仍清晰可辨（color-mix 适配）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/cm6/cmTheme.ts src/lib/cm6/livePreviewExtension.ts
git commit -m "feat(bujo): tint list lines by signifier; wire into livePreview bundle"
```

---

## 完成标准

- 带已知 signifier（`- = ~ ! &`）的列表行显示对应淡背景；前导符号保留、字形不变。
- 任务/普通列表无背景；未知 signifier 无背景。
- 主编辑器与 dashboard 预览两处生效；三主题下可辨。
- 解析与渲染解耦：`bujoHighlight` 读 `listsField` 不重解析，语义映射归插件自有。
- `npx tsc --noEmit`、`npx vitest run`、`npm run build` 全绿。
