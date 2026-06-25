import { describe, it, expect } from 'vitest'
import { extractTags, mergeTagsWithBody } from '../../metadata/parse/extract'

describe('extractTags', () => {
  it('returns array as-is', () => {
    expect(extractTags(['dev/frontend', 'writing'])).toEqual(['dev/frontend', 'writing'])
  })
  it('splits comma-separated string', () => {
    expect(extractTags('a, b, c')).toEqual(['a', 'b', 'c'])
  })
  it('returns [] for falsy input', () => {
    expect(extractTags(undefined)).toEqual([])
    expect(extractTags(null)).toEqual([])
  })
})

describe('mergeTagsWithBody', () => {
  it('adds frontmatter tags as-is without expansion', () => {
    expect(mergeTagsWithBody(['dev/frontend'], [])).toEqual(['dev/frontend'])
  })
  it('expands inline body tags into parent segments', () => {
    const result = mergeTagsWithBody([], ['dev/frontend'])
    expect(result).toEqual(expect.arrayContaining(['dev', 'dev/frontend']))
  })
  it('includes non-nested inline tags', () => {
    expect(mergeTagsWithBody([], ['writing'])).toContain('writing')
  })
  it('expands deeply nested inline tags', () => {
    const result = mergeTagsWithBody([], ['a/b/c'])
    expect(result).toEqual(expect.arrayContaining(['a', 'a/b', 'a/b/c']))
  })
  it('deduplicates overlapping tags', () => {
    const result = mergeTagsWithBody(['dev'], ['dev'])
    expect(result.filter(t => t === 'dev')).toHaveLength(1)
  })
})

describe('etags computation', () => {
  it('etags = fmTags + inlineTags, not expanded', () => {
    const fmTags = extractTags(['dev/frontend'])
    const inlineTags = ['writing']
    const etags = [...new Set([...fmTags, ...inlineTags])]
    expect(etags).toEqual(['dev/frontend', 'writing'])
    expect(etags).not.toContain('dev')
  })
  it('deduplicates etags when fm and inline overlap', () => {
    const fmTags = extractTags(['note'])
    const inlineTags = ['note']
    const etags = [...new Set([...fmTags, ...inlineTags])]
    expect(etags.filter(t => t === 'note')).toHaveLength(1)
  })
  it('inline body tags get expanded in tags but not etags', () => {
    const fmTags = extractTags([])
    const inlineTags = ['a/b']
    const etags = [...new Set([...fmTags, ...inlineTags])]
    const tags  = mergeTagsWithBody(fmTags, inlineTags)
    expect(etags).toEqual(['a/b'])
    expect(tags).toEqual(expect.arrayContaining(['a', 'a/b']))
  })
})
