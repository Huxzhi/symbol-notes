import { describe, it, expect } from 'vitest'
import { parseMarkdown } from '../parseMarkdown'

describe('parseMarkdown', () => {
  it('extracts wiki outLinks normalised to .md', () => {
    const result = parseMarkdown('see [[Note A]] and [[sub/Note B]]')
    expect(result.outLinks).toContain('Note A.md')
    expect(result.outLinks).toContain('sub/Note B.md')
  })

  it('does not duplicate .md suffix on links that already have it', () => {
    const result = parseMarkdown('[[Note.md]]')
    expect(result.outLinks).toEqual(['Note.md'])
  })

  it('extracts inline tags', () => {
    const result = parseMarkdown('hello #project/alpha world')
    expect(result.inlineTags).toContain('project/alpha')
  })

  it('extracts unchecked tasks', () => {
    const result = parseMarkdown('- [ ] buy milk')
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0].checked).toBe(false)
    expect(result.tasks[0].cleanText).toBe('buy milk')
  })

  it('extracts checked tasks', () => {
    const result = parseMarkdown('- [x] done')
    expect(result.tasks[0].checked).toBe(true)
  })

  it('returns empty arrays for plain text', () => {
    const result = parseMarkdown('just some text')
    expect(result.outLinks).toEqual([])
    expect(result.inlineTags).toEqual([])
    expect(result.tasks).toEqual([])
  })
})
