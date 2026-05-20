import { onMount, onCleanup, createEffect } from 'solid-js'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting } from '@codemirror/language'
import { darkTheme, darkHighlightStyle } from '../lib/cmTheme'
import { wikiLinkExtension } from '../lib/wikiLinkExtension'
import { editorStore, setEditorStore } from '../stores/editorStore'
import { saveCurrentFile } from '../services/fileSystemService'
import { parseFrontmatter } from '../lib/parseFrontmatter'

export function Editor() {
  let container!: HTMLDivElement
  let view: EditorView | null = null
  let isExternalUpdate = false

  onMount(() => {
    const { body } = parseFrontmatter(editorStore.content)

    view = new EditorView({
      state: EditorState.create({
        doc: body,
        extensions: [
          markdown({ codeLanguages: languages }),
          syntaxHighlighting(darkHighlightStyle),
          darkTheme,
          wikiLinkExtension,
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !isExternalUpdate) {
              setEditorStore('isDirty', true)
            }
          }),
          EditorView.domEventHandlers({
            keydown(event) {
              if ((event.ctrlKey || event.metaKey) && event.key === 's') {
                event.preventDefault()
                saveCurrentFile()
              }
            },
          }),
          EditorView.lineWrapping,
        ],
      }),
      parent: container,
    })

    setEditorStore('cmView', view)
  })

  onCleanup(() => {
    view?.destroy()
    setEditorStore('cmView', null)
  })

  createEffect(() => {
    if (!view) return
    const { body } = parseFrontmatter(editorStore.content)
    const current = view.state.doc.toString()
    if (current === body) return
    isExternalUpdate = true
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: body },
    })
    isExternalUpdate = false
  })

  return (
    <div
      ref={container}
      class="flex-1 overflow-auto bg-[#0f0f1c]"
      style={{ 'min-height': '0' }}
    />
  )
}
