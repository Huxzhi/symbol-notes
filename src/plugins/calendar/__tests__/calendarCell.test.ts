import { describe, it, expect } from 'vitest'
import { buildCellItems, FILTER_DEFAULTS } from '../calendarUtils'
import type { ListItem } from '../../../stores/types'

function entry(over: Partial<ListItem>): ListItem & { path: string } {
  return {
    text: '', visual: '', line: 0, lineCount: 1, symbol: '-',
    signifier: null, status: null, checked: false, task: false,
    fields: {}, tags: [], path: 'x.md', ...over,
  }
}

const emptyDayData = { created: {}, updated: {}, dated: {} }

describe('buildCellItems', () => {
  it('collects files, tasks and entries for a day', () => {
    const data = {
      dayData: { created: { '2026-06-10': ['a.md'] }, updated: {}, dated: {} },
      taskDayData: { '2026-06-10': [entry({ task: true, status: ' ', checked: false })] },
      entryDayData: { '2026-06-10': [entry({ signifier: '-' }), entry({ signifier: '=' }), entry({ signifier: '~' })] },
    }
    const items = buildCellItems('2026-06-10', FILTER_DEFAULTS, data)
    expect(items.map(i => i.kind)).toEqual(['created', 'pending', 'event', 'mood', 'idea'])
  })

  it('respects filter toggles', () => {
    const data = {
      dayData: emptyDayData,
      taskDayData: {},
      entryDayData: { '2026-06-10': [entry({ signifier: '-' }), entry({ signifier: '=' })] },
    }
    const f = { ...FILTER_DEFAULTS, event: false }
    const items = buildCellItems('2026-06-10', f, data)
    expect(items.map(i => i.kind)).toEqual(['mood'])
  })

  it('returns empty for a day with nothing', () => {
    const data = { dayData: emptyDayData, taskDayData: {}, entryDayData: {} }
    expect(buildCellItems('2026-06-10', FILTER_DEFAULTS, data)).toEqual([])
  })
})
