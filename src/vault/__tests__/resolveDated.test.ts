import { describe, it, expect } from 'vitest'
import { resolveDatedField, isPeriodDated } from '../scan'

describe('isPeriodDated', () => {
  it('true for week and month formats', () => {
    expect(isPeriodDated('2026-W22')).toBe(true)
    expect(isPeriodDated('2026-06')).toBe(true)
  })
  it('false for day, empty, junk, and non-strings', () => {
    expect(isPeriodDated('2026-06-10')).toBe(false)
    expect(isPeriodDated('')).toBe(false)
    expect(isPeriodDated(undefined)).toBe(false)
    expect(isPeriodDated('hello')).toBe(false)
  })
})

describe('resolveDatedField', () => {
  it('returns the day when dated is a full YYYY-MM-DD', () => {
    expect(resolveDatedField('2026-06-10', '2026-01-01')).toBe('2026-06-10')
  })
  it('returns "" (no daily placement) for week/month dated', () => {
    expect(resolveDatedField('2026-W22', '2026-01-01')).toBe('')
    expect(resolveDatedField('2026-06', '2026-01-01')).toBe('')
  })
  it('falls back to created when dated is absent or invalid', () => {
    expect(resolveDatedField(undefined, '2026-01-01')).toBe('2026-01-01')
    expect(resolveDatedField('not-a-date', '2026-01-01')).toBe('2026-01-01')
  })
})
