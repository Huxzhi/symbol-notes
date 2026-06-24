import type { Direction, Edge } from './selection'

export type ColumnFilter =
  | { by: 'diary' }
  | { by: 'heading'; value: string }
  | { by: 'tag'; value: string }
  | { by: 'direction'; value: 'out' | 'in' }
  | null

export type Column = { filter: ColumnFilter; priority: number; repeat: boolean }

function matches(
  filter: ColumnFilter,
  edges: Edge[],
  note: string,
  isDiary: (path: string) => boolean,
  dirsByNote: Map<string, Direction[]>,
): boolean {
  if (filter === null) return true
  if (filter.by === 'diary') return isDiary(note)
  if (filter.by === 'direction') return (dirsByNote.get(note) ?? []).includes(filter.value)
  return edges.some(e => {
    if (filter.by === 'heading') return e.headingPath.includes(filter.value)
    return e.lineTags.includes(filter.value) // tag
  })
}

/** 每个 note 按 priority 升序找第一个匹配列归入；repeat 列额外把所有匹配项也收一份。
 *  方向过滤用 dirsByNote（卡片的来源标注 out/in），与每条边的 dir 无关。 */
export function assignColumns(
  noteIds: string[],
  edgesByNote: Map<string, Edge[]>,
  columns: Column[],
  isDiary: (path: string) => boolean = () => false,
  dirsByNote: Map<string, Direction[]> = new Map(),
): string[][] {
  const order = columns
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.priority - b.c.priority)
  const out: string[][] = columns.map(() => [])

  for (const note of noteIds) {
    const edges = edgesByNote.get(note) ?? []
    let claimed = false
    for (const { c, i } of order) {
      if (!matches(c.filter, edges, note, isDiary, dirsByNote)) continue
      if (c.repeat) { out[i].push(note); continue }
      if (!claimed) { out[i].push(note); claimed = true }
    }
  }
  return out
}
