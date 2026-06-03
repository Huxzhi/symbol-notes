import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerView,
  getView,
  getFileViewForPath,
  _clearViewRegistryForTest,
} from '../pluginRegistry'

beforeEach(() => _clearViewRegistryForTest())

const makeFileDef = (type: string, match: string) => ({
  kind: 'file' as const,
  type,
  getDisplayText: (p: string) => p.split('/').pop()!,
  canAcceptFile: (p: string) => p.endsWith(match),
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

describe('getFileViewForPath', () => {
  it('returns undefined when no match', () => {
    expect(getFileViewForPath('notes/file.xyz')).toBeUndefined()
  })
  it('matches by extension', () => {
    const def = makeFileDef('markdown', '.md')
    registerView(def)
    expect(getFileViewForPath('notes/file.md')).toBe(def)
    expect(getFileViewForPath('notes/file.png')).toBeUndefined()
  })
  it('compound extension takes priority when registered last', () => {
    const mdDef = makeFileDef('markdown', '.md')
    const excalidrawDef = makeFileDef('excalidraw', '.excalidraw.md')
    registerView(mdDef)
    registerView(excalidrawDef)
    expect(getFileViewForPath('drawing.excalidraw.md')).toBe(excalidrawDef)
    expect(getFileViewForPath('notes/file.md')).toBe(mdDef)
  })
  it('ignores page defs', () => {
    registerView({
      kind: 'page',
      type: 'calendar',
      getDisplayText: () => '日历',
      component: (() => null) as any,
    })
    expect(getFileViewForPath('file.md')).toBeUndefined()
  })
})
