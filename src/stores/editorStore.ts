import { createStore } from 'solid-js/store'
import type { EditorView } from '@codemirror/view'
import type { OutLink } from '../lib/outLinksField'
import type { Heading } from '../lib/headingsField'

export interface EditorState {
  isDirty: boolean
  cmView: EditorView | null
  outLinks: OutLink[]
  headings: Heading[]
}

const [editorStore, setEditorStore] = createStore<EditorState>({
  isDirty: false,
  cmView: null,
  outLinks: [],
  headings: [],
})

export { editorStore, setEditorStore }
