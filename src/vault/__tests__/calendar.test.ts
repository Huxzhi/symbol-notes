import { describe, it, expect } from 'vitest'
import { fileCal, buildCalendarByDate, calAdd, calRemove } from '../indexes/calendar'
import type { FileMeta, ListItem } from '../../stores/types'

function li(overrides: Partial<ListItem>): ListItem {
  return {
    text: '', visual: '', line: 0, lineCount: 1, symbol: '-',
    signifier: null, status: null, checked: false, task: false,
    fields: {}, tags: [],
    ...overrides,
  }
}

function fm(overrides: Partial<FileMeta>): FileMeta {
  return {
    name: 'x.md', path: 'x.md', kind: 'file', parent: null,
    size: 0, mtime: 0, hash: '',
    frontmatter: {}, outLinks: [], etags: [], tags: [], aliases: [],
    created: '2026-01-01', updated: null, dated: '', lists: [],
    ...overrides,
  }
}

describe('fileCal', () => {
  it('non-dated file contributes created (and updated when distinct)', () => {
    const cal = fileCal('note.md', fm({ created: '2026-03-01', updated: '2026-03-05' }))
    expect(cal.datedDate).toBeNull()
    expect(cal.createdDate).toBe('2026-03-01')
    expect(cal.updatedDate).toBe('2026-03-05')
  })

  it('frontmatter.dated takes precedence and suppresses created/updated', () => {
    const cal = fileCal('note.md', fm({
      frontmatter: { dated: '2026-07-09' }, created: '2026-03-01', updated: '2026-03-05',
    }))
    expect(cal.datedDate).toBe('2026-07-09')
    expect(cal.createdDate).toBeNull()
    expect(cal.updatedDate).toBeNull()
  })

  it('stem date is used as dated when no frontmatter.dated', () => {
    expect(fileCal('2026-06-14.md', fm({ path: '2026-06-14.md' })).datedDate).toBe('2026-06-14')
  })

  it('tasks land on explicit due, else file dated fallback', () => {
    const cal = fileCal('a.md', fm({
      dated: '2026-05-02',
      lists: [
        li({ task: true, fields: { due: '2026-05-10' } }),
        li({ task: true }),                 // falls back to file dated 2026-05-02
      ],
    }))
    expect(cal.tasks.map(t => t.date).sort()).toEqual(['2026-05-02', '2026-05-10'])
    expect(cal.tasks.every(t => t.task.path === 'a.md')).toBe(true)
  })

  it('entries only for signifier - = ~', () => {
    const cal = fileCal('a.md', fm({
      dated: '2026-05-02',
      lists: [
        li({ signifier: '-' }), li({ signifier: '=' }), li({ signifier: '~' }),
        li({ signifier: '!' }),               // not an entry signifier
      ],
    }))
    expect(cal.entries).toHaveLength(3)
  })

  it('directories and missing meta contribute nothing', () => {
    expect(fileCal('d', fm({ kind: 'directory' })).createdDate).toBeNull()
    expect(fileCal('x.md', undefined).createdDate).toBeNull()
  })
})

describe('buildCalendarByDate', () => {
  it('buckets created/dated/tasks/entries by date', () => {
    const files: Record<string, FileMeta> = {
      'n.md': fm({ path: 'n.md', created: '2026-01-02' }),
      '2026-01-02.md': fm({ path: '2026-01-02.md' }),
      'a.md': fm({ path: 'a.md', dated: '2026-01-02', lists: [li({ task: true }), li({ signifier: '-' })] }),
    }
    const map = buildCalendarByDate(files)
    expect(map['2026-01-02'].created).toEqual(['n.md'])
    expect(map['2026-01-02'].dated).toEqual(['2026-01-02.md'])
    expect(map['2026-01-02'].tasks.map(t => t.path)).toEqual(['a.md'])
    expect(map['2026-01-02'].entries.map(e => e.path)).toEqual(['a.md'])
  })
})

describe('incremental calAdd/calRemove invariant', () => {
  const base: Record<string, FileMeta> = {
    'n.md': fm({ path: 'n.md', created: '2026-02-01', updated: '2026-02-03' }),
    'a.md': fm({ path: 'a.md', dated: '2026-02-05', lists: [li({ task: true }), li({ signifier: '=' })] }),
    '2026-02-09.md': fm({ path: '2026-02-09.md', lists: [li({ task: true, fields: { due: '2026-02-09' } })] }),
  }

  it('add-all equals full rebuild', () => {
    const map: Record<string, import('../../stores/types').DateBucket> = {}
    for (const [p, m] of Object.entries(base)) calAdd(map, p, fileCal(p, m))
    expect(map).toEqual(buildCalendarByDate(base))
  })

  it('remove-then-readd a file restores the full rebuild', () => {
    const map = buildCalendarByDate(base)
    // edit a.md: move task to a new due and change entry signifier
    const prev = base['a.md']
    const next = fm({ path: 'a.md', dated: '2026-02-05', lists: [li({ task: true, fields: { due: '2026-02-20' } })] })
    calRemove(map, 'a.md', fileCal('a.md', prev))
    calAdd(map, 'a.md', fileCal('a.md', next))

    const rebuilt = buildCalendarByDate({ ...base, 'a.md': next })
    expect(map).toEqual(rebuilt)
  })

  it('removing a file deletes now-empty date keys', () => {
    const map = buildCalendarByDate(base)
    calRemove(map, '2026-02-09.md', fileCal('2026-02-09.md', base['2026-02-09.md']))
    expect(map['2026-02-09']).toBeUndefined()
  })
})
