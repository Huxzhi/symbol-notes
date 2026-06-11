import { syntaxTree } from '@codemirror/language'
import { StateField } from '@codemirror/state'
import type { EditorState } from '@codemirror/state'
import {
  startCompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import type { SyntaxNodeRef } from '@lezer/common'
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

