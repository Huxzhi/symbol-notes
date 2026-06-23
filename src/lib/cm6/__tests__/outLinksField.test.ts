import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { wikiLinkParser } from '../wikiLinkParser'
import { outLinksField } from '../outLinksField'

function parse(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: [GFM, wikiLinkParser] }), outLinksField],
  })
  return state.field(outLinksField)
}

describe('outLinksField 上下文', () => {
  it('记录 headingPath 与位置', () => {
    const links = parse('# 实验记录\n## 计划\n见 [[复测计划]] 后续')
    const wiki = links.filter(l => l.type === 'wiki')
    expect(wiki).toHaveLength(1)
    expect(wiki[0].target).toBe('复测计划')
    expect(wiki[0].headingPath).toEqual(['实验记录', '计划'])
    expect(typeof wiki[0].from).toBe('number')
    expect(wiki[0].to).toBeGreaterThan(wiki[0].from!)
  })

  it('同一目标出现两次 → 两条（不去重）', () => {
    const links = parse('[[A]] 又 [[A]]')
    expect(links.filter(l => l.type === 'wiki')).toHaveLength(2)
  })

  it('别名单独存', () => {
    const links = parse('[[复测计划|计划详情]]')
    const w = links.find(l => l.type === 'wiki')!
    expect(w.target).toBe('复测计划')
    expect(w.alias).toBe('计划详情')
  })

  it('首个标题前的链接 headingPath 为空', () => {
    const links = parse('开头就 [[A]]')
    expect(links.find(l => l.type === 'wiki')!.headingPath).toEqual([])
  })
})
