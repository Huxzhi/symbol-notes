import type { FileMeta } from '../../stores/types'

export interface Edge {
  from: string
  to: string
}

export interface SelectionResult {
  paths: string[]
  edges: Edge[]
}

/**
 * 以 focus 为中心圈出 1 跳邻域：
 *   - focus 自身
 *   - focus 的出链（经 resolve 解析、且目标存在于 files）
 *   - 反链到 focus 的文件（backlinkMap[focus]，过滤掉已不存在的）
 * 同时记录有向边：focus→出链目标、反链者→focus。
 * focus 不存在于 files 时返回空结果。
 */
export function buildSelection(
  focus: string,
  files: Record<string, Pick<FileMeta, 'outLinks'>>,
  backlinkMap: Record<string, string[]>,
  resolve: (target: string) => string | null,
): SelectionResult {
  if (!(focus in files)) return { paths: [], edges: [] }

  const paths = new Set<string>([focus])
  const edges: Edge[] = []
  const seenEdge = new Set<string>()
  const addEdge = (from: string, to: string) => {
    const key = `${from} ${to}`
    if (seenEdge.has(key)) return
    seenEdge.add(key)
    edges.push({ from, to })
  }

  for (const target of files[focus].outLinks) {
    const r = resolve(target)
    if (r && r in files) {
      paths.add(r)
      addEdge(focus, r)
    }
  }

  for (const b of backlinkMap[focus] ?? []) {
    if (b in files) {
      paths.add(b)
      addEdge(b, focus)
    }
  }

  return { paths: [...paths], edges }
}
