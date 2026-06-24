import type { FileMeta, DateBucket, Task } from '../../stores/types'
import { setVaultStore, vaultStore } from '../store'

// 日历日期归类逻辑（原先散在 calendar 插件的 buildDayData/buildTaskDayData/
// buildEntryDayData）。放在 vault 层，因为增量维护需要 reindex 时的 prev/next
// FileMeta —— 与 taskMap/tagMap 同属"按文件改动增量更新的聚合"。

const ENTRY_SIGNIFIERS = new Set(['-', '=', '~'])
const RE_DATE_COMPACT = /^(\d{4})(\d{2})(\d{2})/
const RE_DATE_DASHED = /^(\d{4})-(\d{2})-(\d{2})/

/** 文件名前缀日期：'2026-06-14.md' 或 '20260614-x.md' → '2026-06-14'。 */
function stemDate(path: string): string | null {
  const stem = path.split('/').pop()!.replace(/\.md$/, '')
  let m = RE_DATE_DASHED.exec(stem)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = RE_DATE_COMPACT.exec(stem)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

/** 单个文件对各日期桶的全部贡献。 */
export interface FileCal {
  datedDate: string | null
  createdDate: string | null
  updatedDate: string | null
  tasks: { date: string; task: Task }[]
  entries: { date: string; entry: Task }[]
}

const EMPTY_CAL: FileCal = {
  datedDate: null,
  createdDate: null,
  updatedDate: null,
  tasks: [],
  entries: [],
}

/**
 * 计算某文件落在哪些日期、各是什么条目。语义严格复刻原
 * buildDayData / buildTaskDayData / buildEntryDayData：
 *  - 有 dated（frontmatter.dated 优先，否则文件名前缀日期）→ 只进 dated，不进 created/updated
 *  - 否则用 FileMeta.created / updated
 *  - 任务/条目的回退日期用 FileMeta.dated（与 dated 桶的判定不同）
 */
export function fileCal(path: string, meta: FileMeta | undefined): FileCal {
  if (!meta || meta.kind !== 'file') return EMPTY_CAL

  const fmDated =
    typeof meta.frontmatter.dated === 'string' && meta.frontmatter.dated.length >= 10
      ? meta.frontmatter.dated.slice(0, 10)
      : null
  const d = fmDated ?? stemDate(path)

  let datedDate: string | null = null
  let createdDate: string | null = null
  let updatedDate: string | null = null
  if (d) {
    datedDate = d
  } else {
    if (meta.created) createdDate = meta.created
    if (meta.updated && meta.updated !== meta.created) updatedDate = meta.updated
  }

  const fallback = meta.dated || null
  const tasks: { date: string; task: Task }[] = []
  const entries: { date: string; entry: Task }[] = []
  for (const it of meta.lists) {
    if (it.task) {
      const due = it.fields['due'] ?? fallback
      if (due) tasks.push({ date: due, task: { ...it, path } })
    }
    if (it.signifier && ENTRY_SIGNIFIERS.has(it.signifier)) {
      const date = it.fields['due'] ?? fallback
      if (date) entries.push({ date, entry: { ...it, path } })
    }
  }
  return { datedDate, createdDate, updatedDate, tasks, entries }
}

function emptyBucket(): DateBucket {
  return { dated: [], created: [], updated: [], tasks: [], entries: [] }
}

function isEmptyBucket(b: DateBucket): boolean {
  return (
    b.dated.length === 0 &&
    b.created.length === 0 &&
    b.updated.length === 0 &&
    b.tasks.length === 0 &&
    b.entries.length === 0
  )
}

function withoutPath(b: DateBucket, path: string): DateBucket {
  return {
    dated: b.dated.filter((p) => p !== path),
    created: b.created.filter((p) => p !== path),
    updated: b.updated.filter((p) => p !== path),
    tasks: b.tasks.filter((t) => t.path !== path),
    entries: b.entries.filter((e) => e.path !== path),
  }
}

function datesOf(cal: FileCal): Set<string> {
  const s = new Set<string>()
  if (cal.datedDate) s.add(cal.datedDate)
  if (cal.createdDate) s.add(cal.createdDate)
  if (cal.updatedDate) s.add(cal.updatedDate)
  for (const t of cal.tasks) s.add(t.date)
  for (const e of cal.entries) s.add(e.date)
  return s
}

// ── 纯函数（在普通 map 上操作，便于测试 & 全量构建） ──────────────────────────

/** 把某文件的贡献加进普通 map（原地修改）。 */
export function calAdd(map: Record<string, DateBucket>, path: string, cal: FileCal): void {
  const get = (date: string) => (map[date] ??= emptyBucket())
  if (cal.datedDate) get(cal.datedDate).dated.push(path)
  if (cal.createdDate) get(cal.createdDate).created.push(path)
  if (cal.updatedDate) get(cal.updatedDate).updated.push(path)
  for (const { date, task } of cal.tasks) get(date).tasks.push(task)
  for (const { date, entry } of cal.entries) get(date).entries.push(entry)
}

/** 把某文件的贡献从普通 map 移除（原地修改，空桶删 key）。 */
export function calRemove(map: Record<string, DateBucket>, path: string, cal: FileCal): void {
  for (const date of datesOf(cal)) {
    const b = map[date]
    if (!b) continue
    const nb = withoutPath(b, path)
    if (isEmptyBucket(nb)) delete map[date]
    else map[date] = nb
  }
}

/** 从全量 files 一次性构建（扫描完成后的基线）。 */
export function buildCalendarByDate(files: Record<string, FileMeta>): Record<string, DateBucket> {
  const map: Record<string, DateBucket> = {}
  for (const [path, meta] of Object.entries(files)) calAdd(map, path, fileCal(path, meta))
  return map
}

// ── store 写入（每个受影响日期单 key 更新，下游 cell 按 date 订阅） ───────────

/** 扫描后写入基线。 */
export function buildCalendar(files: Record<string, FileMeta>): void {
  setVaultStore('calendarByDate', buildCalendarByDate(files))
}

function storeAdd(path: string, cal: FileCal): void {
  const add = (date: string, mut: (b: DateBucket) => DateBucket) =>
    setVaultStore('calendarByDate', date, (b: DateBucket | undefined) => mut(b ?? emptyBucket()))
  if (cal.datedDate) add(cal.datedDate, (b) => ({ ...b, dated: [...b.dated, path] }))
  if (cal.createdDate) add(cal.createdDate, (b) => ({ ...b, created: [...b.created, path] }))
  if (cal.updatedDate) add(cal.updatedDate, (b) => ({ ...b, updated: [...b.updated, path] }))
  for (const { date, task } of cal.tasks) add(date, (b) => ({ ...b, tasks: [...b.tasks, task] }))
  for (const { date, entry } of cal.entries) add(date, (b) => ({ ...b, entries: [...b.entries, entry] }))
}

function storeRemove(path: string, cal: FileCal): void {
  for (const date of datesOf(cal)) {
    const cur = vaultStore.calendarByDate[date]
    if (!cur) continue
    const nb = withoutPath(cur, path)
    setVaultStore(
      'calendarByDate',
      date,
      (isEmptyBucket(nb) ? undefined : nb) as DateBucket,
    )
  }
}

/** 单文件内容变化：移除旧贡献、加入新贡献（只动受影响的日期 key）。 */
export function applyFileCalendar(
  path: string,
  prev: FileMeta | undefined,
  next: FileMeta | undefined,
): void {
  storeRemove(path, fileCal(path, prev))
  storeAdd(path, fileCal(path, next))
}

/** 文件删除/移走：移除其全部日期贡献。 */
export function removeFileCalendar(path: string, meta: FileMeta | undefined): void {
  storeRemove(path, fileCal(path, meta))
}
