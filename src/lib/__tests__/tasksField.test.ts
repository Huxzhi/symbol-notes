import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { tasksField } from '../cm6/tasksField'

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
