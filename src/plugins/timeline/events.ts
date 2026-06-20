import type { FileMeta } from '../../stores/types'
import type { SelectionResult } from './selection'

export interface TimelineEvent {
  path: string
  date: string
  span?: [string, string]
  title: string
  tags: string[]
  linkCount: number
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
  selection: SelectionResult,
  files: Record<string, Pick<FileMeta, 'created' | 'updated' | 'tags'>>,
): TimelineEvent[] {
  const degree = new Map<string, number>()
  for (const e of selection.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1)
  }

  const events: TimelineEvent[] = []
  for (const path of selection.paths) {
    const meta = files[path]
    if (!meta) continue
    events.push({
      path,
      date: meta.created,
      span: meta.updated ? [meta.created, meta.updated] : undefined,
      title: stem(path),
      tags: meta.tags,
      linkCount: degree.get(path) ?? 0,
      kind: 'note',
    })
  }

  events.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.path < b.path ? -1 : 1,
  )
  return events
}
