import { describe, it, expect } from 'vitest'
import { formatDate } from '../../../lib/templates/formatDate'

describe('formatDate (extended)', () => {
  it('keeps date tokens working', () => {
    expect(formatDate(new Date(2026, 4, 29), 'YYYY-MM-DD')).toBe('2026-05-29')
  })
  it('formats HH:mm time tokens', () => {
    expect(formatDate(new Date(2026, 4, 29, 9, 5), 'HH:mm')).toBe('09:05')
  })
  it('formats seconds', () => {
    expect(formatDate(new Date(2026, 4, 29, 23, 59, 7), 'HH:mm:ss')).toBe('23:59:07')
  })
  it('does not let MM (month) collide with mm (minute)', () => {
    expect(formatDate(new Date(2026, 0, 2, 3, 4), 'MM mm')).toBe('01 04')
  })
})
