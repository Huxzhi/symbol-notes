import { describe, it, expect } from 'vitest'
import { buildNeighborhood } from '../selection'
import type { WikiLinkInfo } from '../../../stores/types'

const link = (target: string, ctx: Partial<WikiLinkInfo> = {}): WikiLinkInfo => ({
  target, headingPath: [], lineTags: [], from: 0, to: 0, ...ctx,
})

describe('buildNeighborhood', () => {
  const files = {
    'A.md': { outLinks: [link('B.md', { headingPath: ['计划'] })] },
    'B.md': { outLinks: [link('C.md')] },
    'C.md': { outLinks: [] as WikiLinkInfo[] },
    'D.md': { outLinks: [link('A.md', { lineTags: ['想法'] })] },
  }
  const backlinkMap = { 'A.md': ['D.md'], 'B.md': ['A.md'], 'C.md': ['B.md'] }
  const resolve = (t: string) => (t in files ? t : null)

  it('从 focus 无向 BFS，记录 hop 与方向/上下文', () => {
    const n = buildNeighborhood('A.md', files, backlinkMap, resolve, { maxFiles: 99 })
    const paths = n.notes.map(x => x.path).sort()
    expect(paths).toEqual(['A.md', 'B.md', 'C.md', 'D.md'])
    expect(n.notes.find(x => x.path === 'A.md')!.hop).toBe(0)
    expect(n.notes.find(x => x.path === 'C.md')!.hop).toBe(2)
    const ab = n.edges.find(e => e.from === 'A.md' && e.to === 'B.md')!
    expect(ab.dir).toBe('out')
    expect(ab.headingPath).toEqual(['计划'])
    const da = n.edges.find(e => e.from === 'D.md' && e.to === 'A.md')!
    expect(da.dir).toBe('in')
    expect(da.lineTags).toEqual(['想法'])
  })

  it('整层预算：超过 maxFiles 后不再扩下一层', () => {
    const n = buildNeighborhood('A.md', files, backlinkMap, resolve, { maxFiles: 2 })
    // 第 0 层 {A}=1 < 2，扩第 1 层 {B,D} → 累计 3 ≥ 2，停止；C 不应进入
    expect(n.notes.map(x => x.path).sort()).toEqual(['A.md', 'B.md', 'D.md'])
  })

  it('焦点不存在时返回空', () => {
    const n = buildNeighborhood('zzz.md', files, backlinkMap, resolve, { maxFiles: 99 })
    expect(n).toEqual({ notes: [], edges: [] })
  })
})

describe('buildNeighborhood isDiary 跳过展开', () => {
  const files = {
    'A.md': { outLinks: [link('2026-06-20.md')] },
    '2026-06-20.md': { outLinks: [link('Z.md')] }, // 日记的出链 Z 不应被展开
    'Z.md': { outLinks: [] as WikiLinkInfo[] },
  }
  const backlinkMap = { '2026-06-20.md': ['A.md'], 'Z.md': ['2026-06-20.md'] }
  const resolve = (t: string) => (t in files ? t : null)
  const isDiary = (p: string) => /\d{4}-\d{2}-\d{2}/.test(p)

  it('日记被收下但不展开 → Z 不进邻域；指向日记的边保留', () => {
    const n = buildNeighborhood('A.md', files, backlinkMap, resolve, { maxFiles: 99, isDiary })
    expect(n.notes.map((x) => x.path).sort()).toEqual(['2026-06-20.md', 'A.md'])
    expect(n.edges.some((e) => e.from === 'A.md' && e.to === '2026-06-20.md')).toBe(true)
  })
})
