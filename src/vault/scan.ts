// 职责:FS walk → fileMap(仅 stat 的 FileEntry)+ 文件树(buildScan)、快速重扫(rescanTree)。
// 这是「打开 vault 文件夹」时建树的部分;读+解析内容、播种临时内容都在 metadata。
import type { FileEntry, TreeNode } from '../stores/types'
import { buildTreeFromScan, setFileTree } from './fileTree'
import { scanTree, type ScanEntry } from './fs/io'
import { setVaultStore } from './store'

export interface ScanResult {
  entries: Record<string, FileEntry>
  activePaths: Set<string>
  tree: TreeNode
}

export async function buildScan(onDetected?: () => void): Promise<ScanResult> {
  const entries: Record<string, FileEntry> = {}
  const activePaths = new Set<string>()
  const roots = await scanTree(onDetected)

  const walk = (es: ScanEntry[]): void => {
    for (const e of es) {
      const { name, path, kind, parent } = e
      // size/mtime 占位 0：由 statAndSignal 的 statFiles 补真实值。
      entries[path] = { name, path, kind, parent, size: 0, mtime: 0, hash: '' }
      if (kind === 'directory') walk(e.children ?? [])
      else activePaths.add(path)
    }
  }
  walk(roots)
  return { entries, activePaths, tree: buildTreeFromScan(roots) }
}

/** 快速重扫:只重建 fileMap + 树,不解析内容(内容由后续 reindex/解析补)。 */
export async function rescanTree(): Promise<void> {
  const { entries, tree } = await buildScan()
  setVaultStore('files', entries)
  setFileTree(tree)
}
