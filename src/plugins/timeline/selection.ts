import type { FileMeta } from '../../stores/types'

export type Edge = {
  from: string
  to: string
  dir: 'out' | 'in'        // 该边相对其链接物理所在文件的方向
  headingPath: string[]    // 链接站点的标题上下文
  lineTags: string[]       // 链接站点的同行标签
}

export interface Neighborhood {
  notes: { path: string; hop: number }[]
  edges: Edge[]
}

/**
 * 从 focus 出发，无向地沿出链 + 入链逐层 BFS：
 *   - out 边：cur 的 outLinks 中 resolve 到目标的那条，上下文取该条；
 *   - in  边：谁链接了 cur，其 outLinks 中 resolve 到 cur 的那条，上下文取该条。
 * 按层推进、整层保留：扩完一层后若累计文件数 ≥ maxFiles 则停止，不切半层。
 * focus 不存在于 files 时返回空结果。
 */
export function buildNeighborhood(
  focus: string,
  files: Record<string, Pick<FileMeta, 'outLinks'>>,
  backlinkMap: Record<string, string[]>,
  resolve: (target: string) => string | null,
  opts: { maxFiles: number },
): Neighborhood {
  if (!(focus in files)) return { notes: [], edges: [] }

  const hop = new Map<string, number>([[focus, 0]])
  const edges: Edge[] = []
  const seenEdge = new Set<string>()
  const addEdge = (e: Edge) => {
    const key = `${e.from} ${e.to} ${e.dir}`
    if (seenEdge.has(key)) return
    seenEdge.add(key)
    edges.push(e)
  }

  let frontier = [focus]
  let depth = 0
  while (frontier.length && hop.size < opts.maxFiles) {
    const next: string[] = []
    for (const cur of frontier) {
      // 出边：cur 的 outLinks
      for (const l of files[cur]?.outLinks ?? []) {
        const t = resolve(l.target)
        if (!t || !(t in files)) continue
        addEdge({ from: cur, to: t, dir: 'out', headingPath: l.headingPath, lineTags: l.lineTags })
        if (!hop.has(t)) { hop.set(t, depth + 1); next.push(t) }
      }
      // 入边：谁链接了 cur
      for (const src of backlinkMap[cur] ?? []) {
        if (!(src in files)) continue
        const l = files[src].outLinks.find(x => resolve(x.target) === cur)
        addEdge({
          from: src, to: cur, dir: 'in',
          headingPath: l?.headingPath ?? [], lineTags: l?.lineTags ?? [],
        })
        if (!hop.has(src)) { hop.set(src, depth + 1); next.push(src) }
      }
    }
    depth++
    if (hop.size >= opts.maxFiles) break   // 整层扩完后判断，不切半层
    frontier = next
  }

  return { notes: [...hop].map(([path, h]) => ({ path, hop: h })), edges }
}
