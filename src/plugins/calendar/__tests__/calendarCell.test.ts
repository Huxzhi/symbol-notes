import { describe, it, expect } from 'vitest'
import { buildCellItems, FILTER_DEFAULTS } from '../calendarUtils'
import type { ListItem, DateBucket } from '../../../stores/types'

function entry(over: Partial<ListItem>): ListItem & { path: string } {
  return {
    text: '', visual: '', line: 0, lineCount: 1, symbol: '-',
    signifier: null, status: null, checked: false, task: false,
    fields: {}, tags: [], path: 'x.md', ...over,
  }
}

function bucket(over: Partial<DateBucket>): DateBucket {
  return { dated: [], created: [], updated: [], tasks: [], entries: [], ...over }
}

describe('buildCellItems', () => {
  it('collects files, tasks and entries for a day', () => {
    const b = bucket({
      created: ['a.md'],
      tasks: [entry({ task: true, status: ' ', checked: false })],
      entries: [entry({ signifier: '-' }), entry({ signifier: '=' }), entry({ signifier: '~' })],
    })
    const items = buildCellItems(FILTER_DEFAULTS, b)
    expect(items.map(i => i.kind)).toEqual(['created', 'pending', 'event', 'mood', 'idea'])
  })

  it('respects filter toggles', () => {
    const b = bucket({ entries: [entry({ signifier: '-' }), entry({ signifier: '=' })] })
    const f = { ...FILTER_DEFAULTS, event: false }
    const items = buildCellItems(f, b)
    expect(items.map(i => i.kind)).toEqual(['mood'])
  })

  it('returns empty for a day with nothing', () => {
    expect(buildCellItems(FILTER_DEFAULTS, undefined)).toEqual([])
    expect(buildCellItems(FILTER_DEFAULTS, bucket({}))).toEqual([])
  })
})
