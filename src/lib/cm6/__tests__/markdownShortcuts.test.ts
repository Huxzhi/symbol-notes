import { describe, it, expect } from 'vitest'
import { EditorState, EditorSelection } from '@codemirror/state'
import { toggleMarker } from '../markdownShortcuts'

function apply(doc: string, from: number, to: number, marker: string) {
  const state = EditorState.create({ doc, selection: EditorSelection.single(from, to) })
  const tr = state.update(toggleMarker(state, marker))
  const sel = tr.state.selection.main
  return { doc: tr.state.doc.toString(), from: sel.from, to: sel.to }
}

describe('toggleMarker (bold **)', () => {
  it('wraps a selection and keeps the inner text selected', () => {
    expect(apply('hello', 0, 5, '**')).toEqual({ doc: '**hello**', from: 2, to: 7 })
  })

  it('inserts ** ** with the cursor in the middle when nothing is selected', () => {
    expect(apply('', 0, 0, '**')).toEqual({ doc: '****', from: 2, to: 2 })
  })

  it('unwraps when the selection itself includes the markers', () => {
    expect(apply('**hi**', 0, 6, '**')).toEqual({ doc: 'hi', from: 0, to: 2 })
  })

  it('unwraps when the markers sit just outside the selection', () => {
    expect(apply('**hi**', 2, 4, '**')).toEqual({ doc: 'hi', from: 0, to: 2 })
  })

  it('wraps a selection inside surrounding text', () => {
    expect(apply('a hello b', 2, 7, '**')).toEqual({ doc: 'a **hello** b', from: 4, to: 9 })
  })
})

describe('toggleMarker (italic *)', () => {
  it('wraps a selection with single asterisks', () => {
    expect(apply('x', 0, 1, '*')).toEqual({ doc: '*x*', from: 1, to: 2 })
  })

  it('unwraps single-asterisk emphasis', () => {
    expect(apply('*x*', 0, 3, '*')).toEqual({ doc: 'x', from: 0, to: 1 })
  })

  it('inserts ** with the cursor between when nothing is selected', () => {
    expect(apply('', 0, 0, '*')).toEqual({ doc: '**', from: 1, to: 1 })
  })
})
