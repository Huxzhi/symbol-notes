import type { FileMeta } from '../../stores/types'
import type { Direction, Edge, Neighborhood } from './selection'

/** path → 触及它的所有边（用于按上下文归列）。 */
export function edgesByNote(edges: Edge[]): Map<string, Edge[]> {
  const m = new Map<string, Edge[]>()
  for (const e of edges) {
    for (const p of [e.from, e.to]) {
      const arr = m.get(p) ?? []
      arr.push(e)
      m.set(p, arr)
    }
  }
  return m
}

export interface TimelineEvent {
  path: string
  date: string
  span?: [string, string]
  title: string
  tags: string[]
  linkCount: number
  dirs: Direction[]   // 来源标注（out/in，可并存）
  kind: 'note'
  thumbnail?: string
  snippet?: string
}

/** path → stem（去掉目录与 .md 后缀） */
function stem(path: string): string {
  return path.split('/').pop()!.replace(/\.md$/, '')
}

/**
 * 把选区派生为按时间排序的事件流。
 * date 锚点 = created；updated 存在则给出 [created, updated] 生命期。
 * linkCount 统计选区内触及该 path 的边数。
 * 选区中已不在 files 的路径被跳过（容忍删除/未解析）。
 */
export function deriveEvents(
  neighborhood: Neighborhood,
  files: Record<string, Pick<FileMeta, 'created' | 'updated' | 'tags'>>,
): TimelineEvent[] {
  const degree = new Map<string, number>()
  for (const e of neighborhood.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1)
  }

  const events: TimelineEvent[] = []
  for (const { path, dirs } of neighborhood.notes) {
    const meta = files[path]
    if (!meta) continue
    events.push({
      path,
      date: meta.created,
      span: meta.updated ? [meta.created, meta.updated] : undefined,
      title: stem(path),
      tags: meta.tags,
      linkCount: degree.get(path) ?? 0,
      dirs,
      kind: 'note',
    })
  }

  events.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.path < b.path ? -1 : 1,
  )
  return events
}
