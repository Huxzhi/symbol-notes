import type { ListItem, FileMeta } from '../../stores/types'

export type Task = ListItem & { path: string }

export const WEEKDAYS_SHORT = ['一', '二', '三', '四', '五', '六', '日']
export const WEEKDAYS_LONG = [
  '周一',
  '周二',
  '周三',
  '周四',
  '周五',
  '周六',
  '周日',
]

// ── Multi-month row model ─────────────────────────────────────────────────────

export interface DayRef {
  year: number
  month: number
  day: number
  dayStr: string
}

export interface MonthHeaderRow {
  type: 'month-header'
  year: number
  month: number
}

export interface WeekRow {
  type: 'week'
  cells: (DayRef | null)[]
}

export type CalRow = MonthHeaderRow | WeekRow

export function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function buildCalendarGrid(
  year: number,
  month: number,
): (number | null)[] {
  const firstDow = new Date(year, month, 1).getDay() // 0=Sun
  const startOffset = (firstDow + 6) % 7 // Mon=0 … Sun=6
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

const RE_DATE_COMPACT = /^(\d{4})(\d{2})(\d{2})/
const RE_DATE_DASHED = /^(\d{4})-(\d{2})-(\d{2})/

function stemDate(path: string): string | null {
  const stem = path.split('/').pop()!.replace(/\.md$/, '')
  let m = RE_DATE_DASHED.exec(stem)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = RE_DATE_COMPACT.exec(stem)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

export function buildMonthRows(year: number, month: number): CalRow[] {
  const grid = buildCalendarGrid(year, month)
  const header: MonthHeaderRow = { type: 'month-header', year, month }
  const weeks: WeekRow[] = []
  for (let i = 0; i < grid.length; i += 7) {
    const cells: (DayRef | null)[] = []
    for (let j = 0; j < 7; j++) {
      const d = grid[i + j]
      cells.push(d === null ? null : { year, month, day: d, dayStr: toIsoDate(year, month, d) })
    }
    weeks.push({ type: 'week', cells })
  }
  return [header, ...weeks]
}

export function buildRangeRows(startYear: number, startMonth: number, count: number): CalRow[] {
  const rows: CalRow[] = []
  for (let i = 0; i < count; i++) {
    const total = startYear * 12 + startMonth + i
    rows.push(...buildMonthRows(Math.floor(total / 12), total % 12))
  }
  return rows
}

export function buildTaskDayData(
  taskMap: Record<string, ListItem[]>,
  files: Record<string, FileMeta>,
): Record<string, Task[]> {
  const map: Record<string, Task[]> = {}
  for (const [path, tasks] of Object.entries(taskMap)) {
    // 复刻原 dueDate 行为：显式 [due::] 优先，否则回退到文件的 dated
    const fallback = files[path]?.dated ?? null
    for (const task of tasks) {
      const due = task.fields['due'] ?? fallback
      if (!due) continue
      ;(map[due] ??= []).push({ ...task, path })
    }
  }
  return map
}

export function buildDayData(index: Record<string, FileMeta>) {
  const created: Record<string, string[]> = {}
  const updated: Record<string, string[]> = {}
  const dated: Record<string, string[]> = {}
  for (const [path, meta] of Object.entries(index)) {
    if (meta.kind !== 'file') continue

    // frontmatter.dated takes precedence over stem date
    const fmDated =
      typeof meta.frontmatter.dated === 'string' && meta.frontmatter.dated.length >= 10
        ? meta.frontmatter.dated.slice(0, 10)
        : null
    const d = fmDated ?? stemDate(path)

    if (d) {
      // Dated file: only appears on its dated date, not in created/updated
      ;(dated[d] ??= []).push(path)
    } else {
      // Use pre-computed FileMeta fields (already validated YYYY-MM-DD strings)
      const c = meta.created
      const u = meta.updated
      if (c) (created[c] ??= []).push(path)
      if (u && u !== c) (updated[u] ??= []).push(path)
    }
  }
  return { created, updated, dated }
}
