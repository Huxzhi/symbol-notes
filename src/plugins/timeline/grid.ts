import type { TimelineEvent } from './events'
import type { Edge } from './selection'
import type { Column } from './columns'
import { assignColumns } from './columns'
import { edgesByNote } from './events'

export interface Grid {
  rows: string[]                                    // 升序日期；可见事件 date 的并集
  cells: Map<string, Map<number, TimelineEvent[]>>  // cells.get(date)?.get(colIdx)
  arrows: { from: string; to: string }[]            // 两端都可见的出链边
}

export function buildGrid(
  events: TimelineEvent[],
  columns: Column[],
  edges: Edge[],
  isDiary: (path: string) => boolean,
): Grid {
  const visible = new Set(events.map(e => e.path))
  const byNote = edgesByNote(edges)
  const byPath = new Map(events.map(e => [e.path, e]))

  const buckets = assignColumns(events.map(e => e.path), byNote, columns, isDiary)

  const cells = new Map<string, Map<number, TimelineEvent[]>>()
  buckets.forEach((ids, colIdx) => {
    for (const id of ids) {
      const e = byPath.get(id)
      if (!e) continue
      let row = cells.get(e.date)
      if (!row) { row = new Map(); cells.set(e.date, row) }
      const arr = row.get(colIdx) ?? []
      arr.push(e)
      row.set(colIdx, arr)
    }
  })

  const rows = [...new Set(events.map(e => e.date))].sort()

  const arrows = edges
    .filter(e => e.dir === 'out' && visible.has(e.from) && visible.has(e.to))
    .map(e => ({ from: e.from, to: e.to }))

  return { rows, cells, arrows }
}
