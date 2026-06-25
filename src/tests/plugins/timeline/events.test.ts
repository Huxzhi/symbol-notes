import { describe, it, expect } from 'vitest'
import { deriveEvents } from '../../../plugins/timeline/events'
import type { Edge, Neighborhood } from '../../../plugins/timeline/selection'

const files = {
  'a.md': { created: '2026-02-01', updated: '2026-02-20', tags: ['proj'] },
  'b.md': { created: '2026-02-05', updated: null, tags: [] },
  'c.md': { created: '2026-02-03', updated: '2026-02-04', tags: ['x'] },
}
const edge = (from: string, to: string): Edge => ({
  from, to, dir: 'out', headingPath: [], lineTags: [],
})
const neighborhood: Neighborhood = {
  notes: [
    { path: 'a.md', hop: 0, dirs: ['out', 'in'] },
    { path: 'b.md', hop: 1, dirs: ['out'] },
    { path: 'c.md', hop: 1, dirs: ['in'] },
  ],
  edges: [edge('a.md', 'b.md'), edge('c.md', 'a.md')],
}

describe('deriveEvents', () => {
  it('按 created 升序排序', () => {
    const evs = deriveEvents(neighborhood, files)
    expect(evs.map((e) => e.path)).toEqual(['a.md', 'c.md', 'b.md'])
  })

  it('有 updated → 生成 span；无 updated → 无 span', () => {
    const evs = deriveEvents(neighborhood, files)
    const a = evs.find((e) => e.path === 'a.md')!
    const b = evs.find((e) => e.path === 'b.md')!
    expect(a.span).toEqual(['2026-02-01', '2026-02-20'])
    expect(b.span).toBeUndefined()
  })

  it('title 为 path 的 stem（去 .md）', () => {
    const evs = deriveEvents(neighborhood, files)
    expect(evs.find((e) => e.path === 'a.md')!.title).toBe('a')
  })

  it('linkCount = 选区内触及该 path 的边数', () => {
    const evs = deriveEvents(neighborhood, files)
    expect(evs.find((e) => e.path === 'a.md')!.linkCount).toBe(2) // a→b 与 c→a
    expect(evs.find((e) => e.path === 'b.md')!.linkCount).toBe(1)
  })

  it('date = created，kind = note', () => {
    const evs = deriveEvents(neighborhood, files)
    const a = evs.find((e) => e.path === 'a.md')!
    expect(a.date).toBe('2026-02-01')
    expect(a.kind).toBe('note')
  })

  it('跳过选区中已不在 files 的路径', () => {
    const nb: Neighborhood = { notes: [{ path: 'a.md', hop: 0, dirs: [] }, { path: 'gone.md', hop: 1, dirs: [] }], edges: [] }
    const evs = deriveEvents(nb, files)
    expect(evs.map((e) => e.path)).toEqual(['a.md'])
  })
})
