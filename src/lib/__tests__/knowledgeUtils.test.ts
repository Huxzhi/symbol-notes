import { describe, it, expect } from 'vitest'
import { extractDateFromName, buildStemIndex, buildAliasIndex, resolveLink, buildLinkMaps } from '../../vault'
import { buildTaskMap } from '../../vault/tasks'
import type { ListItem } from '../../stores/types'

const task1: ListItem = {
  text: 'buy milk', visual: 'buy milk', line: 0, lineCount: 1,
  symbol: '-', signifier: null, status: ' ', checked: false, task: true, fields: {}, tags: [],
}
const task2: ListItem = {
  text: 'done', visual: 'done', line: 1, lineCount: 1,
  symbol: '-', signifier: null, status: 'x', checked: true, task: true, fields: {}, tags: [],
}

describe('buildTaskMap', () => {
  it('keys result by file path', () => {
    const map = buildTaskMap({ 'a.md': { lists: [task1] }, 'b.md': { lists: [task2] } })
    expect(map['a.md']).toEqual([task1])
    expect(map['b.md']).toEqual([task2])
  })

  it('omits files with no tasks', () => {
    const map = buildTaskMap({ 'a.md': { lists: [] }, 'b.md': { lists: [task1] } })
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
      'daily/2024-01-01.md': { outLinks: [{ target: 'todo.md' }] },
    }
    const { backlinkMap, unresolvedMap } = buildLinkMaps(files)
    expect(backlinkMap['notes/todo.md']).toEqual(['daily/2024-01-01.md'])
    expect(Object.keys(unresolvedMap)).toHaveLength(0)
  })

  it('puts unresolvable links in unresolvedMap', () => {
    const files = {
      'a.md': { outLinks: [{ target: 'ghost.md' }] },
    }
    const { backlinkMap, unresolvedMap } = buildLinkMaps(files)
    expect(unresolvedMap['ghost.md']).toEqual(['a.md'])
    expect(Object.keys(backlinkMap)).toHaveLength(0)
  })

  it('handles ambiguous stem as unresolved', () => {
    const files = {
      'notes/foo.md': { outLinks: [] },
      'work/foo.md': { outLinks: [] },
      'src.md': { outLinks: [{ target: 'foo.md' }] },
    }
    const { unresolvedMap } = buildLinkMaps(files)
    expect(unresolvedMap['foo.md']).toEqual(['src.md'])
  })

  it('disambiguates with path hint', () => {
    const files = {
      'notes/foo.md': { outLinks: [] },
      'work/foo.md': { outLinks: [] },
      'src.md': { outLinks: [{ target: 'notes/foo.md' }] },
    }
    const { backlinkMap } = buildLinkMaps(files)
    expect(backlinkMap['notes/foo.md']).toEqual(['src.md'])
  })
})

describe('buildAliasIndex', () => {
  it('maps lowercased alias to owning paths, skips non-md', () => {
    const idx = buildAliasIndex({
      'notes/todo.md': { aliases: ['待办', 'TODO'] },
      'work/plan.md': { aliases: ['计划'] },
      'image.png': { aliases: ['图'] },
    })
    expect(idx.get('待办')).toEqual(['notes/todo.md'])
    expect(idx.get('todo')).toEqual(['notes/todo.md']) // 小写归一
    expect(idx.get('计划')).toEqual(['work/plan.md'])
    expect(idx.has('图')).toBe(false) // 非 .md 跳过
  })

  it('collects multiple paths sharing one alias', () => {
    const idx = buildAliasIndex({
      'a.md': { aliases: ['dup'] },
      'b.md': { aliases: ['dup'] },
    })
    expect(idx.get('dup')).toEqual(['a.md', 'b.md'])
  })
})

describe('resolveLink alias fallback', () => {
  const files = {
    'notes/todo.md': { aliases: ['待办'] },
    'work/plan.md': { aliases: ['计划', 'shared'] },
    'misc.md': { aliases: ['shared'] },
  }
  const stemIndex = buildStemIndex(files)
  const aliasIndex = buildAliasIndex(files)

  it('resolves a unique alias to its file path', () => {
    expect(resolveLink('待办', stemIndex, files, aliasIndex)).toBe('notes/todo.md')
  })

  it('strips .md before alias lookup', () => {
    expect(resolveLink('计划.md', stemIndex, files, aliasIndex)).toBe('work/plan.md')
  })

  it('is case-insensitive on alias', () => {
    expect(resolveLink('待办', stemIndex, files, aliasIndex)).toBe('notes/todo.md')
    expect(resolveLink('SHARED', stemIndex, files, aliasIndex)).toBeNull() // 多义
  })

  it('returns null for ambiguous alias', () => {
    expect(resolveLink('shared', stemIndex, files, aliasIndex)).toBeNull()
  })

  it('prefers stem match over alias (no alias fallback when stem resolves)', () => {
    const f = { 'todo.md': { aliases: [] }, 'other.md': { aliases: ['todo'] } }
    expect(resolveLink('todo.md', buildStemIndex(f), f, buildAliasIndex(f))).toBe('todo.md')
  })

  it('works without aliasIndex (back-compat)', () => {
    expect(resolveLink('待办', stemIndex, files)).toBeNull()
  })
})

describe('buildLinkMaps alias resolution', () => {
  it('registers [[alias]] backlink under the real file path', () => {
    const files = {
      'notes/todo.md': { aliases: ['待办'], outLinks: [] },
      'journal.md': { aliases: [], outLinks: [{ target: '待办' }] },
    }
    const { backlinkMap, unresolvedMap } = buildLinkMaps(files)
    expect(backlinkMap['notes/todo.md']).toEqual(['journal.md'])
    expect(unresolvedMap['待办']).toBeUndefined()
  })
})
