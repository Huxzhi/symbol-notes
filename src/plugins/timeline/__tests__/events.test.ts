import { describe, it, expect } from 'vitest'
import { deriveEvents } from '../events'
import type { SelectionResult } from '../selection'

const files = {
  'a.md': { created: '2026-02-01', updated: '2026-02-20', tags: ['proj'] },
  'b.md': { created: '2026-02-05', updated: null, tags: [] },
  'c.md': { created: '2026-02-03', updated: '2026-02-04', tags: ['x'] },
}
const selection: SelectionResult = {
  paths: ['a.md', 'b.md', 'c.md'],
  edges: [
    { from: 'a.md', to: 'b.md' },
    { from: 'c.md', to: 'a.md' },
  ],
}

describe('deriveEvents', () => {
  it('按 created 升序排序', () => {
    const evs = deriveEvents(selection, files)
    expect(evs.map((e) => e.path)).toEqual(['a.md', 'c.md', 'b.md'])
  })

  it('有 updated → 生成 span；无 updated → 无 span', () => {
    const evs = deriveEvents(selection, files)
    const a = evs.find((e) => e.path === 'a.md')!
    const b = evs.find((e) => e.path === 'b.md')!
    expect(a.span).toEqual(['2026-02-01', '2026-02-20'])
    expect(b.span).toBeUndefined()
  })

  it('title 为 path 的 stem（去 .md）', () => {
    const evs = deriveEvents(selection, files)
    expect(evs.find((e) => e.path === 'a.md')!.title).toBe('a')
  })

  it('linkCount = 选区内触及该 path 的边数', () => {
    const evs = deriveEvents(selection, files)
    expect(evs.find((e) => e.path === 'a.md')!.linkCount).toBe(2) // a→b 与 c→a
    expect(evs.find((e) => e.path === 'b.md')!.linkCount).toBe(1)
  })

  it('date = created，kind = note', () => {
    const evs = deriveEvents(selection, files)
    const a = evs.find((e) => e.path === 'a.md')!
    expect(a.date).toBe('2026-02-01')
    expect(a.kind).toBe('note')
  })

  it('跳过选区中已不在 files 的路径', () => {
    const sel: SelectionResult = { paths: ['a.md', 'gone.md'], edges: [] }
    const evs = deriveEvents(sel, files)
    expect(evs.map((e) => e.path)).toEqual(['a.md'])
  })
})
