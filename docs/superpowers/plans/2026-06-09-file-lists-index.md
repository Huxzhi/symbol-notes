# file.lists 列表项索引（第一期）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Markdown 解析从"只抓任务"泛化为 Dataview 风格的"抓所有列表项"，索引进 `FileMeta.lists`，任务成为 `task===true` 的子集。

**Architecture:** 把 `tasksField` 升级为 `listsField`（重命名文件 `tasksField.ts` → `listsField.ts`），用语法树遍历所有 `ListItem` 节点产出 `ListItem[]`；编辑器与全库扫描共用。`TaskItem` 删除，全库改用 `ListItem`；`taskMap` 由 `lists.filter(l => l.task)` 派生。信号字符仅原样保存，渲染/过滤属第二期。

**Tech Stack:** TypeScript、SolidJS、CodeMirror 6、@lezer/markdown、Vitest。

参考 spec：`docs/superpowers/specs/2026-06-09-file-lists-index-design.md`

**注意：** vitest（esbuild）按文件转译、不做全项目类型检查，所以解析层测试可在消费方尚未改完时先跑绿；`tsc --noEmit` 与 `npm run build` 作为最后一关（Task 5）统一把关。中间任务的提交可能 tsc 未过，属预期。

---

## 文件结构

- 重命名 `src/lib/cm6/tasksField.ts` → `src/lib/cm6/listsField.ts`（解析器升级 + 自动补全原样保留）
- 重命名 `src/lib/__tests__/tasksField.test.ts` → `src/lib/__tests__/listsField.test.ts`（重写解析断言）
- `src/stores/types.ts` — 删 `TaskItem`，加 `ListItem`；`FileMeta.tasks`→`lists`；`taskMap` 类型
- `src/lib/parseMarkdown.ts` — `ParseResult.tasks`→`lists`
- `src/plugins/editor/EditorViewer.tsx` — 引用 `listsField`、传 `lists`
- `src/vault/indexStorage.ts` — `CachedFields` 的 `tasks`→`lists`
- `src/vault/scan.ts`、`src/vault/index.ts` — 写 `FileMeta.lists`、去掉 due/completion 注入、cache-miss 判断
- `src/vault/tasks.ts` — `buildTaskMap` 按 `task` 过滤
- `src/plugins/dashboard/dashboardUtils.ts`、`DashboardViewer.tsx` — `WeekTask`/`cleanText`→`visual`
- `src/plugins/calendar/calendarUtils.ts`、`CalendarViewer.tsx` — `Task`/`cleanText`→`visual`/`dueDate` 回退
- 测试夹具：`knowledgeUtils.test.ts`、`dashboardUtils.test.ts`

---

## Task 1: ListItem 类型 + listsField 解析器

**Files:**
- Modify: `src/stores/types.ts`
- Create: `src/lib/cm6/listsField.ts`（由 `tasksField.ts` 重命名改写）
- Delete: `src/lib/cm6/tasksField.ts`
- Rename+rewrite test: `src/lib/__tests__/tasksField.test.ts` → `src/lib/__tests__/listsField.test.ts`

- [ ] **Step 1: 改类型 `src/stores/types.ts`**

把 `TaskItem` 接口整段替换为 `ListItem`：

```ts
export interface ListItem {
  text: string                    // 列表标记后、剥掉前导 token（复选框/信号字符）的正文；仍含 [k:: v]
  visual: string                  // text 再去掉 [k:: v] 内联字段后的纯展示文本
  line: number                    // 0-based 起始行
  lineCount: number               // 该列表项跨的物理行数（≥1）
  symbol: string                  // 列表标记原文：'-' / '*' / '+'，或有序 '1.' / '2.' / '1)'
  signifier: string | null        // 前导单个 ASCII 标点（* = ~ ! & …）；无则 null
  status: string | null           // 复选框字符 ' '/'x'/'X'/'/'/'>' …；非复选框为 null
  checked: boolean                // status === 'x' || status === 'X'
  task: boolean                   // status !== null
  fields: Record<string, string>  // [k:: v] 内联字段（key/val 均 trim）
  tags: string[]                  // 行内 #标签（不含 #）
}
```

把 `FileMeta` 里 `tasks: TaskItem[]` 改为 `lists: ListItem[]`（保留行内注释意思即可）：

```ts
  lists: ListItem[]      // 全部列表项；task===true 为任务子集
```

把 `VaultState` 里 `taskMap: Record<string, TaskItem[]>` 改为：

```ts
  taskMap: Record<string, ListItem[]>
```

- [ ] **Step 2: 用 git 重命名解析器与测试文件**

```bash
git mv src/lib/cm6/tasksField.ts src/lib/cm6/listsField.ts
git mv src/lib/__tests__/tasksField.test.ts src/lib/__tests__/listsField.test.ts
```

- [ ] **Step 3: 改写 `src/lib/cm6/listsField.ts` 的解析部分**

把文件顶部到 `tasksField` StateField 定义为止（第 1–142 行，即从 `import` 到 `export const tasksField = …})` 那段）整体替换为下面内容。**`// ── Inline-field autocomplete ──` 及其之后的所有内容（DATE_OPTIONS / fieldCompletionSource / valueCompletionSource / taskFieldComplete）保持不动。**

```ts
import { syntaxTree } from '@codemirror/language'
import { StateField } from '@codemirror/state'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNodeRef } from '@lezer/common'
import {
  autocompletion,
  startCompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import type { ListItem } from '../../stores/types'

const INLINE_FIELD_RE = /\[([^\]]+?)::([^\]]*)\]/g
// 复选框：[ ] / [x] / [/] / [>] 等任意单字符状态；允许其后无空格（空任务 [ ]）
const CHECKBOX_RE = /^\[(.)\]\s*(.*)$/
// 信号字符：单个 ASCII 标点/符号 + 至少一个空格 + 正文
const SIGNIFIER_RE = /^([\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E])\s+(.*)$/
// 行内标签（复用 inlineTagsField 的模式）
const TAG_RE = /(?<!\S)#([a-zA-Z_一-龥][a-zA-Z0-9_一-龥/-]*)/g

const TASK_LINE_RE = /^\s*[-*+] \[.\] /

/** 判定一行是否任务行（含非标准状态字符 [/] [>] [-] 等）。 */
export function isTaskLine(text: string): boolean {
  return TASK_LINE_RE.test(text)
}

function isoFromDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 今天加 days 天后的 YYYY-MM-DD（本地时区）。base 仅供测试注入。 */
export function offsetISO(days: number, base: Date = new Date()): string {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return isoFromDate(d)
}

/** 今天的 YYYY-MM-DD。base 仅供测试注入。 */
export function todayISO(base: Date = new Date()): string {
  return offsetISO(0, base)
}

/** 下一个周一的 YYYY-MM-DD（今天是周一则 +7）。base 仅供测试注入。 */
export function nextMondayISO(base: Date = new Date()): string {
  const d = new Date(base)
  const delta = (8 - d.getDay()) % 7 || 7
  d.setDate(d.getDate() + delta)
  return isoFromDate(d)
}

const COMPLETION_FIELD_RE = / ?\[completion::[^\]\n]*\]/

/**
 * 勾选/取消勾选任务时对行尾的编辑。
 * - willCheck=true 且该行无 completion → 追加 ` [completion::<today>]`
 * - willCheck=false 且该行有 completion → 删除该片段（含前导空格），返回行内相对区间
 * 其余情况返回 {}（不改动）。区间 from/to 相对行首。
 */
export function completionLineEdit(
  lineText: string,
  willCheck: boolean,
  today: string,
): { append?: string; remove?: { from: number; to: number } } {
  if (willCheck) {
    if (COMPLETION_FIELD_RE.test(lineText)) return {}
    return { append: ` [completion::${today}]` }
  }
  const m = COMPLETION_FIELD_RE.exec(lineText)
  if (!m) return {}
  return { remove: { from: m.index, to: m.index + m[0].length } }
}

function parseInlineFields(text: string): { fields: Record<string, string>; visual: string } {
  const fields: Record<string, string> = {}
  INLINE_FIELD_RE.lastIndex = 0
  const visual = text.replace(INLINE_FIELD_RE, (_, key: string, val: string) => {
    fields[key.trim()] = val.trim()
    return ''
  }).replace(/\s+/g, ' ').trim()
  return { fields, visual }
}

function extractTagsFrom(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  TAG_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TAG_RE.exec(text)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1])
      out.push(m[1])
    }
  }
  return out
}

function buildListItem(node: SyntaxNodeRef, state: EditorState): ListItem {
  // 找 ListMark 子节点 → symbol 与标记结束位置
  let markFrom = node.from
  let markTo = node.from
  const cur = node.node.cursor()
  if (cur.firstChild()) {
    do {
      if (cur.name === 'ListMark') {
        markFrom = cur.from
        markTo = cur.to
        break
      }
    } while (cur.nextSibling())
  }
  const symbol = state.doc.sliceString(markFrom, markTo)
  const markLine = state.doc.lineAt(markTo)
  const content = state.doc.sliceString(markTo, markLine.to).replace(/^\s+/, '')

  let status: string | null = null
  let signifier: string | null = null
  let rawBody = content
  const cm = CHECKBOX_RE.exec(content)
  if (cm) {
    status = cm[1]
    rawBody = cm[2]
  } else {
    const sm = SIGNIFIER_RE.exec(content)
    if (sm) {
      signifier = sm[1]
      rawBody = sm[2]
    }
  }

  const { fields, visual } = parseInlineFields(rawBody)
  const endLine = state.doc.lineAt(Math.max(markTo, node.to - 1)).number

  return {
    text: rawBody.trim(),
    visual,
    line: markLine.number - 1,
    lineCount: Math.max(1, endLine - markLine.number + 1),
    symbol,
    signifier,
    status,
    checked: status === 'x' || status === 'X',
    task: status !== null,
    fields,
    tags: extractTagsFrom(rawBody),
  }
}

function extractLists(state: EditorState): ListItem[] {
  const items: ListItem[] = []
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') return false
      if (node.name === 'ListItem') items.push(buildListItem(node, state))
    },
  })
  items.sort((a, b) => a.line - b.line)
  return items
}

export const listsField = StateField.define<ListItem[]>({
  create: extractLists,
  update(items, tr) {
    if (tr.docChanged) return extractLists(tr.state)
    return items
  },
})
```

- [ ] **Step 4: 重写测试 `src/lib/__tests__/listsField.test.ts`（解析部分）**

把文件顶部 import 行与 `describe('tasksField', …)`、`describe('isTaskLine', …)`、`describe('date helpers', …)`、`describe('completionLineEdit', …)` 这几块替换成下面内容。**`describe('completion sources', …)` 那块保持不动**，只把它依赖的 import（`taskFieldComplete`/`fieldCompletionSource`/`valueCompletionSource`/`CompletionContext`）并入新 import。新 import 顶部：

```ts
import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import {
  listsField,
  isTaskLine,
  offsetISO,
  todayISO,
  nextMondayISO,
  completionLineEdit,
  taskFieldComplete,
  fieldCompletionSource,
  valueCompletionSource,
} from '../cm6/listsField'
import { CompletionContext } from '@codemirror/autocomplete'

function parse(content: string) {
  const state = EditorState.create({
    doc: content,
    extensions: [markdown({ extensions: [GFM] }), listsField],
  })
  return state.field(listsField)
}

describe('listsField', () => {
  it('extracts a plain list item (not a task)', () => {
    const items = parse('- 买牛奶')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      task: false, signifier: null, status: null,
      text: '买牛奶', visual: '买牛奶', symbol: '-', line: 0, lineCount: 1,
    })
  })

  it('extracts an open task', () => {
    const items = parse('- [ ] Buy milk')
    expect(items[0]).toMatchObject({
      task: true, checked: false, status: ' ', signifier: null,
      text: 'Buy milk', visual: 'Buy milk', symbol: '-',
    })
  })

  it('extracts a completed task', () => {
    expect(parse('- [x] Done')[0]).toMatchObject({ task: true, checked: true, status: 'x' })
  })

  it('extracts a non-standard status task', () => {
    expect(parse('- [/] WIP')[0]).toMatchObject({ task: true, checked: false, status: '/' })
  })

  it('extracts an empty task', () => {
    expect(parse('- [ ]')[0]).toMatchObject({ task: true, status: ' ', text: '', visual: '' })
  })

  it('extracts ordered list items', () => {
    const items = parse('1. 第一步\n2. [ ] 做事')
    expect(items[0]).toMatchObject({ symbol: '1.', task: false, text: '第一步' })
    expect(items[1]).toMatchObject({ symbol: '2.', task: true, status: ' ' })
  })

  it('records signifiers', () => {
    expect(parse('- * 看了电影')[0]).toMatchObject({ signifier: '*', task: false, text: '看了电影', visual: '看了电影' })
    expect(parse('- = 今天很开心')[0]).toMatchObject({ signifier: '=' })
    expect(parse('- ! 注意')[0]).toMatchObject({ signifier: '!' })
    expect(parse('- & 留意')[0]).toMatchObject({ signifier: '&' })
    expect(parse('- ~ 想法 [k:: v]')[0]).toMatchObject({ signifier: '~', visual: '想法', fields: { k: 'v' } })
  })

  it('does not misread emphasis/wikilinks/CJK as signifiers', () => {
    expect(parse('- *斜体* 文本')[0]).toMatchObject({ signifier: null, text: '*斜体* 文本' })
    expect(parse('- [[链接]]')[0]).toMatchObject({ signifier: null, status: null, text: '[[链接]]' })
    expect(parse('- 看书')[0]).toMatchObject({ signifier: null, text: '看书' })
  })

  it('extracts inline fields and visual on tasks', () => {
    const t = parse('- [ ] Write report [due:: 2026-06-09]')[0]
    expect(t.fields).toMatchObject({ due: '2026-06-09' })
    expect(t.text).toBe('Write report [due:: 2026-06-09]')
    expect(t.visual).toBe('Write report')
  })

  it('extracts line tags', () => {
    expect(parse('- 看书 #读书')[0].tags).toEqual(['读书'])
  })

  it('reports 0-based line and lineCount', () => {
    const items = parse('# H\n\n- Task on line 2')
    expect(items[0]).toMatchObject({ line: 2, lineCount: 1 })
  })

  it('skips list items inside fenced code blocks', () => {
    const items = parse('```\n- [ ] Not real\n```\n\n- Real')
    expect(items).toHaveLength(1)
    expect(items[0].text).toBe('Real')
  })
})

describe('isTaskLine', () => {
  it('matches standard and non-standard task lines', () => {
    expect(isTaskLine('- [ ] todo')).toBe(true)
    expect(isTaskLine('- [x] done')).toBe(true)
    expect(isTaskLine('  * [/] indented')).toBe(true)
    expect(isTaskLine('+ [>] forwarded')).toBe(true)
  })
  it('rejects plain lists and text', () => {
    expect(isTaskLine('- plain item')).toBe(false)
    expect(isTaskLine('just text')).toBe(false)
    expect(isTaskLine('[due::x]')).toBe(false)
  })
})

describe('date helpers', () => {
  const base = new Date(2026, 5, 9) // 周二

  it('offsetISO computes relative dates', () => {
    expect(offsetISO(0, base)).toBe('2026-06-09')
    expect(offsetISO(1, base)).toBe('2026-06-10')
    expect(offsetISO(2, base)).toBe('2026-06-11')
    expect(offsetISO(-1, base)).toBe('2026-06-08')
    expect(offsetISO(7, base)).toBe('2026-06-16')
    expect(offsetISO(-7, base)).toBe('2026-06-02')
  })

  it('todayISO equals offsetISO(0)', () => {
    expect(todayISO(base)).toBe('2026-06-09')
  })

  it('nextMondayISO returns the following Monday', () => {
    expect(nextMondayISO(base)).toBe('2026-06-15')
    expect(nextMondayISO(new Date(2026, 5, 15))).toBe('2026-06-22')
    expect(nextMondayISO(new Date(2026, 5, 14))).toBe('2026-06-15')
  })
})

describe('completionLineEdit', () => {
  it('appends completion field when checking a task without one', () => {
    expect(completionLineEdit('- [ ] task', true, '2026-06-09')).toEqual({ append: ' [completion::2026-06-09]' })
  })
  it('does nothing when checking a task that already has completion', () => {
    expect(completionLineEdit('- [ ] task [completion::2026-01-01]', true, '2026-06-09')).toEqual({})
  })
  it('removes completion field (with leading space) when unchecking', () => {
    const text = '- [x] task [completion::2026-06-09]'
    expect(completionLineEdit(text, false, '2026-06-09').remove).toEqual({ from: text.indexOf(' [completion'), to: text.length })
  })
  it('does nothing when unchecking a task without completion', () => {
    expect(completionLineEdit('- [x] task', false, '2026-06-09')).toEqual({})
  })
})
```

（保留其后原有的 `describe('completion sources', …)` 块；它已不再重复 import。）

- [ ] **Step 5: 运行解析测试**

Run: `npx vitest run src/lib/__tests__/listsField.test.ts`
Expected: PASS（全部，含 completion sources）

- [ ] **Step 6: 提交**

```bash
git add -A src/stores/types.ts src/lib/cm6/ src/lib/__tests__/
git commit -m "feat(lists): add ListItem type and listsField parser (rename from tasksField)"
```

---

## Task 2: parseMarkdown + 编辑器接线

**Files:**
- Modify: `src/lib/parseMarkdown.ts`
- Modify: `src/plugins/editor/EditorViewer.tsx:25,79-80,124-134,254-261`

- [ ] **Step 1: 改 `src/lib/parseMarkdown.ts`**

把 `tasks` 全面换成 `lists`：

```ts
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { wikiLinkParser } from './cm6/wikiLinkParser'
import { outLinksField } from './cm6/outLinksField'
import { inlineTagsField } from './cm6/inlineTagsField'
import { listsField } from './cm6/listsField'
import type { ListItem } from '../stores/types'

export interface ParseResult {
  outLinks: string[]
  inlineTags: string[]
  lists: ListItem[]
}

const EXTENSIONS = [
  markdown({ extensions: [GFM, wikiLinkParser] }),
  outLinksField,
  inlineTagsField,
  listsField,
]

function extractResult(state: EditorState): ParseResult {
  return {
    outLinks: state.field(outLinksField)
      .filter(l => l.type === 'wiki')
      .map(l => l.target.endsWith('.md') ? l.target : `${l.target}.md`),
    inlineTags: state.field(inlineTagsField).map(m => m.tag),
    lists: state.field(listsField),
  }
}
```

（`parseMarkdown` / `createMarkdownParser` 两个导出函数体不变。）

- [ ] **Step 2: 改 `src/plugins/editor/EditorViewer.tsx`**

第 25 行 import：

```ts
import { listsField, taskFieldComplete } from '../../lib/cm6/listsField'
```

第 79–80 行 extensions 数组：把 `tasksField,` 改为 `listsField,`（`taskFieldComplete,` 保留）。

第 124–134 区域（`handleDocChange` 里的 reindex）：把

```ts
        const tasks = view.state.field(tasksField)
        void reindexFile(p, view.state.doc.toString(), {
          outLinks,
          inlineTags,
          tasks,
        })
```

改为

```ts
        const lists = view.state.field(listsField)
        void reindexFile(p, view.state.doc.toString(), {
          outLinks,
          inlineTags,
          lists,
        })
```

第 254–261 区域（`doSave` 里）：把

```ts
    const tasks = view.state.field(tasksField)
    await fileActions.saveFile(p, content, { outLinks, inlineTags, tasks })
```

改为

```ts
    const lists = view.state.field(listsField)
    await fileActions.saveFile(p, content, { outLinks, inlineTags, lists })
```

- [ ] **Step 3: 运行解析测试确认未破坏**

Run: `npx vitest run src/lib/__tests__/listsField.test.ts`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add src/lib/parseMarkdown.ts src/plugins/editor/EditorViewer.tsx
git commit -m "feat(lists): wire listsField through parseMarkdown and editor"
```

---

## Task 3: 全库扫描 / 索引 / 持久化

**Files:**
- Modify: `src/vault/indexStorage.ts:4-6`
- Modify: `src/vault/scan.ts:90-108,149,205-240`
- Modify: `src/vault/index.ts:185-244,374-534`
- Modify: `src/vault/tasks.ts`

- [ ] **Step 1: `src/vault/indexStorage.ts` — CachedFields 字段名**

把第 4–6 行 `CachedFields` 的 `'tasks'` 改为 `'lists'`：

```ts
export type CachedFields = Pick<FileMeta,
  'frontmatter' | 'outLinks' | 'etags' | 'tags' | 'aliases' | 'created' | 'updated' | 'dated' | 'lists'
>
```

- [ ] **Step 2: `src/vault/tasks.ts` — taskMap 按 task 过滤**

整文件替换为：

```ts
import type { FileMeta, ListItem } from '../stores/types'
import { setVaultStore } from './index'

export function buildTaskMap(files: Record<string, { lists: ListItem[] }>): Record<string, ListItem[]> {
  const result: Record<string, ListItem[]> = {}
  for (const [path, meta] of Object.entries(files)) {
    const tasks = meta.lists.filter((l) => l.task)
    if (tasks.length > 0) result[path] = tasks
  }
  return result
}

/** 全量重建 taskMap */
export function buildTasks(mdFiles: Record<string, FileMeta>): void {
  setVaultStore('taskMap', buildTaskMap(mdFiles))
}

/** 单文件 lists 变化时增量更新任务子集 */
export function applyFileTasks(path: string, lists: ListItem[]): void {
  setVaultStore('taskMap', path, lists.filter((l) => l.task))
}

/** 文件删除：清理 taskMap 条目 */
export function removeFileTasks(path: string): void {
  setVaultStore('taskMap', path, undefined as unknown as ListItem[])
}
```

- [ ] **Step 3: `src/vault/scan.ts` — EMPTY_CONTENT、destructure、去注入**

第 90–108 行 `EMPTY_CONTENT`：把 `'tasks'` 改 `'lists'`、`tasks: []` 改 `lists: []`：

```ts
const EMPTY_CONTENT: Pick<
  FileMeta,
  | 'frontmatter'
  | 'outLinks'
  | 'etags'
  | 'tags'
  | 'aliases'
  | 'updated'
  | 'lists'
> = {
  frontmatter: {},
  outLinks: [],
  etags: [],
  tags: [],
  aliases: [],
  updated: null,
  lists: [],
}
```

第 149 行注释里的 `tasks` 字样改 `lists`（仅注释，可选）。

unchanged 缓存命中分支（约第 175 行 `if (meta)`）：改为只在缓存含 `lists` 时算命中，否则当未解析：

```ts
    if (meta && Array.isArray(meta.lists)) {
      setVaultStore('files', path, (f: FileMeta) => ({ ...f, hash, ...meta }))
      onParsed?.()
    } else {
      changed.push(path)
    }
```

changed 解析分支（约第 205–240 行）：把 `tasks: rawTaskItems` 的解构与其后的 `.map` 注入删掉，直接存 `lists`。把

```ts
      const cachedMeta = await getCachedMeta(hash)
      if (cachedMeta) {
```

改为

```ts
      const cachedMeta = await getCachedMeta(hash)
      if (cachedMeta && Array.isArray(cachedMeta.lists)) {
```

把

```ts
        const {
          outLinks,
          inlineTags,
          tasks: rawTaskItems,
        } = parser.parse(content)
        const created = …
        const updated = …
        const dated = …
        const tasks: TaskItem[] = rawTaskItems.map((t) => ({
          ...t,
          dueDate: t.dueDate ?? dated,
          completedDate: t.checked ? (t.completedDate ?? dated) : null,
        }))
        const fmTags = extractTags(frontmatter.tags)
        const parsed = {
          frontmatter,
          outLinks,
          etags: [...new Set([...fmTags, ...inlineTags])],
          tags: mergeTagsWithBody(fmTags, inlineTags),
          aliases: extractAliases(frontmatter.aliases),
          created,
          updated,
          dated,
          tasks,
        }
```

改为（删掉 due/completion 注入，`lists` 直存；`created/updated/dated` 计算不变）：

```ts
        const { outLinks, inlineTags, lists } = parser.parse(content)
        const created =
          extractDateString(frontmatter.created) ??
          new Date(entry.mtime).toISOString().slice(0, 10)
        const updated = extractDateString(frontmatter.updated) ?? null
        const dated = extractDateString(frontmatter.dated) ?? created
        const fmTags = extractTags(frontmatter.tags)
        const parsed = {
          frontmatter,
          outLinks,
          etags: [...new Set([...fmTags, ...inlineTags])],
          tags: mergeTagsWithBody(fmTags, inlineTags),
          aliases: extractAliases(frontmatter.aliases),
          created,
          updated,
          dated,
          lists,
        }
```

若 `TaskItem` 的 import 现已无用，删除该 import 行。

- [ ] **Step 4: `src/vault/index.ts` — ContentFields、reindexFile、空对象**

第 185–193 的 `ContentFields` 联合类型里 `'tasks'` 改 `'lists'`。

第 199–244 的 `reindexFile`：
- 约第 208 行 `if (cached) {` 改为 `if (cached && Array.isArray(cached.lists)) {`。
- 把解构与注入

```ts
    const {
      outLinks,
      inlineTags,
      tasks: rawTasks,
    } = cmParsed ?? parseMarkdown(content)
    const existingMtime = …
    const created = …
    const updated = …
    const dated = …
    const tasks: TaskItem[] = rawTasks.map((t) => ({
      ...t,
      dueDate: t.dueDate ?? dated,
      completedDate: t.checked ? (t.completedDate ?? dated) : null,
    }))
    const fmTags = extractTags(frontmatter.tags)
    fields = {
      …
      dated,
      tasks,
    }
```

改为

```ts
    const { outLinks, inlineTags, lists } = cmParsed ?? parseMarkdown(content)
    const existingMtime = vaultStore.files[path]?.mtime ?? Date.now()
    const created =
      extractDateString(frontmatter.created) ??
      new Date(existingMtime).toISOString().slice(0, 10)
    const updated = extractDateString(frontmatter.updated) ?? null
    const dated = extractDateString(frontmatter.dated) ?? created
    const fmTags = extractTags(frontmatter.tags)
    fields = {
      frontmatter,
      outLinks,
      etags: [...new Set([...fmTags, ...inlineTags])],
      tags: mergeTagsWithBody(fmTags, inlineTags),
      aliases: extractAliases(frontmatter.aliases),
      created,
      updated,
      dated,
      lists,
    }
```

- 第 244 行 `applyFileTasks(path, fields.tasks)` 改为 `applyFileTasks(path, fields.lists)`。
- 第 374/411/454/534 等 4 处构造完整 FileMeta 的 `tasks: []` 改为 `lists: []`。
- 若 `TaskItem` import 现已无用，删除该 import 行。

- [ ] **Step 5: 跑 vault 相关测试**

Run: `npx vitest run src/vault/__tests__`
Expected: PASS（scan / indexStorage / loadProgress）

- [ ] **Step 6: 提交**

```bash
git add src/vault/indexStorage.ts src/vault/scan.ts src/vault/index.ts src/vault/tasks.ts
git commit -m "feat(lists): index FileMeta.lists, derive taskMap from task subset"
```

---

## Task 4: 消费方迁移（dashboard / calendar）+ 测试夹具

**Files:**
- Modify: `src/plugins/dashboard/dashboardUtils.ts:42-67`
- Modify: `src/plugins/dashboard/DashboardViewer.tsx:212,217`
- Modify: `src/plugins/calendar/calendarUtils.ts:1-3,92-101`
- Modify: `src/plugins/calendar/CalendarViewer.tsx:162,171,207`
- Modify: `src/lib/__tests__/knowledgeUtils.test.ts:5-13`
- Modify: `src/plugins/dashboard/__tests__/dashboardUtils.test.ts:11-24`

- [ ] **Step 1: `src/plugins/dashboard/dashboardUtils.ts`**

把第 42–44 的类型从 `TaskItem` 换 `ListItem`：

```ts
import type { ListItem } from '../../stores/types'

export type WeekTask = ListItem & { path: string }
```

`buildWeekTaskData` 签名与逻辑：把 `Record<string, TaskItem[]>` 改 `Record<string, ListItem[]>`（函数体不变，已读 `task.fields['due']`）：

```ts
export function buildWeekTaskData(
  taskMap: Record<string, ListItem[]>,
): Record<string, WeekTask[]> {
```

- [ ] **Step 2: `src/plugins/dashboard/DashboardViewer.tsx`**

第 212、217 行 `task.cleanText` → `task.visual`（`title={task.visual}` 与正文 `{task.visual}`）。

- [ ] **Step 3: `src/plugins/calendar/calendarUtils.ts`**

第 1–3 行：

```ts
import type { ListItem, FileMeta } from '../../stores/types'

export type Task = ListItem & { path: string }
```

第 92–101 行 `buildTaskDayData`：改为接收 `files` 并用 `fields['due'] ?? 文件 dated` 作回退（复刻原 `dueDate ?? dated` 行为）：

```ts
export function buildTaskDayData(
  taskMap: Record<string, ListItem[]>,
  files: Record<string, FileMeta>,
): Record<string, Task[]> {
  const map: Record<string, Task[]> = {}
  for (const [path, tasks] of Object.entries(taskMap)) {
    const fallback = files[path]?.dated ?? null
    for (const task of tasks) {
      const due = task.fields['due'] ?? fallback
      if (!due) continue
      ;(map[due] ??= []).push({ ...task, path })
    }
  }
  return map
}
```

- [ ] **Step 4: `src/plugins/calendar/CalendarViewer.tsx`**

第 162、171 行 `item.task.cleanText` → `item.task.visual`。

第 207 行调用补上 `vaultStore.files`：

```ts
  const taskDayData = createDeferred(() => buildTaskDayData(vaultStore.taskMap, vaultStore.files))
```

- [ ] **Step 5: 修测试夹具 `src/lib/__tests__/knowledgeUtils.test.ts`**

第 5–13 行两个 `TaskItem` 夹具换成 `ListItem`（去掉 dueDate/completedDate/cleanText，补 visual/symbol/lineCount/signifier/task）：

```ts
import type { ListItem } from '../../stores/types'

const task1: ListItem = {
  text: 'buy milk', visual: 'buy milk', line: 0, lineCount: 1,
  symbol: '-', signifier: null, status: ' ', checked: false, task: true, fields: {}, tags: [],
}
const task2: ListItem = {
  text: 'done', visual: 'done', line: 1, lineCount: 1,
  symbol: '-', signifier: null, status: 'x', checked: true, task: true, fields: {}, tags: [],
}
```

（`buildTaskMap` 现在按 `task` 过滤，夹具 `task: true` 才会被收。其余断言不变。）

- [ ] **Step 6: 修测试夹具 `src/plugins/dashboard/__tests__/dashboardUtils.test.ts`**

第 11–24 行 `makeTask` 换成产出 `ListItem`：

```ts
import type { ListItem } from '../../../stores/types'

function makeTask(overrides: Partial<ListItem> = {}): ListItem {
  return {
    text: 'do thing',
    visual: 'do thing',
    line: 0,
    lineCount: 1,
    symbol: '-',
    signifier: null,
    status: ' ',
    checked: false,
    task: true,
    fields: {},
    tags: [],
    ...overrides,
  }
}
```

（若该文件内有断言读 `cleanText`/`dueDate`，相应改 `visual`/`fields['due']`。）

- [ ] **Step 7: 跑全量测试**

Run: `npx vitest run`
Expected: PASS（全部）

- [ ] **Step 8: 提交**

```bash
git add src/plugins/dashboard/ src/plugins/calendar/ src/lib/__tests__/knowledgeUtils.test.ts
git commit -m "refactor(lists): migrate dashboard/calendar consumers to ListItem"
```

---

## Task 5: 类型/构建总闸 + 收尾

**Files:** 视报错而定（应只剩零散 `TaskItem`/`cleanText`/`tasks` 残留）

- [ ] **Step 1: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。若报错，定位残留的 `TaskItem` 引用、`.cleanText`、`fields.tasks`、`tasks:` 字面量并按 ListItem 模型修正。

- [ ] **Step 2: 构建**

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 3: 全量测试**

Run: `npx vitest run`
Expected: PASS（全部）。

- [ ] **Step 4: 手动验证（可选但建议）**

Run: `npm run dev`，打开一个含任务、普通列表、`- * 事件`、`- = 心情`、`- ! 重要` 的笔记。
Expected: 编辑器照常工作（本期无新渲染）；dashboard 周网格、calendar 仍正确显示任务（按 due/文件日期归位）；任务勾选与字段自动补全仍正常。

- [ ] **Step 5: 提交（若 Step 1–3 有改动）**

```bash
git add -A
git commit -m "fix(lists): finalize ListItem migration (tsc/build green)"
```

---

## 完成标准

- `FileMeta.lists` 收录全部列表项（任务/普通/信号字符/有序），每项带 `text`/`visual`/`line`/`lineCount`/`symbol`/`signifier`/`status`/`checked`/`task`/`fields`/`tags`。
- `taskMap` 由 `lists.filter(task)` 派生；dashboard/calendar 行为与改造前一致（任务按 `[due::]` 或文件日期归位，文本用 `visual`）。
- 旧缓存缺 `lists` 时自动重解析。
- `npx vitest run`、`npx tsc --noEmit`、`npm run build` 全绿。
- 信号字符仅被索引、未渲染/未过滤（留待第二期）。
