import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { tasksField, isTaskLine, offsetISO, todayISO, nextMondayISO, completionLineEdit, taskFieldComplete, fieldCompletionSource, valueCompletionSource } from '../cm6/tasksField'
import { CompletionContext } from '@codemirror/autocomplete'

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
