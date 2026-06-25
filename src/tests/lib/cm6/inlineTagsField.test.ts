import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { GFM } from '@lezer/markdown'
import { wikiLinkParser, wikiEmbedParser } from '../../../lib/cm6/wikiLinkParser'
import { inlineTagsField } from '../../../lib/cm6/inlineTagsField'

function scan(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [
      markdown({
        codeLanguages: languages,
        extensions: [GFM, wikiLinkParser, wikiEmbedParser],
      }),
      inlineTagsField,
    ],
  })
  return state.field(inlineTagsField)
}

const tags = (doc: string) => scan(doc).map((m) => m.tag)

describe('inlineTagsField scanTags', () => {
  it('识别列表项中的标签', () => {
    expect(tags('- hello #foo\n- world #bar')).toEqual(['foo', 'bar'])
  })

  it('同一标签的每次出现都保留（不去重）——修复列表中只有首个高亮的问题', () => {
    const matches = scan('- #todo a\n- #todo b')
    expect(matches.map((m) => m.tag)).toEqual(['todo', 'todo'])
    // 两个匹配位置不同
    expect(matches[0].from).not.toBe(matches[1].from)
  })

  it('忽略 YAML frontmatter 中的 #', () => {
    expect(tags('---\ntitle: #notatag\n---\n\nbody #real')).toEqual(['real'])
  })

  it('忽略行内代码与围栏代码块中的标签', () => {
    expect(tags('text #real\n`#fake`\n```\n#nope\n```')).toEqual(['real'])
  })

  it('忽略网页链接（URL 片段、自动链接、链接文本）中的 #', () => {
    expect(tags('[x](https://a.com/#frag) and #real')).toEqual(['real'])
    expect(tags('<https://a.com/#frag> and #real')).toEqual(['real'])
    expect(tags('[#fake](https://a.com) and #real')).toEqual(['real'])
  })

  it('# 紧贴前一个非空白字符时不算标签', () => {
    expect(tags('word#nope and #yes')).toEqual(['yes'])
  })
})
