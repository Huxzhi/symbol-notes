import { syntaxTree } from '@codemirror/language'
import { StateField } from '@codemirror/state'
import type { EditorState } from '@codemirror/state'
import {
  autocompletion,
  startCompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import type { TaskItem } from '../../stores/types'

const INLINE_FIELD_RE = /\[([^\]]+?)::([^\]]*)\]/g
// Matches list task markers not handled by GFM: - [/], - [-], - [>] etc.
const NONSTANDARD_TASK_RE = /^[-*+] \[([^ x])\] /

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

function parseInlineFields(text: string): { fields: Record<string, string>; cleanText: string } {
  const fields: Record<string, string> = {}
  INLINE_FIELD_RE.lastIndex = 0
  const cleanText = text.replace(INLINE_FIELD_RE, (_, key: string, val: string) => {
    fields[key.trim()] = val.trim()
    return ''
  }).replace(/\s+/g, ' ').trim()
  return { fields, cleanText }
}

function buildTask(status: string, markerEnd: number, state: EditorState): TaskItem {
  const line = state.doc.lineAt(markerEnd)
  const rawText = state.doc.sliceString(markerEnd, line.to).trim()
  const { fields, cleanText } = parseInlineFields(rawText)
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
}

function extractTasks(state: EditorState): TaskItem[] {
  const tasks: TaskItem[] = []

  // Collect code block ranges to skip
  const codeRanges: [number, number][] = []
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
        codeRanges.push([node.from, node.to])
        return false
      }
      // GFM standard: [ ] and [x]/[X]
      if (node.name === 'TaskMarker') {
        const status = state.doc.sliceString(node.from + 1, node.to - 1)
        tasks.push(buildTask(status, node.to, state))
      }
    },
  })

  // Non-standard status chars ([/] [-] [>] etc.) — regex scan, skip code ranges
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i)
    const inCode = codeRanges.some(([f, t]) => line.from >= f && line.from < t)
    if (inCode) continue
    const m = NONSTANDARD_TASK_RE.exec(line.text)
    if (m) {
      const markerEnd = line.from + m[0].length
      tasks.push(buildTask(m[1], markerEnd, state))
    }
  }

  // Sort by position so tasks appear in document order
  tasks.sort((a, b) => a.line - b.line)

  return tasks
}

export const tasksField = StateField.define<TaskItem[]>({
  create: extractTasks,
  update(tasks, tr) {
    if (tr.docChanged) return extractTasks(tr.state)
    return tasks
  },
})

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

/**
 * 任务行内输入 `[`（非 `[[`）→ 字段补全：due/completion/priority。
 * 关键：result.from 必须落在 `[` 之后——补全列表用 from..cursor 之间的文本做过滤，
 * 若把 `[` 算进去，"["` 不匹配任何字段标签，下拉会被全部过滤掉而不显示。
 * 匹配 `\[\w*` 让用户输入字段名时仍能继续按前缀过滤。
 */
export function fieldCompletionSource(ctx: CompletionContext): CompletionResult | null {
  const line = ctx.state.doc.lineAt(ctx.pos)
  if (!isTaskLine(line.text)) return null
  const match = ctx.matchBefore(/\[\w*$/)
  if (!match) return null
  const bracket = match.from // `[` 的位置
  // 排除 wikilink `[[`：`[` 前一字符不能是 `[`
  if (bracket > 0 && ctx.state.sliceDoc(bracket - 1, bracket) === '[') return null
  return {
    from: bracket + 1, // `[` 之后
    options: FIELD_KEYS.map((key) => ({
      label: key,
      type: 'property',
      apply: (view: EditorView, _c: unknown, from: number, to: number) => {
        const insert = `${key}:: ]` // `[` 已在文档中；`::` 后留一个空格（Dataview 习惯）
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: from + insert.length - 1 }, // 落在 `]` 前（即空格之后）
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
  let valueStart = match.from + match.text.indexOf('::') + 2
  // 跳过 `::` 后的空格，让插入的值落在空格之后：[due:: 2026-05-21]
  while (ctx.state.sliceDoc(valueStart, valueStart + 1) === ' ') valueStart++
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
