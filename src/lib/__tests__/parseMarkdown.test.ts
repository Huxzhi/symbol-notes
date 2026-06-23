import { describe, it, expect } from 'vitest'
import { parseMarkdown } from '../parseMarkdown'

describe('parseMarkdown', () => {
  it('extracts wiki outLinks normalised to .md', () => {
    const result = parseMarkdown('see [[Note A]] and [[sub/Note B]]')
    const targets = result.outLinks.map(l => l.target)
    expect(targets).toContain('Note A.md')
    expect(targets).toContain('sub/Note B.md')
  })

  it('does not duplicate .md suffix on links that already have it', () => {
    const result = parseMarkdown('[[Note.md]]')
    expect(result.outLinks.map(l => l.target)).toEqual(['Note.md'])
  })

  it('extracts inline tags', () => {
    const result = parseMarkdown('hello #project/alpha world')
    expect(result.inlineTags).toContain('project/alpha')
  })

  it('extracts unchecked tasks', () => {
    const result = parseMarkdown('- [ ] buy milk')
    expect(result.lists).toHaveLength(1)
    expect(result.lists[0].task).toBe(true)
    expect(result.lists[0].checked).toBe(false)
    expect(result.lists[0].visual).toBe('buy milk')
  })

  it('extracts checked tasks', () => {
    const result = parseMarkdown('- [x] done')
    expect(result.lists[0].checked).toBe(true)
  })

  it('returns empty arrays for plain text', () => {
    const result = parseMarkdown('just some text')
    expect(result.outLinks).toEqual([])
    expect(result.inlineTags).toEqual([])
    expect(result.lists).toEqual([])
  })
})

describe('parseMarkdown WikiLinkInfo', () => {
  it('outLinks 是结构数组，归一 target 并切 anchor', () => {
    const r = parseMarkdown('## 计划\n[[复测计划#步骤|看这里]] #想法')
    expect(r.outLinks).toHaveLength(1)
    const l = r.outLinks[0]
    expect(l.target).toBe('复测计划.md')
    expect(l.anchor).toBe('步骤')
    expect(l.alias).toBe('看这里')
    expect(l.headingPath).toEqual(['计划'])
    expect(l.lineTags).toEqual(['想法'])     // 同行标签
    expect(typeof l.from).toBe('number')
  })

  it('不同行的标签不计入 lineTags', () => {
    const r = parseMarkdown('[[A]]\n#别处')
    expect(r.outLinks[0].lineTags).toEqual([])
  })

  it('已带 .md 的目标不重复加后缀', () => {
    const r = parseMarkdown('[[folder/B.md]]')
    expect(r.outLinks[0].target).toBe('folder/B.md')
  })
})
