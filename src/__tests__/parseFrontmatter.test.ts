import { describe, it, expect } from 'vitest'
import { parseFrontmatter, serializeFrontmatter } from '../lib/parseFrontmatter'

describe('parseFrontmatter', () => {
  it('parses basic string values', () => {
    const raw = `---\ntitle: Hello\ndate: 2026-05-20\n---\nBody`
    const { frontmatter, body } = parseFrontmatter(raw)
    expect(frontmatter.title).toBe('Hello')
    expect(frontmatter.date).toBe('2026-05-20')
    expect(body).toBe('Body')
  })

  it('parses inline arrays', () => {
    const { frontmatter } = parseFrontmatter('---\ntags: [a, b, c]\n---\n')
    expect(frontmatter.tags).toEqual(['a', 'b', 'c'])
  })

  it('parses multiline arrays', () => {
    const { frontmatter } = parseFrontmatter('---\ntags:\n  - semiotics\n  - index\n---\n')
    expect(frontmatter.tags).toEqual(['semiotics', 'index'])
  })

  it('parses booleans', () => {
    const { frontmatter } = parseFrontmatter('---\ndraft: true\npublished: false\n---\n')
    expect(frontmatter.draft).toBe(true)
    expect(frontmatter.published).toBe(false)
  })

  it('returns empty frontmatter when no --- block', () => {
    const { frontmatter, body } = parseFrontmatter('No frontmatter')
    expect(frontmatter).toEqual({})
    expect(body).toBe('No frontmatter')
  })

  it('handles empty frontmatter block', () => {
    const { frontmatter, body } = parseFrontmatter('---\n---\nBody')
    expect(frontmatter).toEqual({})
    expect(body).toBe('Body')
  })
})

describe('serializeFrontmatter', () => {
  it('wraps body with frontmatter block', () => {
    const result = serializeFrontmatter({ title: 'Hello' }, 'Body')
    expect(result).toBe('---\ntitle: Hello\n---\nBody')
  })

  it('serializes arrays as multiline', () => {
    const result = serializeFrontmatter({ tags: ['a', 'b'] }, '')
    expect(result).toBe('---\ntags:\n  - a\n  - b\n---\n')
  })

  it('returns body only when frontmatter is empty', () => {
    expect(serializeFrontmatter({}, 'Body')).toBe('Body')
  })

  it('round-trips correctly', () => {
    const original = '---\ntitle: Test\ntags:\n  - a\n  - b\n---\nContent'
    const { frontmatter, body } = parseFrontmatter(original)
    const result = serializeFrontmatter(frontmatter, body)
    expect(result).toBe(original)
  })
})
