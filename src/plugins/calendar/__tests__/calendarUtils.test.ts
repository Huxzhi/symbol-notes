import { describe, it, expect } from 'vitest'
import {
  buildMonthRows,
  buildRangeRows,
  toIsoDate,
  buildEntryDayData,
  buildTaskDayData,
  getISOWeek,
  getISOWeekString,
  getISOWeekDates,
  weekFilePath,
  parseISODate,
  getMonthString,
  monthFilePath,
  weekRowFilePath,
} from '../calendarUtils'
import type { MonthHeaderRow, WeekRow } from '../calendarUtils'
import type { FileMeta, ListItem } from '../../../stores/types'

describe('buildMonthRows', () => {
  it('first row is month-header with correct year/month', () => {
    const rows = buildMonthRows(2026, 5)  // June 2026
    expect(rows[0]).toEqual({ type: 'month-header', year: 2026, month: 5 })
  })

  it('remaining rows are week rows', () => {
    const rows = buildMonthRows(2026, 5)
    const weeks = rows.slice(1) as WeekRow[]
    expect(weeks.every(r => r.type === 'week')).toBe(true)
  })

  it('each week row has exactly 7 cells', () => {
    const rows = buildMonthRows(2026, 5)
    const weeks = rows.slice(1) as WeekRow[]
    expect(weeks.every(r => r.cells.length === 7)).toBe(true)
  })

  it('non-null cells have correct dayStr format', () => {
    const rows = buildMonthRows(2026, 5)
    const weeks = rows.slice(1) as WeekRow[]
    const allCells = weeks.flatMap(r => r.cells).filter(c => c !== null)
    expect(allCells.every(c => /^\d{4}-\d{2}-\d{2}$/.test(c!.dayStr))).toBe(true)
  })

  it('June 2026 has 30 days total across all non-null cells', () => {
    const rows = buildMonthRows(2026, 5)
    const weeks = rows.slice(1) as WeekRow[]
    const nonNull = weeks.flatMap(r => r.cells).filter(c => c !== null)
    expect(nonNull.length).toBe(30)
  })

  it('February 2024 (leap year) has 29 days', () => {
    const rows = buildMonthRows(2024, 1)
    const weeks = rows.slice(1) as WeekRow[]
    const nonNull = weeks.flatMap(r => r.cells).filter(c => c !== null)
    expect(nonNull.length).toBe(29)
  })

  it('first non-null cell of June 2026 is Monday (index 0)', () => {
    // June 2026 starts on Monday
    const rows = buildMonthRows(2026, 5)
    const firstWeek = (rows[1] as WeekRow).cells
    expect(firstWeek[0]).not.toBeNull()
    expect(firstWeek[0]!.day).toBe(1)
    expect(firstWeek[0]!.dayStr).toBe('2026-06-01')
  })
})

describe('buildRangeRows', () => {
  it('returns empty array for count 0', () => {
    expect(buildRangeRows(2026, 5, 0)).toEqual([])
  })

  it('count=1 returns same as buildMonthRows', () => {
    expect(buildRangeRows(2026, 5, 1)).toEqual(buildMonthRows(2026, 5))
  })

  it('count=2 concatenates two months', () => {
    const result = buildRangeRows(2026, 5, 2)
    const expected = [...buildMonthRows(2026, 5), ...buildMonthRows(2026, 6)]
    expect(result).toEqual(expected)
  })

  it('wraps month correctly across year boundary', () => {
    const result = buildRangeRows(2025, 11, 2)
    const headers = result.filter(r => r.type === 'month-header') as MonthHeaderRow[]
    expect(headers[0]).toEqual({ type: 'month-header', year: 2025, month: 11 })
    expect(headers[1]).toEqual({ type: 'month-header', year: 2026, month: 0 })
  })

  it('wraps month correctly when startMonth is negative (e.g. going backwards)', () => {
    const result = buildRangeRows(2025, 9, 3)
    const headers = result.filter(r => r.type === 'month-header') as MonthHeaderRow[]
    expect(headers[0]).toEqual({ type: 'month-header', year: 2025, month: 9 })
    expect(headers[1]).toEqual({ type: 'month-header', year: 2025, month: 10 })
    expect(headers[2]).toEqual({ type: 'month-header', year: 2025, month: 11 })
  })
})

function listItem(over: Partial<ListItem>): ListItem {
  return {
    text: '', visual: '', line: 0, lineCount: 1, symbol: '-',
    signifier: null, status: null, checked: false, task: false,
    fields: {}, tags: [], ...over,
  }
}

function fileMeta(path: string, dated: string, lists: ListItem[]): FileMeta {
  return {
    name: path.split('/').pop()!, path, kind: 'file', parent: null,
    size: 0, mtime: 0, hash: '', frontmatter: {}, outLinks: [], etags: [],
    tags: [], aliases: [], created: dated, updated: null, dated, lists,
  }
}

describe('buildEntryDayData', () => {
  it('places event/mood/idea on the file dated', () => {
    const files = {
      'journal/2026-06-10.md': fileMeta('journal/2026-06-10.md', '2026-06-10', [
        listItem({ signifier: '-', visual: '看了电影' }),
        listItem({ signifier: '=', visual: '很开心' }),
        listItem({ signifier: '~', visual: '一个点子' }),
      ]),
    }
    const map = buildEntryDayData(files)
    expect(map['2026-06-10'].map(e => e.signifier)).toEqual(['-', '=', '~'])
    expect(map['2026-06-10'][0].path).toBe('journal/2026-06-10.md')
  })

  it('uses explicit [due::] over file dated', () => {
    const files = {
      'a.md': fileMeta('a.md', '2026-06-01', [
        listItem({ signifier: '-', fields: { due: '2026-06-20' } }),
      ]),
    }
    const map = buildEntryDayData(files)
    expect(map['2026-06-20']).toHaveLength(1)
    expect(map['2026-06-01']).toBeUndefined()
  })

  it('skips tasks, plain lists, and ! & signifiers', () => {
    const files = {
      'a.md': fileMeta('a.md', '2026-06-01', [
        listItem({ task: true, status: ' ' }),       // 任务
        listItem({ signifier: null }),                // 普通列表
        listItem({ signifier: '!' }),                 // 重要
        listItem({ signifier: '&' }),                 // 留意
      ]),
    }
    expect(buildEntryDayData(files)).toEqual({})
  })

  it('skips directories and items with no resolvable date', () => {
    const dir: FileMeta = { ...fileMeta('d', '2026-06-01', []), kind: 'directory' }
    const noDate: FileMeta = { ...fileMeta('n.md', '', [listItem({ signifier: '-' })]), dated: '' }
    expect(buildEntryDayData({ 'd': dir, 'n.md': noDate })).toEqual({})
  })

  it('周/月 dated 文件（dated="")的无 due 条目不落到任何天', () => {
    const weekly: FileMeta = {
      ...fileMeta('2026-W22.md', '', [
        listItem({ signifier: '-', visual: '本周事件' }),
        listItem({ signifier: '~', visual: '本周想法', fields: { due: '2026-05-28' } }),
      ]),
      dated: '',
    }
    const map = buildEntryDayData({ '2026-W22.md': weekly })
    // 无 due 的事件被排除，不产生空串键；带显式 due 的仍落到该天
    expect(map['']).toBeUndefined()
    expect(map['2026-05-28']).toHaveLength(1)
  })
})

describe('buildTaskDayData', () => {
  it('周/月 dated 文件（dated="")的无 due 任务不落到任何天', () => {
    const weekly = fileMeta('2026-W22.md', '', [
      listItem({ task: true, status: ' ', visual: '周任务' }),
      listItem({ task: true, status: ' ', visual: '带截止', fields: { due: '2026-05-28' } }),
    ])
    weekly.dated = ''
    const taskMap = { '2026-W22.md': weekly.lists }
    const map = buildTaskDayData(taskMap, { '2026-W22.md': weekly })
    expect(map['']).toBeUndefined()
    expect(map['2026-05-28']).toHaveLength(1)
  })

  it('普通文件无 due 任务回退到文件 dated', () => {
    const note = fileMeta('a.md', '2026-06-01', [listItem({ task: true, status: ' ' })])
    const map = buildTaskDayData({ 'a.md': note.lists }, { 'a.md': note })
    expect(map['2026-06-01']).toHaveLength(1)
  })
})

describe('ISO week helpers', () => {
  it('getISOWeek handles mid-year and year boundaries', () => {
    expect(getISOWeek(new Date(2026, 5, 2))).toEqual({ year: 2026, week: 23 }) // 周二
    expect(getISOWeek(new Date(2021, 0, 1))).toEqual({ year: 2020, week: 53 }) // 跨年归上年 W53
    expect(getISOWeek(new Date(2019, 11, 31))).toEqual({ year: 2020, week: 1 }) // 归下年 W1
  })

  it('getISOWeekString formats as YYYY-Www', () => {
    expect(getISOWeekString(new Date(2026, 5, 2))).toBe('2026-W23')
  })

  it('getISOWeekDates returns Mon..Sun of the ISO week', () => {
    const days = getISOWeekDates(new Date(2026, 5, 10)) // 2026-06-10 周三
    expect(days).toHaveLength(7)
    expect(days[0]).toBe('2026-06-08') // 周一
    expect(days[6]).toBe('2026-06-14') // 周日
  })

  it('weekFilePath joins folder and ISO week name', () => {
    expect(weekFilePath('weekly', new Date(2026, 5, 10))).toBe('weekly/2026-W24.md')
    expect(weekFilePath('', new Date(2026, 5, 10))).toBe('2026-W24.md')
  })

  it('parseISODate parses to a local date', () => {
    const d = parseISODate('2026-06-10')
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 5, 10])
  })
})

describe('month helpers', () => {
  it('getMonthString pads month and is local (not UTC)', () => {
    expect(getMonthString(new Date(2026, 5, 10))).toBe('2026-06')  // June
    expect(getMonthString(new Date(2026, 0, 1))).toBe('2026-01')   // January
    expect(getMonthString(new Date(2026, 11, 31))).toBe('2026-12') // December
  })

  it('monthFilePath joins folder and YYYY-MM name', () => {
    expect(monthFilePath('monthly', 2026, 5)).toBe('monthly/2026-06.md')
    expect(monthFilePath('', 2026, 5)).toBe('2026-06.md')
  })
})

describe('weekRowFilePath', () => {
  it('derives the weekly file from the row first non-null day', () => {
    const row = buildMonthRows(2026, 5).slice(1)[1] as WeekRow // 2nd week of June 2026
    const first = row.cells.find(c => c !== null)!
    expect(weekRowFilePath('weekly', row)).toBe(weekFilePath('weekly', parseISODate(first.dayStr)))
  })

  it('uses the first non-null cell when the row starts with null padding', () => {
    // A month whose 1st is not Monday: leading nulls in the first week row.
    const firstWeek = buildMonthRows(2026, 6).slice(1)[0] as WeekRow // July 2026 starts Wed
    expect(firstWeek.cells[0]).toBeNull()
    const first = firstWeek.cells.find(c => c !== null)!
    expect(weekRowFilePath('weekly', firstWeek)).toBe(weekFilePath('weekly', parseISODate(first.dayStr)))
  })

  it('returns null for an all-null row', () => {
    expect(weekRowFilePath('weekly', { type: 'week', cells: [null, null, null, null, null, null, null] })).toBeNull()
  })
})
