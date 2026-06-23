import type { Edge } from './selection'

export type ColumnFilter =
  | { by: 'heading'; value: string }
  | { by: 'tag'; value: string }
  | { by: 'direction'; value: 'out' | 'in' }
  | null

export type Column = { filter: ColumnFilter; priority: number; repeat: boolean }

function matches(filter: ColumnFilter, edges: Edge[]): boolean {
  if (filter === null) return true
  return edges.some(e => {
    if (filter.by === 'heading') return e.headingPath.includes(filter.value)
    if (filter.by === 'tag') return e.lineTags.includes(filter.value)
    return e.dir === filter.value
  })
}

/** 每个 note 按 priority 升序找第一个匹配列归入；repeat 列额外把所有匹配项也收一份。 */
export function assignColumns(
  noteIds: string[],
  edgesByNote: Map<string, Edge[]>,
  columns: Column[],
): string[][] {
  const order = columns
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.priority - b.c.priority)
  const out: string[][] = columns.map(() => [])

  for (const note of noteIds) {
    const edges = edgesByNote.get(note) ?? []
    let claimed = false
    for (const { c, i } of order) {
      if (!matches(c.filter, edges)) continue
      if (c.repeat) { out[i].push(note); continue }
      if (!claimed) { out[i].push(note); claimed = true }
    }
  }
  return out
}
