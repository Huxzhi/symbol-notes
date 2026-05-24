import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerView,
  getView,
  getFileViewForExt,
  _clearRegistryForTest,
} from '../viewRegistry'

beforeEach(() => _clearRegistryForTest())

const makeFileDef = (type: string, ext: string) => ({
  kind: 'file' as const,
  type,
  getDisplayText: (p: string) => p.split('/').pop()!,
  canAcceptFile: (e: string) => e === ext,
  component: (() => null) as any,
})

describe('getView', () => {
  it('returns undefined for unregistered type', () => {
    expect(getView('markdown')).toBeUndefined()
  })
  it('returns the registered def', () => {
    const def = makeFileDef('markdown', '.md')
    registerView(def)
    expect(getView('markdown')).toBe(def)
  })
})

describe('getFileViewForExt', () => {
  it('returns undefined when no match', () => {
    expect(getFileViewForExt('.xyz')).toBeUndefined()
  })
  it('matches by extension', () => {
    const def = makeFileDef('markdown', '.md')
    registerView(def)
    expect(getFileViewForExt('.md')).toBe(def)
    expect(getFileViewForExt('.png')).toBeUndefined()
  })
  it('ignores page defs', () => {
    registerView({
      kind: 'page',
      type: 'calendar',
      getDisplayText: () => '日历',
      component: (() => null) as any,
    })
    expect(getFileViewForExt('.md')).toBeUndefined()
  })
})
