import { syntaxTree } from '@codemirror/language'
import { StateField } from '@codemirror/state'
import type { EditorState } from '@codemirror/state'
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
