// 职责:FS walk → fileMap(仅 stat 的 FileEntry)+ 文件树(buildScan)、快速重扫(rescanTree)。
// 这是「打开 vault 文件夹」时建树的部分;读+解析内容、播种临时内容都在 metadata。
import type { FileEntry, TreeNode } from '../stores/types'
import { setVaultStore } from './store'
import { buildTreeFromScan, setFileTree } from './fileTree'
import { scanTree, type ScanEntry } from './fs/io'

export interface ScanResult {
  entries: Record<string, FileEntry>
  activePaths: Set<string>
  tree: TreeNode
}

export async function buildScan(onDetected?: () => void): Promise<ScanResult> {
  const entries: Record<string, FileEntry> = {}
  const activePaths = new Set<string>()
  const roots = await scanTree(32, onDetected)
  // 顺着嵌套结果一遍：扁平化成 fileMap（仅 stat）+ 收集活跃路径。
  const walk = (es: ScanEntry[]): void => {
    for (const e of es) {
      const { name, path, kind, parent, size, mtime } = e
      if (kind === 'directory') {
        entries[path] = { name, path, kind: 'directory', parent, size: 0, mtime: 0, hash: '' }
        walk(e.children ?? [])
      } else {
        entries[path] = { name, path, kind: 'file', parent, size, mtime, hash: '' }
        activePaths.add(path)
      }
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
