import { describe, it, expect } from 'vitest'
import { findWikiLink, findHeading } from '../../lib/linkLocate'

describe('findWikiLink', () => {
  it('定位 [[stem]] 本身的范围', () => {
    const doc = '前文 [[复测计划]] 后文'
    const r = findWikiLink(doc, '复测计划')!
    expect(doc.slice(r.from, r.to)).toBe('[[复测计划]]')
  })
  it('容忍别名与锚点', () => {
    const doc = 'x [[复测计划#步骤|看]] y'
    const r = findWikiLink(doc, '复测计划')!
    expect(doc.slice(r.from, r.to)).toBe('[[复测计划#步骤|看]]')
  })
  it('多处命中用 headingPath 消歧', () => {
    const doc = '## 计划\n[[A]]\n## 反思\n[[A]]'
    const r = findWikiLink(doc, 'A', ['反思'])!
    // 命中「反思」段下那个 A（第二个）
    expect(r.from).toBeGreaterThan(doc.indexOf('## 反思'))
  })
  it('无命中返回 null', () => {
    expect(findWikiLink('无链接', 'A')).toBeNull()
  })
})

describe('findHeading', () => {
  it('定位 ATX 标题行', () => {
    const doc = '正文\n## 计划\n更多'
    const r = findHeading(doc, '计划')!
    expect(doc.slice(r.from, r.to)).toBe('## 计划')
  })
  it('无命中返回 null', () => {
    expect(findHeading('# 别的', '计划')).toBeNull()
  })
})
