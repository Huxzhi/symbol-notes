# 任务行字段自动补全 + 勾选自动补完成日期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 CM6 编辑器的任务行内输入 `[` 触发字段→值两级自动补全（due/completion/priority），并在勾选任务时自动补/删完成日期。

**Architecture:** 所有补全逻辑（补全源、日期/任务行辅助、勾选行尾编辑纯函数）集中进现有 `src/lib/cm6/tasksField.ts`，用 `@codemirror/autocomplete` 的 `autocompletion({ override })` 注册两个链式补全源。解析器扩展出 `priority` 字段。勾选行为改在 `livePreviewExtension.ts` 的 `CheckboxWidget`，复用 `tasksField.ts` 导出的纯函数。

**Tech Stack:** TypeScript、SolidJS、CodeMirror 6（`@codemirror/autocomplete` 6.20.2，已存在于 node_modules）、Vitest。

参考 spec：`docs/superpowers/specs/2026-06-09-task-field-autocomplete-design.md`

---

## 文件结构

- 修改 `package.json` — 新增显式依赖 `@codemirror/autocomplete`
- 修改 `src/stores/types.ts` — `TaskItem` 加 `priority`
- 修改 `src/lib/cm6/tasksField.ts` — 解析器加 priority；新增日期/任务行辅助、勾选行尾纯函数、两个补全源、`taskFieldComplete` 扩展
- 修改 `src/lib/cm6/livePreviewExtension.ts` — `CheckboxWidget` 勾选时自动补/删完成日期
- 修改 `src/plugins/editor/EditorViewer.tsx` — 把 `taskFieldComplete` 加进 extensions
- 修改 `src/lib/__tests__/tasksField.test.ts` — 扩展全部新单测

---

## Task 1: 解析器支持 priority 字段

**Files:**
- Modify: `src/stores/types.ts:61-70`（`TaskItem`）
- Modify: `src/lib/cm6/tasksField.ts:20-34`（`buildTask`）
- Test: `src/lib/__tests__/tasksField.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/lib/__tests__/tasksField.test.ts` 的 `describe('tasksField', …)` 内追加：

```ts
  it('extracts priority inline field', () => {
    const tasks = parse('- [ ] Task [priority::high]')
    expect(tasks[0].priority).toBe('high')
    expect(tasks[0].fields).toMatchObject({ priority: 'high' })
  })

  it('priority is null when absent', () => {
    const tasks = parse('- [ ] Task')
    expect(tasks[0].priority).toBeNull()
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/__tests__/tasksField.test.ts -t priority`
Expected: FAIL（`priority` 属性不存在，值为 `undefined` 而非 `'high'`/`null`）

- [ ] **Step 3: TaskItem 加字段**

在 `src/stores/types.ts` 的 `TaskItem` 接口里，`completedDate` 行之后、`fields` 行之前插入：

```ts
  priority: string | null         // [priority::high|medium|low] → null when absent
```

- [ ] **Step 4: buildTask 填充 priority**

在 `src/lib/cm6/tasksField.ts` 的 `buildTask` 返回对象里，`completedDate` 行之后加一行：

```ts
    priority: fields['priority'] ?? null,
```

返回对象变成：

```ts
  return {
    text: rawText,
    cleanText,
    checked: status === 'x' || status === 'X',
    status,
    line: line.number - 1,
    dueDate: fields['due'] ?? null,
    completedDate: fields['completion'] ?? null,
    priority: fields['priority'] ?? null,
    fields,
  }
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run src/lib/__tests__/tasksField.test.ts`
Expected: PASS（全部用例，含新加的两个 priority 用例）

- [ ] **Step 6: 提交**

```bash
git add src/stores/types.ts src/lib/cm6/tasksField.ts src/lib/__tests__/tasksField.test.ts
git commit -m "feat(tasks): parse [priority::] inline field into TaskItem.priority"
```

---

## Task 2: 日期与任务行辅助函数

**Files:**
- Modify: `src/lib/cm6/tasksField.ts`（文件顶部，`import` 之后、`INLINE_FIELD_RE` 之前新增）
- Test: `src/lib/__tests__/tasksField.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/lib/__tests__/tasksField.test.ts` 顶部 import 行追加导入（与现有 `import { tasksField } from '../cm6/tasksField'` 合并为同一行的命名导入）：

```ts
import { tasksField, isTaskLine, offsetISO, todayISO, nextMondayISO } from '../cm6/tasksField'
```

文件末尾追加新 `describe`：

```ts
describe('date helpers', () => {
  // 2026-06-09 是周二
  const base = new Date(2026, 5, 9)

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
    expect(nextMondayISO(base)).toBe('2026-06-15') // 周二 → 下周一
    expect(nextMondayISO(new Date(2026, 5, 15))).toBe('2026-06-22') // 周一 → +7
    expect(nextMondayISO(new Date(2026, 5, 14))).toBe('2026-06-15') // 周日 → +1
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/__tests__/tasksField.test.ts`
Expected: FAIL（`isTaskLine`/`offsetISO`/`todayISO`/`nextMondayISO` 未导出）

- [ ] **Step 3: 实现辅助函数**

在 `src/lib/cm6/tasksField.ts` 顶部，现有 import 之后、`const INLINE_FIELD_RE` 之前插入：

```ts
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/lib/__tests__/tasksField.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/cm6/tasksField.ts src/lib/__tests__/tasksField.test.ts
git commit -m "feat(tasks): add isTaskLine and ISO date helpers in tasksField"
```

---

## Task 3: 勾选行尾编辑纯函数 completionLineEdit

**Files:**
- Modify: `src/lib/cm6/tasksField.ts`（接 Task 2 辅助函数之后）
- Test: `src/lib/__tests__/tasksField.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/lib/__tests__/tasksField.test.ts` 顶部导入行追加 `completionLineEdit`：

```ts
import { tasksField, isTaskLine, offsetISO, todayISO, nextMondayISO, completionLineEdit } from '../cm6/tasksField'
```

文件末尾追加：

```ts
describe('completionLineEdit', () => {
  it('appends completion field when checking a task without one', () => {
    expect(completionLineEdit('- [ ] task', true, '2026-06-09')).toEqual({
      append: ' [completion::2026-06-09]',
    })
  })
  it('does nothing when checking a task that already has completion', () => {
    expect(completionLineEdit('- [ ] task [completion::2026-01-01]', true, '2026-06-09')).toEqual({})
  })
  it('removes completion field (with leading space) when unchecking', () => {
    const text = '- [x] task [completion::2026-06-09]'
    const r = completionLineEdit(text, false, '2026-06-09')
    expect(r.remove).toEqual({ from: text.indexOf(' [completion'), to: text.length })
  })
  it('does nothing when unchecking a task without completion', () => {
    expect(completionLineEdit('- [x] task', false, '2026-06-09')).toEqual({})
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/__tests__/tasksField.test.ts -t completionLineEdit`
Expected: FAIL（`completionLineEdit` 未导出）

- [ ] **Step 3: 实现纯函数**

在 `src/lib/cm6/tasksField.ts` 的 `nextMondayISO` 之后插入：

```ts
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/lib/__tests__/tasksField.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/cm6/tasksField.ts src/lib/__tests__/tasksField.test.ts
git commit -m "feat(tasks): add completionLineEdit for checkbox toggle line edits"
```

---

## Task 4: 两级补全源与 taskFieldComplete 扩展

**Files:**
- Modify: `package.json`（dependencies）
- Modify: `src/lib/cm6/tasksField.ts`（文件末尾新增补全源与扩展；顶部加 import）
- Test: `src/lib/__tests__/tasksField.test.ts`

- [ ] **Step 1: 加显式依赖**

在 `package.json` 的 `dependencies` 中，`@codemirror/view` 行之后（保持字母序前的现有顺序即可）加入：

```json
    "@codemirror/autocomplete": "^6.20.2",
```

（包已存在于 node_modules，无需重新安装；如需校验运行 `npm ls @codemirror/autocomplete`。）

- [ ] **Step 2: 写失败测试**

在 `src/lib/__tests__/tasksField.test.ts` 顶部追加导入：

```ts
import { taskFieldComplete, fieldCompletionSource, valueCompletionSource } from '../cm6/tasksField'
import { CompletionContext } from '@codemirror/autocomplete'
```

文件末尾追加：

```ts
describe('completion sources', () => {
  function ctxAt(doc: string, pos: number) {
    const state = EditorState.create({
      doc,
      extensions: [markdown({ extensions: [GFM] })],
    })
    return new CompletionContext(state, pos, true)
  }

  it('field source lists due/completion/priority after [ on a task line', () => {
    const doc = '- [ ] task ['
    const res = fieldCompletionSource(ctxAt(doc, doc.length))
    expect(res).not.toBeNull()
    expect(res!.options.map((o) => o.label)).toEqual(['due', 'completion', 'priority'])
    expect(res!.from).toBe(doc.length - 1)
  })

  it('field source ignores non-task lines', () => {
    const doc = 'plain text ['
    expect(fieldCompletionSource(ctxAt(doc, doc.length))).toBeNull()
  })

  it('field source ignores wikilink [[', () => {
    const doc = '- [ ] task [['
    expect(fieldCompletionSource(ctxAt(doc, doc.length))).toBeNull()
  })

  it('value source lists priority values after [priority::', () => {
    const doc = '- [ ] task [priority::'
    const res = valueCompletionSource(ctxAt(doc, doc.length))
    expect(res).not.toBeNull()
    expect(res!.options.map((o) => o.label)).toEqual(['high', 'medium', 'low'])
  })

  it('value source lists date options after [due::', () => {
    const doc = '- [ ] task [due::'
    const res = valueCompletionSource(ctxAt(doc, doc.length))
    expect(res).not.toBeNull()
    expect(res!.options.map((o) => o.label)).toContain('今天')
    // 每个日期项插入的是算好的 YYYY-MM-DD
    const today = res!.options.find((o) => o.label === '今天')!
    expect(today.apply).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('value source returns null when not after a field', () => {
    const doc = '- [ ] task'
    expect(valueCompletionSource(ctxAt(doc, doc.length))).toBeNull()
  })

  it('taskFieldComplete is a defined extension', () => {
    expect(taskFieldComplete).toBeDefined()
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run src/lib/__tests__/tasksField.test.ts -t "completion sources"`
Expected: FAIL（`taskFieldComplete`/`fieldCompletionSource`/`valueCompletionSource` 未导出）

- [ ] **Step 4: 实现补全源与扩展**

在 `src/lib/cm6/tasksField.ts` 顶部 import 区追加：

```ts
import {
  autocompletion,
  startCompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
```

在文件末尾（`tasksField` 定义之后）追加：

```ts
// ── Inline-field autocomplete ────────────────────────────────────────────────

const FIELD_KEYS = ['due', 'completion', 'priority'] as const
const PRIORITY_VALUES = ['high', 'medium', 'low'] as const
const VALUE_TRIGGER_RE = /\[(due|completion|priority)::([^\]\n]*)$/

type DateOption = { label: string; resolve: () => string }
const DATE_OPTIONS: DateOption[] = [
  { label: '今天', resolve: () => offsetISO(0) },
  { label: '明天', resolve: () => offsetISO(1) },
  { label: '后天', resolve: () => offsetISO(2) },
  { label: '昨天', resolve: () => offsetISO(-1) },
  { label: '一周后', resolve: () => offsetISO(7) },
  { label: '上周', resolve: () => offsetISO(-7) },
  { label: '下周一', resolve: () => nextMondayISO() },
]

/** 任务行内输入单个 `[`（非 `[[`）→ 字段补全：due/completion/priority。 */
export function fieldCompletionSource(ctx: CompletionContext): CompletionResult | null {
  const line = ctx.state.doc.lineAt(ctx.pos)
  if (!isTaskLine(line.text)) return null
  const match = ctx.matchBefore(/\[$/)
  if (!match) return null
  // 排除 wikilink `[[`：`[` 前一字符不能是 `[`
  if (match.from > 0 && ctx.state.sliceDoc(match.from - 1, match.from) === '[') return null
  return {
    from: match.from,
    options: FIELD_KEYS.map((key) => ({
      label: key,
      type: 'property',
      apply: (view: EditorView, _c: unknown, from: number, to: number) => {
        const insert = `[${key}::]`
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: from + insert.length - 1 }, // 落在 `]` 前
        })
        startCompletion(view)
      },
    })),
  }
}

/** 光标在 `[due::|completion::|priority::` 之后 → 值补全（日期 / 优先级）。 */
export function valueCompletionSource(ctx: CompletionContext): CompletionResult | null {
  const line = ctx.state.doc.lineAt(ctx.pos)
  if (!isTaskLine(line.text)) return null
  const match = ctx.matchBefore(VALUE_TRIGGER_RE)
  if (!match) return null
  const m = VALUE_TRIGGER_RE.exec(match.text)
  if (!m) return null
  const field = m[1]
  const valueStart = match.from + match.text.indexOf('::') + 2
  if (field === 'priority') {
    return {
      from: valueStart,
      options: PRIORITY_VALUES.map((v) => ({ label: v, type: 'enum' })),
    }
  }
  return {
    from: valueStart,
    options: DATE_OPTIONS.map((opt) => {
      const date = opt.resolve()
      return { label: opt.label, detail: date, apply: date, type: 'text' }
    }),
  }
}

export const taskFieldComplete = autocompletion({
  override: [fieldCompletionSource, valueCompletionSource],
  activateOnTyping: true,
})
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run src/lib/__tests__/tasksField.test.ts`
Expected: PASS（含 completion sources 全部用例）

- [ ] **Step 6: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 7: 提交**

```bash
git add package.json src/lib/cm6/tasksField.ts src/lib/__tests__/tasksField.test.ts
git commit -m "feat(tasks): two-stage inline-field autocomplete (field + value)"
```

---

## Task 5: 接入编辑器扩展

**Files:**
- Modify: `src/plugins/editor/EditorViewer.tsx:25`（import）和 `:65-85`（extensions 数组）

- [ ] **Step 1: 改 import**

把 `src/plugins/editor/EditorViewer.tsx` 第 25 行：

```ts
import { tasksField } from '../../lib/cm6/tasksField'
```

改为：

```ts
import { tasksField, taskFieldComplete } from '../../lib/cm6/tasksField'
```

- [ ] **Step 2: 加进 extensions**

在 `buildEditorState` 的 extensions 数组里，`tasksField,` 这一行之后插入：

```ts
      taskFieldComplete,
```

- [ ] **Step 3: 类型检查 + 构建**

Run: `npx tsc --noEmit && npm run build`
Expected: 无错误，构建成功

- [ ] **Step 4: 手动验证**

Run: `npm run dev`，打开任一笔记，在新行输入 `- [ ] 测试 ` 然后输入 `[`。
Expected: 弹出 `due` / `completion` / `priority` 三项；选 `due` 后自动弹出 `今天/明天/…`；选 `今天` 得到 `[due::2026-06-09]`。在普通文本行输入 `[` 不弹；输入 `[[` 不弹字段补全。

- [ ] **Step 5: 提交**

```bash
git add src/plugins/editor/EditorViewer.tsx
git commit -m "feat(editor): wire taskFieldComplete into the editor"
```

---

## Task 6: 勾选任务自动补/删完成日期

**Files:**
- Modify: `src/lib/cm6/livePreviewExtension.ts:1-14`（import）和 `:37-53`（`CheckboxWidget.toDOM` 的 mousedown）

- [ ] **Step 1: 加 import**

在 `src/lib/cm6/livePreviewExtension.ts` 顶部 import 区（`import { detectFrontmatter } from './frontmatterField'` 之后）加入：

```ts
import { completionLineEdit, todayISO } from './tasksField'
```

- [ ] **Step 2: 改 mousedown 逻辑**

把 `CheckboxWidget.toDOM` 里的 mousedown 监听（当前 42-51 行）：

```ts
    el.addEventListener('mousedown', (e) => {
      e.preventDefault()
      view.dispatch({
        changes: {
          from: this.markerFrom,
          to: this.markerFrom + 3,
          insert: this.checked ? '[ ]' : '[x]',
        },
      })
    })
```

替换为：

```ts
    el.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const willCheck = !this.checked
      const line = view.state.doc.lineAt(this.markerFrom)
      const changes: { from: number; to: number; insert: string }[] = [
        {
          from: this.markerFrom,
          to: this.markerFrom + 3,
          insert: willCheck ? '[x]' : '[ ]',
        },
      ]
      const edit = completionLineEdit(line.text, willCheck, todayISO())
      if (edit.append) {
        changes.push({ from: line.to, to: line.to, insert: edit.append })
      } else if (edit.remove) {
        changes.push({
          from: line.from + edit.remove.from,
          to: line.from + edit.remove.to,
          insert: '',
        })
      }
      view.dispatch({ changes })
    })
```

- [ ] **Step 3: 类型检查 + 构建**

Run: `npx tsc --noEmit && npm run build`
Expected: 无错误，构建成功

- [ ] **Step 4: 手动验证**

Run: `npm run dev`。准备一行 `- [ ] 写报告`，点击复选框勾选。
Expected: 行变为 `- [x] 写报告 [completion::2026-06-09]`（今天）。再次点击取消勾选 → 回到 `- [ ] 写报告`（completion 字段被删除）。已有 completion 的任务勾选不重复追加。

- [ ] **Step 5: 全量回归**

Run: `npx vitest run`
Expected: 全部 PASS

- [ ] **Step 6: 提交**

```bash
git add src/lib/cm6/livePreviewExtension.ts
git commit -m "feat(tasks): auto add/remove completion date on checkbox toggle"
```

---

## 完成标准

- 任务行输入 `[` → 字段补全；选字段 → 值补全（日期/优先级），两级链式。
- 普通行 / `[[` 不触发字段补全。
- 勾选任务自动追加今天的 `[completion::]`，取消勾选删除之。
- `[priority::high]` 被解析进 `TaskItem.priority` 并随 reindex 入索引。
- `npx vitest run` 与 `npx tsc --noEmit && npm run build` 均通过。
