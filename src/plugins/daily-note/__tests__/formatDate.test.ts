import { describe, it, expect } from 'vitest'
import { formatDate, todayPath } from '../formatDate'

describe('formatDate', () => {
  it('formats YYYY-MM-DD', () => {
    expect(formatDate(new Date(2026, 4, 29), 'YYYY-MM-DD')).toBe('2026-05-29')
  })
  it('formats YYYY/MM/DD', () => {
    expect(formatDate(new Date(2026, 4, 29), 'YYYY/MM/DD')).toBe('2026/05/29')
  })
  it('pads single-digit month and day', () => {
    expect(formatDate(new Date(2026, 0, 5), 'YYYY-MM-DD')).toBe('2026-01-05')
  })
  it('handles format without separators', () => {
    expect(formatDate(new Date(2026, 4, 29), 'YYYYMMDD')).toBe('20260529')
  })
  it('replaces all occurrences for folder-grouped format', () => {
    expect(formatDate(new Date(2026, 4, 29), 'YYYY/MM/YYYY-MM-DD')).toBe('2026/05/2026-05-29')
  })
})

describe('todayPath', () => {
  it('prepends folder when provided', () => {
    expect(todayPath('journal', 'YYYY-MM-DD', new Date(2026, 4, 29))).toBe('journal/2026-05-29.md')
  })
  it('uses vault root when folder is empty', () => {
    expect(todayPath('', 'YYYY-MM-DD', new Date(2026, 4, 29))).toBe('2026-05-29.md')
  })
  it('uses today when no date argument given', () => {
    const result = todayPath('journal', 'YYYY-MM-DD')
    expect(result).toMatch(/^journal\/\d{4}-\d{2}-\d{2}\.md$/)
  })
})
