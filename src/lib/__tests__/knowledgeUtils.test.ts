import { describe, it, expect } from 'vitest'
import { extractDateFromName } from '../knowledgeUtils'

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
