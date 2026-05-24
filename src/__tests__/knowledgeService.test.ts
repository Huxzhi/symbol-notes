import { describe, it, expect } from 'vitest'
import { extractLinks, extractTags, buildBacklinkMap } from '../lib/knowledgeUtils'

describe('extractLinks', () => {
  it('extracts [[wikilinks]] and normalizes to .md', () => {
    expect(extractLinks('See [[符号与象征]] and [[索引]]')).toEqual(['符号与象征.md', '索引.md'])
  })

  it('extracts [[link|alias]] target only', () => {
    expect(extractLinks('[[target|显示名]]')).toEqual(['target.md'])
  })

  it('deduplicates repeated links', () => {
    expect(extractLinks('[[a]] and [[a]]')).toEqual(['a.md'])
  })

  it('returns empty array when no links', () => {
    expect(extractLinks('No links')).toEqual([])
  })
})

describe('extractTags', () => {
  it('extracts tags from frontmatter string', () => {
    expect(extractTags('semiotics, index')).toEqual(['semiotics', 'index'])
  })

  it('extracts tags from array', () => {
    expect(extractTags(['a', 'b'])).toEqual(['a', 'b'])
  })

  it('returns empty array for missing tags', () => {
    expect(extractTags(undefined)).toEqual([])
  })
})

describe('buildBacklinkMap', () => {
  it('builds reverse index', () => {
    const index = {
      'a.md': { path: 'a.md', frontmatter: {}, outLinks: ['b.md'], tags: [], aliases: [] },
      'b.md': { path: 'b.md', frontmatter: {}, outLinks: [], tags: [], aliases: [] },
    }
    const map = buildBacklinkMap(index)
    expect(map['b.md']).toEqual(['a.md'])
    expect(map['a.md']).toEqual([])
  })
})
