import { describe, it, expect } from 'vitest'
import {
  getISOWeek,
  getISOWeekString,
  getISOWeekDates,
  getMonthString,
  weekFilePath,
  monthFilePath,
} from '../dashboardUtils'

describe('getISOWeek', () => {
  it('returns correct week for mid-year Tuesday', () => {
    // 2026-06-02 is Tuesday → ISO week 23
    expect(getISOWeek(new Date(2026, 5, 2))).toEqual({ year: 2026, week: 23 })
  })

  it('Jan 1 in last week of previous ISO year', () => {
    // 2021-01-01 is Friday → belongs to ISO week 53 of 2020
    expect(getISOWeek(new Date(2021, 0, 1))).toEqual({ year: 2020, week: 53 })
  })

  it('Dec 31 in first week of next ISO year', () => {
    // 2019-12-31 is Tuesday → belongs to ISO week 1 of 2020
    expect(getISOWeek(new Date(2019, 11, 31))).toEqual({ year: 2020, week: 1 })
  })
})

describe('getISOWeekString', () => {
  it('pads single-digit week with leading zero', () => {
    // 2026-01-05 is Monday → week 2
    expect(getISOWeekString(new Date(2026, 0, 5))).toBe('2026-W02')
  })

  it('formats double-digit week correctly', () => {
    expect(getISOWeekString(new Date(2026, 5, 2))).toBe('2026-W23')
  })
})

describe('getISOWeekDates', () => {
  it('returns 7 strings starting from Monday of the week', () => {
    // 2026-06-02 is Tuesday → week starts 2026-06-01 (Mon), ends 2026-06-07 (Sun)
    const dates = getISOWeekDates(new Date(2026, 5, 2))
    expect(dates).toHaveLength(7)
    expect(dates[0]).toBe('2026-06-01')
    expect(dates[6]).toBe('2026-06-07')
  })

  it('returns same week when given Monday', () => {
    const dates = getISOWeekDates(new Date(2026, 5, 1))
    expect(dates[0]).toBe('2026-06-01')
    expect(dates[6]).toBe('2026-06-07')
  })

  it('returns same week when given Sunday', () => {
    const dates = getISOWeekDates(new Date(2026, 5, 7))
    expect(dates[0]).toBe('2026-06-01')
    expect(dates[6]).toBe('2026-06-07')
  })
})

describe('getMonthString', () => {
  it('pads single-digit month with leading zero', () => {
    expect(getMonthString(new Date(2026, 0, 15))).toBe('2026-01')
  })

  it('formats double-digit month', () => {
    expect(getMonthString(new Date(2026, 11, 1))).toBe('2026-12')
  })
})

describe('weekFilePath', () => {
  it('prepends folder with slash', () => {
    expect(weekFilePath('weekly', new Date(2026, 5, 2))).toBe('weekly/2026-W23.md')
  })

  it('omits prefix when folder is empty string', () => {
    expect(weekFilePath('', new Date(2026, 5, 2))).toBe('2026-W23.md')
  })
})

describe('monthFilePath', () => {
  it('prepends folder with slash', () => {
    expect(monthFilePath('monthly', new Date(2026, 5, 2))).toBe('monthly/2026-06.md')
  })

  it('omits prefix when folder is empty string', () => {
    expect(monthFilePath('', new Date(2026, 5, 2))).toBe('2026-06.md')
  })
})
