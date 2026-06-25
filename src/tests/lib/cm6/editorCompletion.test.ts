import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { editorCompletion } from '../../../lib/cm6/editorCompletion'

describe('editorCompletion', () => {
  // 回归:两个独立的 autocompletion({override}) 会触发
  // "Config merge conflict for field override"。所有补全源必须合并进单一 autocompletion。
  it('builds an EditorState with task + wikilink completion in one config without throwing', () => {
    expect(() =>
      EditorState.create({
        doc: '[[',
        extensions: [markdown({ extensions: [GFM] }), editorCompletion],
      }),
    ).not.toThrow()
  })
})
