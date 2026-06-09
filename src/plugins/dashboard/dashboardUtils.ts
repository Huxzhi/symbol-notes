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

export function getMonthString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function weekFilePath(folder: string, date: Date): string {
  const name = `${getISOWeekString(date)}.md`
  return folder ? `${folder}/${name}` : name
}

export function monthFilePath(folder: string, date: Date): string {
  const name = `${getMonthString(date)}.md`
  return folder ? `${folder}/${name}` : name
}

// ── Weekly task data (dashboard-specific) ─────────────────────────────────────

import type { ListItem } from '../../stores/types'

export type WeekTask = ListItem & { path: string }

function stemDate(path: string): string | null {
  const stem = path.split('/').pop()?.replace(/\.md$/, '') ?? ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(stem)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

export function buildWeekTaskData(
  taskMap: Record<string, ListItem[]>,
): Record<string, WeekTask[]> {
  const map: Record<string, WeekTask[]> = {}
  for (const [path, tasks] of Object.entries(taskMap)) {
    const fileStemDate = stemDate(path)
    for (const task of tasks) {
      // Use explicit [due::...] if present; fall back to file's stem date.
      // Never use the mtime/created fallback — it causes all tasks to pile up on one day.
      const date = task.fields['due'] ?? fileStemDate
      if (!date) continue
      ;(map[date] ??= []).push({ ...task, path })
    }
  }
  return map
}
