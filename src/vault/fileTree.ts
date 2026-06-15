import { createSignal } from 'solid-js'
import type { TreeNode } from '../stores/types'
import type { ScanEntry } from './fs/types'

// 结构树：普通对象（非响应式，省 proxy 开销）+ 一个粗粒度版本信号。
// 任何结构变更（增删/改名/移动）末尾调 bumpStruct()，面板的 flatten memo 读
// structVer() 重算。节点对象引用稳定 → re-flatten 只更新真正变化的行。

function emptyRoot(): TreeNode {
  return { name: '', path: '', kind: 'directory', parent: null, children: [] }
}

let _root: TreeNode = emptyRoot()
let _byPath: Map<string, TreeNode> | null = null

const [structVer, setStructVer] = createSignal(0)
export { structVer }

/** 标记结构已变：让 flatten memo 重算 + 失效 byPath 缓存。 */
export function bumpStruct(): void {
  _byPath = null
  setStructVer((v) => v + 1)
}

export function fileTreeRoot(): TreeNode {
  return _root
}

function isOtherFile(name: string): boolean {
  return !name.endsWith('.md')
}

function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
  return a.name.localeCompare(b.name)
}

/** 从扫描的嵌套结果直接构建树（顺着递归层级映射，无需查父；丢弃 stat）。 */
export function buildTreeFromScan(roots: ScanEntry[]): TreeNode {
  const root = emptyRoot()
  const map = (entries: ScanEntry[]): TreeNode[] =>
    entries
      .map((e): TreeNode => ({
        name: e.name,
        path: e.path,
        kind: e.kind,
        parent: e.parent,
        ...(e.kind === 'directory' ? { children: map(e.children ?? []) } : {}),
      }))
      .sort(compareNodes)
  root.children = map(roots)
  return root
}

/** 替换整棵树（扫描完成后的基线）。 */
export function setFileTree(root: TreeNode): void {
  _root = root
  bumpStruct()
}

/** 按 path 定位节点（path 自带层级，按 '/' 逐层下行）。 */
export function nodeAt(path: string): TreeNode | undefined {
  if (path === '') return _root
  let cur: TreeNode | undefined = _root
  for (const seg of path.split('/')) {
    cur = cur?.children?.find((c) => c.name === seg)
    if (!cur) return undefined
  }
  return cur
}

/** 派生的扁平 path→node 视图（懒建 + structVer 失效），供链接引擎/模板/embed 用。 */
export function fileByPath(): Map<string, TreeNode> {
  if (!_byPath) {
    const m = new Map<string, TreeNode>()
    const rec = (n: TreeNode) => {
      for (const c of n.children ?? []) {
        m.set(c.path, c)
        rec(c)
      }
    }
    rec(_root)
    _byPath = m
  }
  return _byPath
}

export interface FlatRow {
  entry: TreeNode
  depth: number
}

/** 只遍历展开路径 → O(可见行)；entry 是稳定的节点引用。 */
export function flatten(expanded: string[], showOther: boolean): FlatRow[] {
  const expandedSet = new Set(expanded)
  const rows: FlatRow[] = []
  const walk = (node: TreeNode, depth: number) => {
    for (const child of node.children ?? []) {
      if (child.kind === 'file' && isOtherFile(child.name) && !showOther) continue
      rows.push({ entry: child, depth })
      if (child.kind === 'directory' && expandedSet.has(child.path)) walk(child, depth + 1)
    }
  }
  walk(_root, 0)
  return rows
}

// ── 结构变更（就地改树，调用方负责 bumpStruct + 各 path-keyed store remap） ───

/** 插入一个新节点到其 parent 下，保持排序。 */
export function insertNode(node: TreeNode): void {
  const parent = nodeAt(node.parent ?? '') ?? _root
  const children = (parent.children ??= [])
  children.push(node)
  children.sort(compareNodes)
}

/** 移除某 path 的节点（连同子树）。返回被移除的全部 path（节点+后代）。 */
export function removeNode(path: string): string[] {
  const node = nodeAt(path)
  if (!node) return []
  const parent = nodeAt(node.parent ?? '') ?? _root
  if (parent.children) {
    const i = parent.children.findIndex((c) => c.path === path)
    if (i >= 0) parent.children.splice(i, 1)
  }
  const removed: string[] = []
  const collect = (n: TreeNode) => {
    removed.push(n.path)
    n.children?.forEach(collect)
  }
  collect(node)
  return removed
}

/** 重写某节点及其全部后代的 path（改名/移动后）。返回 [旧path, 新path][]。 */
function rewritePaths(node: TreeNode, newPath: string, newParent: string | null): [string, string][] {
  const remaps: [string, string][] = []
  const rec = (n: TreeNode, np: string, par: string | null) => {
    remaps.push([n.path, np])
    n.path = np
    n.parent = par
    n.children?.forEach((c) => rec(c, `${np}/${c.name}`, np))
  }
  rec(node, newPath, newParent)
  return remaps
}

/** 改名：节点留在原父下，仅换 name/path（及后代 path）。返回 remaps。 */
export function renameNode(path: string, newName: string): [string, string][] {
  const node = nodeAt(path)
  if (!node) return []
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  node.name = newName
  const remaps = rewritePaths(node, dir ? `${dir}/${newName}` : newName, node.parent)
  const parent = nodeAt(dir) ?? _root
  parent.children?.sort(compareNodes)
  return remaps
}

/** 移动：把节点挪到新父目录下。返回 remaps。 */
export function moveNode(path: string, destDir: string | null): [string, string][] {
  const node = nodeAt(path)
  if (!node) return []
  const oldParent = nodeAt(node.parent ?? '') ?? _root
  if (oldParent.children) {
    const i = oldParent.children.findIndex((c) => c.path === path)
    if (i >= 0) oldParent.children.splice(i, 1)
  }
  const newPath = destDir ? `${destDir}/${node.name}` : node.name
  const remaps = rewritePaths(node, newPath, destDir)
  const newParent = nodeAt(destDir ?? '') ?? _root
  const children = (newParent.children ??= [])
  children.push(node)
  children.sort(compareNodes)
  return remaps
}
