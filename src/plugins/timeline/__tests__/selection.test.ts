import { describe, it, expect } from 'vitest'
import { buildSelection } from '../selection'

const files = {
  'a.md': { outLinks: ['b', 'missing'] },
  'b.md': { outLinks: [] },
  'c.md': { outLinks: ['a'] },
}
// resolve：把 wiki 目标按 stem 解析到 .md；'missing' 解析不到
const resolve = (t: string) => (`${t}.md` in files ? `${t}.md` : null)
const backlinkMap = { 'a.md': ['c.md'] } // c 链接到 a

describe('buildSelection', () => {
  it('1 跳邻域 = 焦点 + 出链(已解析且存在) + 反链', () => {
    const r = buildSelection('a.md', files, backlinkMap, resolve)
    expect([...r.paths].sort()).toEqual(['a.md', 'b.md', 'c.md'])
  })

  it('忽略解析不到或不存在的出链目标', () => {
    const r = buildSelection('a.md', files, backlinkMap, resolve)
    expect(r.paths).not.toContain('missing.md')
    expect(r.paths).not.toContain('missing')
  })

  it('边：焦点→出链、反链→焦点；去重', () => {
    const r = buildSelection('a.md', files, backlinkMap, resolve)
    expect(r.edges).toContainEqual({ from: 'a.md', to: 'b.md' })
    expect(r.edges).toContainEqual({ from: 'c.md', to: 'a.md' })
    expect(r.edges).toHaveLength(2)
  })

  it('焦点不存在时返回空', () => {
    const r = buildSelection('zzz.md', files, backlinkMap, resolve)
    expect(r).toEqual({ paths: [], edges: [] })
  })

  it('焦点无任何链接/反链时只含自身', () => {
    const r = buildSelection('b.md', files, {}, resolve)
    expect(r.paths).toEqual(['b.md'])
    expect(r.edges).toEqual([])
  })
})
