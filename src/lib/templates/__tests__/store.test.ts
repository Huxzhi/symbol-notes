import { describe, it, expect } from 'vitest'
import { filterTemplateFiles } from '../store'
import type { FileMeta } from '../../../stores/types'

function file(path: string): FileMeta {
  const name = path.split('/').pop()!
  return {
    name,
    path,
    kind: 'file',
    parent: path.includes('/') ? path.split('/').slice(0, -1).join('/') : null,
    size: 0,
    mtime: 0,
    hash: '',
    frontmatter: {},
    outLinks: [],
    etags: [],
    tags: [],
    aliases: [],
    created: '',
    updated: null,
    dated: '',
    lists: [],
  } as FileMeta
}

describe('filterTemplateFiles', () => {
  const files: Record<string, FileMeta> = {
    'templates/daily.md': file('templates/daily.md'),
    'templates/meeting.md': file('templates/meeting.md'),
    'templates/img.png': file('templates/img.png'),
    'journal/2026-06-07.md': file('journal/2026-06-07.md'),
    'root.md': file('root.md'),
  }

  it('returns only .md files under the configured folder, name without extension', () => {
    const result = filterTemplateFiles(files, 'templates')
    expect(result).toEqual([
      { name: 'daily', path: 'templates/daily.md' },
      { name: 'meeting', path: 'templates/meeting.md' },
    ])
  })
  it('tolerates trailing slash in folder', () => {
    expect(filterTemplateFiles(files, 'templates/').map((t) => t.name)).toEqual([
      'daily',
      'meeting',
    ])
  })
  it('returns empty array when folder is blank', () => {
    expect(filterTemplateFiles(files, '')).toEqual([])
  })
  it('returns empty array when folder has no markdown files', () => {
    expect(filterTemplateFiles(files, 'nonexistent')).toEqual([])
  })
})
