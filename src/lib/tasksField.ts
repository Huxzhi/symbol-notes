import { syntaxTree } from '@codemirror/language'
import { StateField } from '@codemirror/state'
import type { EditorState } from '@codemirror/state'
import type { TaskItem } from '../stores/types'

const INLINE_FIELD_RE = /\[([^\]]+?)::([^\]]*)\]/g
// Matches list task markers not handled by GFM: - [/], - [-], - [>] etc.
const NONSTANDARD_TASK_RE = /^[-*+] \[([^ x])\] /

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
