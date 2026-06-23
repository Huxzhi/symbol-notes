import { describe, it, expect } from 'vitest'
import { workspaceActions, setLeafInstances } from '../workspaceStore'

describe('takePendingReveal', () => {
  it('取后即清', () => {
    setLeafInstances('leaf-x', {
      cmView: null,
      isDirty: false,
      outLinks: [],
      headings: [],
      pendingReveal: { kind: 'heading', text: '计划' },
    })
    expect(workspaceActions.takePendingReveal('leaf-x')).toEqual({ kind: 'heading', text: '计划' })
    expect(workspaceActions.takePendingReveal('leaf-x')).toBeNull()
  })
})
