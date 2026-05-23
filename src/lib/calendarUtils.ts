import type { FileMetadata } from '../stores/knowledgeStore'

export const WEEKDAYS_SHORT = ['一', '二', '三', '四', '五', '六', '日']
export const WEEKDAYS_LONG  = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

export function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function buildCalendarGrid(year: number, month: number): (number | null)[] {
  const firstDow = new Date(year, month, 1).getDay()   // 0=Sun
  const startOffset = (firstDow + 6) % 7               // Mon=0 … Sun=6
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

export function buildDayData(index: Record<string, FileMetadata>) {
  const created: Record<string, string[]> = {}
  const updated: Record<string, string[]> = {}
  for (const [path, meta] of Object.entries(index)) {
    const fm = meta.frontmatter
    const c = typeof fm.created === 'string' && fm.created.length >= 10
      ? fm.created.slice(0, 10) : null
    const u = typeof fm.updated === 'string' && fm.updated.length >= 10
      ? fm.updated.slice(0, 10) : null
    if (c) (created[c] ??= []).push(path)
    if (u && u !== c) (updated[u] ??= []).push(path)
  }
  return { created, updated }
}
