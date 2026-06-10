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

const ENTRY_SIGNIFIERS = new Set(['-', '=', '~'])

/** 事件/心情/想法条目按日期聚合：fields['due'] 优先，否则文件 dated。 */
export function buildEntryDayData(
  files: Record<string, FileMeta>,
): Record<string, Task[]> {
  const map: Record<string, Task[]> = {}
  for (const [path, meta] of Object.entries(files)) {
    if (meta.kind !== 'file') continue
    const fallback = meta.dated || null
    for (const it of meta.lists) {
      if (!it.signifier || !ENTRY_SIGNIFIERS.has(it.signifier)) continue
      const date = it.fields['due'] ?? fallback
      if (!date) continue
      ;(map[date] ??= []).push({ ...it, path })
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

// ── ISO week helpers ──────────────────────────────────────────────────────────

export function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dow = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dow)
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + 1) / 7)
  return { year: d.getUTCFullYear(), week }
}

export function getISOWeekString(date: Date): string {
  const { year, week } = getISOWeek(date)
  return `${year}-W${String(week).padStart(2, '0')}`
}

export function getISOWeekDates(date: Date): string[] {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dow = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() - (dow - 1))
  return Array.from({ length: 7 }, (_, i) => {
    const cur = new Date(d)
    cur.setUTCDate(d.getUTCDate() + i)
    return cur.toISOString().slice(0, 10)
  })
}

export function weekFilePath(folder: string, date: Date): string {
  const name = `${getISOWeekString(date)}.md`
  return folder ? `${folder}/${name}` : name
}

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}
