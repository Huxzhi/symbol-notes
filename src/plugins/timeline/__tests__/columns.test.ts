import { describe, it, expect } from 'vitest'
import { assignColumns, type Column } from '../columns'
import type { Edge } from '../selection'

const e = (over: Partial<Edge>): Edge => ({
  from: 'x', to: 'y', dir: 'out', headingPath: [], lineTags: [], ...over,
})

describe('assignColumns', () => {
  const edges = new Map<string, Edge[]>([
    ['B.md', [e({ headingPath: ['计划'] })]],
    ['C.md', [e({ lineTags: ['想法'], dir: 'in' })]],
  ])
  const notes = ['B.md', 'C.md']

  it('null 过滤列收全部', () => {
    const cols: Column[] = [{ filter: null, priority: 0, repeat: false }]
    expect(assignColumns(notes, edges, cols)).toEqual([['B.md', 'C.md']])
  })

  it('按标题过滤', () => {
    const cols: Column[] = [
      { filter: { by: 'heading', value: '计划' }, priority: 0, repeat: false },
      { filter: null, priority: 1, repeat: false },
    ]
    const [c0, c1] = assignColumns(notes, edges, cols)
    expect(c0).toEqual(['B.md'])
    expect(c1).toEqual(['C.md'])   // B 被高优先级收走，不重复
  })

  it('repeat=true 允许重复', () => {
    const cols: Column[] = [
      { filter: { by: 'heading', value: '计划' }, priority: 0, repeat: false },
      { filter: null, priority: 1, repeat: true },
    ]
    const [, c1] = assignColumns(notes, edges, cols)
    expect(c1).toEqual(['B.md', 'C.md'])
  })

  it('按方向过滤', () => {
    const cols: Column[] = [{ filter: { by: 'direction', value: 'in' }, priority: 0, repeat: false }]
    expect(assignColumns(notes, edges, cols)).toEqual([['C.md']])
  })
})
