import { describe, it, expect } from 'vitest'
import { extractDateFromName, buildTaskMap } from '../knowledgeUtils'
import type { TaskItem } from '../../stores/types'

const task1: TaskItem = {
  text: '- [ ] buy milk', cleanText: 'buy milk', checked: false,
  status: ' ', line: 0, dueDate: null, completedDate: null, fields: {},
}
const task2: TaskItem = {
  text: '- [x] done', cleanText: 'done', checked: true,
  status: 'x', line: 1, dueDate: null, completedDate: null, fields: {},
}

describe('buildTaskMap', () => {
  it('keys result by file path', () => {
    const map = buildTaskMap({ 'a.md': { tasks: [task1] }, 'b.md': { tasks: [task2] } })
    expect(map['a.md']).toEqual([task1])
    expect(map['b.md']).toEqual([task2])
  })

  it('omits files with no tasks', () => {
    const map = buildTaskMap({ 'a.md': { tasks: [] }, 'b.md': { tasks: [task1] } })
    expect(Object.keys(map)).toEqual(['b.md'])
  })

  it('returns empty object for empty input', () => {
    expect(buildTaskMap({})).toEqual({})
  })
})

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
