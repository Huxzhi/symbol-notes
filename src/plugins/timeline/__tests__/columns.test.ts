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

  it('按方向过滤用卡片来源标注 dirs（与边 dir 无关）', () => {
    const dirs = new Map<string, ('out' | 'in')[]>([
      ['B.md', ['out']],
      ['C.md', ['in']],
    ])
    const inCol: Column[] = [{ filter: { by: 'direction', value: 'in' }, priority: 0, repeat: false }]
    expect(assignColumns(notes, edges, inCol, undefined, dirs)).toEqual([['C.md']])
    const outCol: Column[] = [{ filter: { by: 'direction', value: 'out' }, priority: 0, repeat: false }]
    expect(assignColumns(notes, edges, outCol, undefined, dirs)).toEqual([['B.md']])
  })

  it('out/in 并存的卡片同时匹配两个方向列', () => {
    const dirs = new Map<string, ('out' | 'in')[]>([['B.md', ['out', 'in']], ['C.md', ['in']]])
    const cols: Column[] = [
      { filter: { by: 'direction', value: 'out' }, priority: 0, repeat: true },
      { filter: { by: 'direction', value: 'in' }, priority: 1, repeat: true },
    ]
    const [c0, c1] = assignColumns(notes, edges, cols, undefined, dirs)
    expect(c0).toEqual(['B.md'])           // 只有 B 有 out
    expect(c1).toEqual(['B.md', 'C.md'])   // B、C 都有 in（repeat 列各收一份）
  })
})

describe('assignColumns by:diary', () => {
  const edges = new Map<string, Edge[]>()
  const notes = ['journal/2026-06-20.md', 'plan.md']
  const isDiary = (p: string) => /\d{4}-\d{2}-\d{2}/.test(p)

  it('diary 列按 isDiary 归入', () => {
    const cols: Column[] = [
      { filter: { by: 'diary' }, priority: 0, repeat: false },
      { filter: null, priority: 1, repeat: false },
    ]
    const [c0, c1] = assignColumns(notes, edges, cols, isDiary)
    expect(c0).toEqual(['journal/2026-06-20.md'])
    expect(c1).toEqual(['plan.md'])
  })

  it('缺省 isDiary 时 diary 列不匹配', () => {
    const cols: Column[] = [{ filter: { by: 'diary' }, priority: 0, repeat: false }]
    expect(assignColumns(notes, edges, cols)).toEqual([[]])
  })
})
