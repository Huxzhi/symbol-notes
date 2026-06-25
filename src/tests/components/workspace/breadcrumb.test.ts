import { describe, it, expect } from 'vitest'
import { splitBreadcrumb } from '../../../components/workspace/breadcrumb'

describe('splitBreadcrumb', () => {
  it('splits a nested path into cumulative folder segments + filename', () => {
    expect(splitBreadcrumb('journal/2026/note.md')).toEqual({
      folders: [
        { name: 'journal', path: 'journal' },
        { name: '2026', path: 'journal/2026' },
      ],
      file: 'note',
    })
  })

  it('handles a root-level file (no folders)', () => {
    expect(splitBreadcrumb('note.md')).toEqual({ folders: [], file: 'note' })
  })

  it('strips only the trailing .md', () => {
    expect(splitBreadcrumb('a.md/b.md')).toEqual({
      folders: [{ name: 'a.md', path: 'a.md' }],
      file: 'b',
    })
  })
})
