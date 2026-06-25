import { describe, it, expect } from 'vitest'
import { resolveTemplate } from '../../../lib/templates/resolveTemplate'

const NOW = new Date(2026, 5, 7, 9, 5, 0) // 2026-06-07 周日 09:05

describe('resolveTemplate', () => {
  it('replaces {{date}} with default format', () => {
    expect(resolveTemplate('# {{date}}', { now: NOW }).text).toBe('# 2026-06-07')
  })
  it('replaces {{date:FMT}} with custom format', () => {
    expect(resolveTemplate('{{date:YYYY/MM/DD}}', { now: NOW }).text).toBe('2026/06/07')
  })
  it('replaces {{time}} with default HH:mm', () => {
    expect(resolveTemplate('{{time}}', { now: NOW }).text).toBe('09:05')
  })
  it('replaces {{yesterday}} and {{tomorrow}}', () => {
    expect(resolveTemplate('{{yesterday}}|{{tomorrow}}', { now: NOW }).text).toBe(
      '2026-06-06|2026-06-08',
    )
  })
  it('replaces {{weekday}} with Chinese weekday', () => {
    expect(resolveTemplate('{{weekday}}', { now: NOW }).text).toBe('周日')
  })
  it('replaces {{title}} with provided title', () => {
    expect(resolveTemplate('{{title}}', { now: NOW, title: '我的笔记' }).text).toBe('我的笔记')
  })
  it('replaces missing title with empty string', () => {
    expect(resolveTemplate('[{{title}}]', { now: NOW }).text).toBe('[]')
  })
  it('strips {{cursor}} and returns its offset', () => {
    const r = resolveTemplate('ab{{cursor}}cd', { now: NOW })
    expect(r.text).toBe('abcd')
    expect(r.cursorPos).toBe(2)
  })
  it('keeps first {{cursor}} as position, removes the rest', () => {
    const r = resolveTemplate('a{{cursor}}b{{cursor}}c', { now: NOW })
    expect(r.text).toBe('abc')
    expect(r.cursorPos).toBe(1)
  })
  it('returns null cursorPos when no cursor token', () => {
    expect(resolveTemplate('plain', { now: NOW }).cursorPos).toBeNull()
  })
  it('tolerates whitespace inside braces', () => {
    expect(resolveTemplate('{{ date }}', { now: NOW }).text).toBe('2026-06-07')
  })
  it('leaves unrecognized placeholders untouched', () => {
    expect(resolveTemplate('{{unknown}}', { now: NOW }).text).toBe('{{unknown}}')
  })
})
