import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { tasksField, isTaskLine, offsetISO, todayISO, nextMondayISO } from '../cm6/tasksField'

function parse(content: string) {
  const state = EditorState.create({
    doc: content,
    extensions: [markdown({ extensions: [GFM] }), tasksField],
  })
  return state.field(tasksField)
}

describe('tasksField', () => {
  it('extracts an open task', () => {
    const tasks = parse('- [ ] Buy milk')
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      text: 'Buy milk',
      cleanText: 'Buy milk',
      checked: false,
      status: ' ',
      line: 0,
      dueDate: null,
      completedDate: null,
      fields: {},
    })
  })

  it('extracts a completed task', () => {
    const tasks = parse('- [x] Done item')
    expect(tasks[0]).toMatchObject({ checked: true, status: 'x', text: 'Done item' })
  })

  it('extracts custom status character', () => {
    const tasks = parse('- [/] In progress')
    expect(tasks[0]).toMatchObject({ checked: false, status: '/', text: 'In progress' })
  })

  it('extracts due date inline field', () => {
    const tasks = parse('- [ ] Write report [due::2024-05-30]')
    expect(tasks[0].dueDate).toBe('2024-05-30')
    expect(tasks[0].fields).toMatchObject({ due: '2024-05-30' })
    expect(tasks[0].cleanText).toBe('Write report')
  })

  it('extracts completion date inline field', () => {
    const tasks = parse('- [x] Send email [completion::2024-05-26]')
    expect(tasks[0].completedDate).toBe('2024-05-26')
  })

  it('extracts priority inline field', () => {
    const tasks = parse('- [ ] Task [priority::high]')
    expect(tasks[0].priority).toBe('high')
    expect(tasks[0].fields).toMatchObject({ priority: 'high' })
  })

  it('priority is null when absent', () => {
    const tasks = parse('- [ ] Task')
    expect(tasks[0].priority).toBeNull()
  })

  it('extracts multiple inline fields', () => {
    const tasks = parse('- [ ] Task [due::2024-05-30] [project::work]')
    expect(tasks[0].fields).toEqual({ due: '2024-05-30', project: 'work' })
    expect(tasks[0].cleanText).toBe('Task')
  })

  it('returns correct 0-based line number', () => {
    const tasks = parse('# Heading\n\n- [ ] Task on line 2')
    expect(tasks[0].line).toBe(2)
  })

  it('handles multiple tasks', () => {
    const tasks = parse('- [ ] First\n- [x] Second')
    expect(tasks).toHaveLength(2)
    expect(tasks[0].text).toBe('First')
    expect(tasks[1].text).toBe('Second')
  })

  it('ignores plain list items without checkbox', () => {
    const tasks = parse('- Not a task\n- [ ] This is a task')
    expect(tasks).toHaveLength(1)
    expect(tasks[0].text).toBe('This is a task')
  })

  it('skips tasks inside fenced code blocks', () => {
    const tasks = parse('```\n- [ ] Not a task\n```\n\n- [ ] Real task')
    expect(tasks).toHaveLength(1)
    expect(tasks[0].text).toBe('Real task')
  })
})

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
