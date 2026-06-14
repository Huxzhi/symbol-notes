import { describe, it, expect } from 'vitest'
import { flattenTree, resolveDropTarget, folderChain } from '../treeUtils'
import type { FileMeta } from '../../../stores/types'

function m(
  overrides: Pick<FileMeta, 'name' | 'path' | 'kind' | 'parent'>,
): FileMeta {
  return {
    size: 0, mtime: 0, hash: '',
    frontmatter: {}, outLinks: [], etags: [], tags: [], aliases: [],
    created: '2026-01-01', updated: null, dated: '2026-01-01', lists: [],
    ...overrides,
  }
}

const files: Record<string, FileMeta> = {
  'a.md':      m({ name: 'a.md',   path: 'a.md',        kind: 'file',      parent: null }),
  'b.md':      m({ name: 'b.md',   path: 'b.md',        kind: 'file',      parent: null }),
  'dir1':      m({ name: 'dir1',   path: 'dir1',        kind: 'directory', parent: null }),
  'dir1/c.md': m({ name: 'c.md',   path: 'dir1/c.md',  kind: 'file',      parent: 'dir1' }),
  'img.png':   m({ name: 'img.png', path: 'img.png',    kind: 'file',      parent: null }),
}

describe('flattenTree', () => {
  it('puts directories before files, children interleaved after parent', () => {
    const rows = flattenTree(null, 0, ['dir1'], files, true)
    // dir1 first (directory), then its child, then root-level files alphabetically
    expect(rows[0].entry.path).toBe('dir1')
    expect(rows[1].entry.path).toBe('dir1/c.md')
    expect(rows[2].entry.path).toBe('a.md')
    expect(rows[3].entry.path).toBe('b.md')
    expect(rows[4].entry.path).toBe('img.png')
  })

  it('includes children of expanded folders with depth + 1', () => {
    const rows = flattenTree(null, 0, ['dir1'], files, true)
    const dir = rows.find(r => r.entry.path === 'dir1')!
    const child = rows.find(r => r.entry.path === 'dir1/c.md')!
    expect(dir.depth).toBe(0)
    expect(child.depth).toBe(1)
  })

  it('child immediately follows parent in output order', () => {
    const rows = flattenTree(null, 0, ['dir1'], files, true)
    const dirIdx = rows.findIndex(r => r.entry.path === 'dir1')
    const childIdx = rows.findIndex(r => r.entry.path === 'dir1/c.md')
    expect(childIdx).toBe(dirIdx + 1)
  })

  it('collapses folders by default (only expanded folders reveal children)', () => {
    const rows = flattenTree(null, 0, [], files, true)
    expect(rows.find(r => r.entry.path === 'dir1/c.md')).toBeUndefined()
    expect(rows.find(r => r.entry.path === 'dir1')).toBeDefined()
  })

  it('skips non-md files when showOtherFiles is false', () => {
    const rows = flattenTree(null, 0, [], files, false)
    expect(rows.find(r => r.entry.path === 'img.png')).toBeUndefined()
  })

  it('includes non-md files when showOtherFiles is true', () => {
    const rows = flattenTree(null, 0, [], files, true)
    expect(rows.find(r => r.entry.path === 'img.png')).toBeDefined()
  })

  it('returns empty array for empty files map', () => {
    expect(flattenTree(null, 0, [], {}, false)).toEqual([])
  })
})

describe('resolveDropTarget', () => {
  it('returns own path for a directory entry', () => {
    const dir = m({ name: 'dir1', path: 'dir1', kind: 'directory', parent: null })
    expect(resolveDropTarget(dir)).toBe('dir1')
  })

  it('returns parent path for a file inside a folder', () => {
    const file = m({ name: 'c.md', path: 'dir1/c.md', kind: 'file', parent: 'dir1' })
    expect(resolveDropTarget(file)).toBe('dir1')
  })

  it('returns null for a root-level file', () => {
    const file = m({ name: 'a.md', path: 'a.md', kind: 'file', parent: null })
    expect(resolveDropTarget(file)).toBeNull()
  })
})

describe('folderChain', () => {
  it('returns the folder and all ancestors, root→target', () => {
    expect(folderChain('a/b/c')).toEqual(['a', 'a/b', 'a/b/c'])
  })

  it('returns a single segment for a top-level folder', () => {
    expect(folderChain('a')).toEqual(['a'])
  })

  it('returns empty for an empty path', () => {
    expect(folderChain('')).toEqual([])
  })
})
