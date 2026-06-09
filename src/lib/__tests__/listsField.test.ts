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
    // from 落在 `[` 之后，使过滤文本为空、整列可见
    expect(res!.from).toBe(doc.length)
  })

  it('field source filters by typed key prefix', () => {
    const doc = '- [ ] task [du'
    const res = fieldCompletionSource(ctxAt(doc, doc.length))
    expect(res).not.toBeNull()
    expect(res!.from).toBe(doc.indexOf('[du') + 1) // 仍在 `[` 之后
    expect(res!.options.map((o) => o.label)).toEqual(['due', 'completion', 'priority'])
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

  it('value source skips the space after :: so the value lands after it', () => {
    const doc = '- [ ] task [due:: '
    const res = valueCompletionSource(ctxAt(doc, doc.length))
    expect(res).not.toBeNull()
    expect(res!.from).toBe(doc.length) // 落在空格之后，而非紧贴 ::
    expect(res!.options.map((o) => o.label)).toContain('今天')
  })

  it('value source returns null when not after a field', () => {
    const doc = '- [ ] task'
    expect(valueCompletionSource(ctxAt(doc, doc.length))).toBeNull()
  })

  it('taskFieldComplete is a defined extension', () => {
    expect(taskFieldComplete).toBeDefined()
  })
})
