import { describe, it, expect } from 'vitest'
import {
  buildMonthRows,
  buildRangeRows,
  toIsoDate,
} from '../calendarUtils'
import type { MonthHeaderRow, WeekRow } from '../calendarUtils'

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
