import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { wikiLinkParser } from '../wikiLinkParser'

function getNodeNames(doc: string): string[] {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: [wikiLinkParser] })],
  })
  const names: string[] = []
  syntaxTree(state).iterate({
    from: 0,
    to: state.doc.length,
    enter(node) { names.push(node.name) },
  })
  return names
}

describe('wikiLinkParser', () => {
  it('emits WikiLink node for [[Page]]', () => {
    const names = getNodeNames('[[Page]]')
    expect(names).toContain('WikiLink')
  })

  it('emits WikiLinkMark for [[ and ]]', () => {
    const names = getNodeNames('[[Page]]')
    expect(names.filter(n => n === 'WikiLinkMark')).toHaveLength(2)
  })

  it('emits WikiLinkTarget for the page name', () => {
    const names = getNodeNames('[[My Page]]')
    expect(names).toContain('WikiLinkTarget')
  })

  it('does not emit WikiLink for unclosed [[', () => {
    const names = getNodeNames('[[unclosed')
    expect(names).not.toContain('WikiLink')
  })

  it('handles WikiLink inline with other text', () => {
    const names = getNodeNames('Hello [[World]] end')
    expect(names).toContain('WikiLink')
  })
})
