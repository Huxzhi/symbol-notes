import { describe, it, expect } from 'vitest'
import { splitWikiTarget } from '../wikiTarget'

describe('splitWikiTarget', () => {
  it('无 anchor 时原样返回 base', () => {
    expect(splitWikiTarget('复测计划')).toEqual({ base: '复测计划' })
  })
  it('切出 anchor', () => {
    expect(splitWikiTarget('复测计划#计划')).toEqual({ base: '复测计划', anchor: '计划' })
  })
  it('保留路径,只在第一个 # 切', () => {
    expect(splitWikiTarget('folder/A#标题#x')).toEqual({ base: 'folder/A', anchor: '标题#x' })
  })
  it('空 anchor 视为无 anchor', () => {
    expect(splitWikiTarget('A#')).toEqual({ base: 'A' })
  })
})
