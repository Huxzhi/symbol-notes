// 职责:FS walk → fileMap(仅 stat 的 FileMeta)+ 文件树(buildScan)、快速重扫(rescanTree)。
// 这是「打开 vault 文件夹」时建树的部分;读+解析内容在 metadata/parse/parseAll。
import type { FileMeta, TreeNode } from '../stores/types'
import { setVaultStore } from './store'
import { buildTreeFromScan, setFileTree } from './fileTree'
import { scanTree, type ScanEntry } from './fs/io'
import { extractDateFromName } from '../metadata/parse/extract'

export interface ScanResult {
  files: Record<string, FileMeta>
  activePaths: Set<string>
  tree: TreeNode
}

const EMPTY_CONTENT: Pick<
  FileMeta,
  | 'frontmatter'
  | 'outLinks'
  | 'etags'
  | 'tags'
  | 'aliases'
  | 'updated'
  | 'lists'
> = {
  frontmatter: {},
  outLinks: [],
  etags: [],
  tags: [],
  aliases: [],
  updated: null,
  lists: [],
}

export async function buildScan(onDetected?: () => void): Promise<ScanResult> {
  const files: Record<string, FileMeta> = {}
  const activePaths = new Set<string>()
  const epoch = new Date(0).toISOString().slice(0, 10)
  const roots = await scanTree(32, onDetected)
  // 顺着嵌套结果一遍：扁平化成 files（合并 store 仍需要）+ 收集活跃路径。
  const walk = (entries: ScanEntry[]): void => {
    for (const entry of entries) {
      const { name, path, kind, parent, size, mtime } = entry
      if (kind === 'directory') {
        files[path] = {
          name, path, kind: 'directory', parent,
          size: 0, mtime: 0, hash: '', ...EMPTY_CONTENT,
          created: epoch, dated: extractDateFromName(name) ?? epoch,
        }
        walk(entry.children ?? [])
      } else {
        const mtimeStr = new Date(mtime).toISOString().slice(0, 10)
        files[path] = {
          name, path, kind: 'file', parent,
          size, mtime, hash: '', ...EMPTY_CONTENT,
          created: mtimeStr, dated: extractDateFromName(name) ?? mtimeStr,
        }
        activePaths.add(path)
      }
    }
  }
  walk(roots)
  return { files, activePaths, tree: buildTreeFromScan(roots) }
}

/** 快速重扫:只重建 fileMap + 树,不解析内容。 */
export async function rescanTree(): Promise<void> {
  const { files, tree } = await buildScan()
  setVaultStore('files', files)
  setFileTree(tree)
}
