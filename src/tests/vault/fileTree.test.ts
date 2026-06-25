import { describe, it, expect, beforeEach } from 'vitest'
import {
  buildTreeFromScan, setFileTree, nodeAt, flatten, fileByPath,
  insertNode, removeNode, renameNode, moveNode,
} from '../../vault/fileTree'
import type { TreeNode } from '../../stores/types'
import type { ScanEntry } from '../../vault/fs/types'

function file(path: string): ScanEntry {
  const name = path.split('/').pop()!
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null
  return { name, path, kind: 'file', parent, size: 0, mtime: 0 }
}
function dir(path: string, children: ScanEntry[]): ScanEntry {
  const name = path.split('/').pop()!
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null
  return { name, path, kind: 'directory', parent, size: 0, mtime: 0, children }
}

// nested (as the scan walk produces it): top-level notes + a folder with a
// child note + image + a nested folder.
const ROOTS: ScanEntry[] = [
  file('b.md'),
  file('a.md'),
  dir('dir', [
    file('dir/c.md'),
    file('dir/img.png'),
    dir('dir/sub', [file('dir/sub/d.md')]),
  ]),
]

beforeEach(() => setFileTree(buildTreeFromScan(ROOTS)))

describe('buildTree + nodeAt', () => {
  it('attaches children to parents and resolves by path', () => {
    expect(nodeAt('dir/c.md')!.name).toBe('c.md')
    expect(nodeAt('dir/sub/d.md')!.parent).toBe('dir/sub')
    expect(nodeAt('nope')).toBeUndefined()
  })

  it('sorts directories before files then alphabetically', () => {
    const dir = nodeAt('dir')!
    expect(dir.children!.map((c) => c.name)).toEqual(['sub', 'c.md', 'img.png'])
  })
})

describe('flatten', () => {
  it('collapsed by default shows only top level', () => {
    const rows = flatten([], true)
    expect(rows.map((r) => r.entry.path)).toEqual(['dir', 'a.md', 'b.md'])
  })

  it('expands listed folders with depth + 1, children after parent', () => {
    const rows = flatten(['dir'], true)
    expect(rows.map((r) => r.entry.path)).toEqual(['dir', 'dir/sub', 'dir/c.md', 'dir/img.png', 'a.md', 'b.md'])
    expect(rows.find((r) => r.entry.path === 'dir/c.md')!.depth).toBe(1)
  })

  it('hides non-md when showOther is false', () => {
    const rows = flatten(['dir'], false)
    expect(rows.find((r) => r.entry.path === 'dir/img.png')).toBeUndefined()
  })

  it('entry is the stable node reference', () => {
    expect(flatten(['dir'], true).find((r) => r.entry.path === 'dir/c.md')!.entry).toBe(nodeAt('dir/c.md'))
  })
})

describe('mutations', () => {
  it('insertNode keeps sort order', () => {
    insertNode({ name: 'aa.md', path: 'dir/aa.md', kind: 'file', parent: 'dir' })
    expect(nodeAt('dir')!.children!.map((c) => c.name)).toEqual(['sub', 'aa.md', 'c.md', 'img.png'])
  })

  it('removeNode returns the removed subtree paths', () => {
    const removed = removeNode('dir').sort()
    expect(removed).toEqual(['dir', 'dir/c.md', 'dir/img.png', 'dir/sub', 'dir/sub/d.md'])
    expect(nodeAt('dir')).toBeUndefined()
  })

  it('renameNode rewrites the node + descendant paths', () => {
    const remaps = renameNode('dir', 'docs')
    expect(remaps).toContainEqual(['dir/sub/d.md', 'docs/sub/d.md'])
    expect(nodeAt('docs/sub/d.md')!.parent).toBe('docs/sub')
    expect(nodeAt('dir')).toBeUndefined()
  })

  it('moveNode reparents and rewrites paths', () => {
    const remaps = moveNode('a.md', 'dir')
    expect(remaps).toEqual([['a.md', 'dir/a.md']])
    expect(nodeAt('dir/a.md')!.parent).toBe('dir')
    expect(nodeAt('dir')!.children!.map((c) => c.name)).toContain('a.md')
  })

  it('fileByPath reflects the current tree after a bump', () => {
    const before = fileByPath()
    expect(before.has('dir/c.md')).toBe(true)
    removeNode('dir/c.md')
    // removeNode does not bump; callers do — simulate the bump effect via setFileTree
    setFileTree(nodeAt('') as TreeNode)
    expect(fileByPath().has('dir/c.md')).toBe(false)
  })
})
