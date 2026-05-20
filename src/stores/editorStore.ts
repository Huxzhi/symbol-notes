import { createStore } from 'solid-js/store'
import type { EditorView } from '@codemirror/view'

export interface EditorState {
  content: string
  isDirty: boolean
  cmView: EditorView | null
}

const [editorStore, setEditorStore] = createStore<EditorState>({
  content: '',
  isDirty: false,
  cmView: null,
})

export { editorStore, setEditorStore }
