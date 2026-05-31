import { describe, it, expect } from 'vitest'
import { extractDateFromName, buildTaskMap, buildStemIndex, resolveLink, buildLinkMaps } from '../knowledgeUtils'
import type { TaskItem } from '../../stores/types'

const task1: TaskItem = {
  text: '- [ ] buy milk', cleanText: 'buy milk', checked: false,
  status: ' ', line: 0, dueDate: null, completedDate: null, fields: {},
}
const task2: TaskItem = {
  text: '- [x] done', cleanText: 'done', checked: true,
  status: 'x', line: 1, dueDate: null, completedDate: null, fields: {},
}

describe('buildTaskMap', () => {
  it('keys result by file path', () => {
    const map = buildTaskMap({ 'a.md': { tasks: [task1] }, 'b.md': { tasks: [task2] } })
    expect(map['a.md']).toEqual([task1])
    expect(map['b.md']).toEqual([task2])
  })

  it('omits files with no tasks', () => {
    const map = buildTaskMap({ 'a.md': { tasks: [] }, 'b.md': { tasks: [task1] } })
    expect(Object.keys(map)).toEqual(['b.md'])
  })

  it('returns empty object for empty input', () => {
    expect(buildTaskMap({})).toEqual({})
  })
})

describe('extractDateFromName', () => {
  describe('YYYY-MM-DD format', () => {
    it('extracts from standalone filename', () => {
      expect(extractDateFromName('2026-05-29.md')).toBe('2026-05-29')
    })
    it('extracts when embedded in filename', () => {
      expect(extractDateFromName('note-2026-05-29-daily.md')).toBe('2026-05-29')
    })
  })

  describe('YYYYMMDD format', () => {
    it('extracts and normalizes to YYYY-MM-DD', () => {
      expect(extractDateFromName('20260529.md')).toBe('2026-05-29')
    })
    it('extracts when preceded by non-digit separator', () => {
      expect(extractDateFromName('diary_20260101.md')).toBe('2026-01-01')
    })
    it('extracts when followed by non-digit separator', () => {
      expect(extractDateFromName('20260529-my-note.md')).toBe('2026-05-29')
    })
  })

  describe('priority and edge cases', () => {
    it('prefers YYYY-MM-DD when both formats present', () => {
      expect(extractDateFromName('2026-05-29-note20260101.md')).toBe('2026-05-29')
    })
    it('returns null for no date', () => {
      expect(extractDateFromName('mynote.md')).toBeNull()
    })
    it('does not match 9+ consecutive digits', () => {
      expect(extractDateFromName('123456789.md')).toBeNull()
    })
  })
})

describe('buildStemIndex', () => {
  it('maps stem to full path', () => {
    const index = buildStemIndex({ 'notes/todo.md': {}, 'work/todo.md': {}, 'readme.md': {} })
    expect(index.get('todo.md')).toEqual(['notes/todo.md', 'work/todo.md'])
    expect(index.get('readme.md')).toEqual(['readme.md'])
  })

  it('ignores non-md paths', () => {
    const index = buildStemIndex({ 'notes/todo.md': {}, 'image.png': {} })
    expect(index.has('image.png')).toBe(false)
  })
})

describe('resolveLink', () => {
  const files = { 'notes/todo.md': {}, 'work/other.md': {}, 'readme.md': {} }
  const stemIndex = buildStemIndex(files)

  it('resolves direct full path match', () => {
    expect(resolveLink('notes/todo.md', stemIndex, files)).toBe('notes/todo.md')
  })

  it('resolves unique stem to full path', () => {
    expect(resolveLink('other.md', stemIndex, files)).toBe('work/other.md')
  })

  it('resolves root-level file', () => {
    expect(resolveLink('readme.md', stemIndex, files)).toBe('readme.md')
  })

  it('returns null for ambiguous stem', () => {
    const f = { 'notes/todo.md': {}, 'work/todo.md': {} }
    expect(resolveLink('todo.md', buildStemIndex(f), f)).toBeNull()
  })

  it('disambiguates with path hint when multiple stems exist', () => {
    const f = { 'notes/todo.md': {}, 'work/todo.md': {} }
    expect(resolveLink('notes/todo.md', buildStemIndex(f), f)).toBe('notes/todo.md')
  })

  it('returns null for non-existent target', () => {
    expect(resolveLink('ghost.md', stemIndex, files)).toBeNull()
  })
})

describe('buildLinkMaps', () => {
  it('puts resolved links in backlinkMap keyed by full path', () => {
    const files = {
      'notes/todo.md': { outLinks: [] },
      'daily/2024-01-01.md': { outLinks: ['todo.md'] },
    }
    const { backlinkMap, unresolvedMap } = buildLinkMaps(files)
    expect(backlinkMap['notes/todo.md']).toEqual(['daily/2024-01-01.md'])
    expect(Object.keys(unresolvedMap)).toHaveLength(0)
  })

  it('puts unresolvable links in unresolvedMap', () => {
    const files = {
      'a.md': { outLinks: ['ghost.md'] },
    }
    const { backlinkMap, unresolvedMap } = buildLinkMaps(files)
    expect(unresolvedMap['ghost.md']).toEqual(['a.md'])
    expect(Object.keys(backlinkMap)).toHaveLength(0)
  })

  it('handles ambiguous stem as unresolved', () => {
    const files = {
      'notes/foo.md': { outLinks: [] },
      'work/foo.md': { outLinks: [] },
      'src.md': { outLinks: ['foo.md'] },
    }
    const { unresolvedMap } = buildLinkMaps(files)
    expect(unresolvedMap['foo.md']).toEqual(['src.md'])
  })

  it('disambiguates with path hint', () => {
    const files = {
      'notes/foo.md': { outLinks: [] },
      'work/foo.md': { outLinks: [] },
      'src.md': { outLinks: ['notes/foo.md'] },
    }
    const { backlinkMap } = buildLinkMaps(files)
    expect(backlinkMap['notes/foo.md']).toEqual(['src.md'])
  })
})
