import { describe, it, expect } from 'vitest'
import { buildGrid } from '../grid'
import type { TimelineEvent } from '../events'
import type { Edge } from '../selection'
import type { Column } from '../columns'

const ev = (path: string, date: string): TimelineEvent => ({
  path, date, title: path, tags: [], linkCount: 0, kind: 'note',
})
const edge = (from: string, to: string): Edge => ({
  from, to, dir: 'out', headingPath: [], lineTags: [],
})
const isDiary = (p: string) => /\d{4}-\d{2}-\d{2}/.test(p)

describe('buildGrid', () => {
  const events = [
    ev('2026-06-20.md', '2026-06-20'),
    ev('plan.md', '2026-06-20'),
    ev('reflect.md', '2026-06-22'),
  ]
  const columns: Column[] = [
    { filter: { by: 'heading', value: '计划' }, priority: 1, repeat: false }, // col 0（左）
    { filter: { by: 'diary' }, priority: 0, repeat: false },                  // col 1（中）
    { filter: null, priority: 2, repeat: false },                             // col 2（右）
  ]
  const edges = [edge('plan.md', '2026-06-20.md'), edge('plan.md', 'gone.md')]

  it('rows = 可见事件日期并集且升序', () => {
    const g = buildGrid(events, columns, edges, isDiary)
    expect(g.rows).toEqual(['2026-06-20', '2026-06-22'])
  })

  it('日记进 diary 列（col 1），列索引=数组次序', () => {
    const g = buildGrid(events, columns, edges, isDiary)
    expect(g.cells.get('2026-06-20')?.get(1)?.map(e => e.path)).toEqual(['2026-06-20.md'])
  })

  it('非日记落入匹配/兜底列', () => {
    const g = buildGrid(events, columns, edges, isDiary)
    // plan.md 无标题上下文 → 不匹配 col0(计划)，落 col2(全部)
    expect(g.cells.get('2026-06-20')?.get(2)?.map(e => e.path)).toEqual(['plan.md'])
    expect(g.cells.get('2026-06-22')?.get(2)?.map(e => e.path)).toEqual(['reflect.md'])
  })

  it('arrows 仅含 out 且两端可见的边', () => {
    const g = buildGrid(events, columns, edges, isDiary)
    expect(g.arrows).toEqual([{ from: 'plan.md', to: '2026-06-20.md' }]) // gone.md 不可见被剔除
  })
})
