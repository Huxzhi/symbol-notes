import type { FileMeta } from '../../stores/types'

export interface FlatRow {
  entry: FileMeta
  depth: number
}

const MD_EXT = '.md'

export function isOtherFile(name: string): boolean {
  return !name.endsWith(MD_EXT)
}

/** 某文件夹路径的累计链：'a/b/c' → ['a','a/b','a/b/c']（根→目标）。 */
export function folderChain(path: string): string[] {
  const out: string[] = []
  let acc = ''
  for (const p of path.split('/').filter(Boolean)) {
    acc = acc ? `${acc}/${p}` : p
    out.push(acc)
  }
  return out
}

function childrenOf(
  parentPath: string | null,
  files: Record<string, FileMeta>,
): FileMeta[] {
  return Object.values(files)
    .filter(e => e.parent === parentPath)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

export function flattenTree(
  parentPath: string | null,
  depth: number,
  expanded: string[],
  files: Record<string, FileMeta>,
  showOtherFiles: boolean,
): FlatRow[] {
  const rows: FlatRow[] = []
  for (const entry of childrenOf(parentPath, files)) {
    if (entry.kind === 'file' && isOtherFile(entry.name) && !showOtherFiles) continue
    rows.push({ entry, depth })
    if (entry.kind === 'directory' && expanded.includes(entry.path)) {
      rows.push(...flattenTree(entry.path, depth + 1, expanded, files, showOtherFiles))
    }
  }
  return rows
}

export function resolveDropTarget(entry: FileMeta): string | null {
  return entry.kind === 'directory' ? entry.path : entry.parent
}
