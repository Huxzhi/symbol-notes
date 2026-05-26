import { describe, it, expect } from 'vitest'
import { extractLinks, extractTags, buildBacklinkMap, extractDateString, extractDateFromName, buildTaskMap } from '../lib/knowledgeUtils'
import type { FileMeta } from '../stores/types'

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

describe('extractDateString', () => {
  it('parses YYYY-MM-DD string', () => {
    expect(extractDateString('2024-05-26')).toBe('2024-05-26')
  })
  it('parses ISO datetime, keeps date part only', () => {
    expect(extractDateString('2024-05-26T12:00:00Z')).toBe('2024-05-26')
  })
  it('returns null for non-date string', () => {
    expect(extractDateString('not a date')).toBeNull()
  })
  it('returns null for number', () => {
    expect(extractDateString(20240526)).toBeNull()
  })
  it('returns null for undefined', () => {
    expect(extractDateString(undefined)).toBeNull()
  })
})

describe('extractDateFromName', () => {
  it('extracts date from daily note filename', () => {
    expect(extractDateFromName('2024-05-26.md')).toBe('2024-05-26')
  })
  it('extracts date from filename with title', () => {
    expect(extractDateFromName('2024-05-26 my note.md')).toBe('2024-05-26')
  })
  it('returns null when no date in filename', () => {
    expect(extractDateFromName('my-note.md')).toBeNull()
  })
  it('returns null for empty string', () => {
    expect(extractDateFromName('')).toBeNull()
  })
})

describe('buildTaskMap', () => {
  const makeFile = (tasks: FileMeta['tasks']): FileMeta => ({
    name: 'test.md', path: 'test.md', kind: 'file', parent: null,
    size: 0, mtime: 0, hash: '', frontmatter: {}, outLinks: [], tags: [],
    aliases: [], created: '2024-01-01', updated: null, dated: '2024-01-01', tasks,
  })

  it('flattens tasks from all files with path injected', () => {
    const files = {
      'a.md': makeFile([{ text: 'Task A', cleanText: 'Task A', checked: false, status: ' ', line: 0, dueDate: null, completedDate: null, fields: {} }]),
      'b.md': makeFile([{ text: 'Task B', cleanText: 'Task B', checked: true, status: 'x', line: 0, dueDate: null, completedDate: null, fields: {} }]),
    }
    const result = buildTaskMap(files)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ text: 'Task A', path: 'a.md' })
    expect(result[1]).toMatchObject({ text: 'Task B', path: 'b.md' })
  })

  it('returns empty array when no files have tasks', () => {
    const files = { 'a.md': makeFile([]) }
    expect(buildTaskMap(files)).toHaveLength(0)
  })
})
