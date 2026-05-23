import { onMount, onCleanup, createEffect } from 'solid-js'
import { EditorView } from '@codemirror/view'
import { EditorState, Transaction } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting } from '@codemirror/language'
import { GFM } from '@lezer/markdown'
import { darkTheme, darkHighlightStyle } from '../lib/cmTheme'
import { wikiLinkParser } from '../lib/wikiLinkParser'
import { livePreviewExtension } from '../lib/livePreviewExtension'
import { frontmatterField } from '../lib/frontmatterField'
import { outLinksField } from '../lib/outLinksField'
import { inlineTagsField, inlineTagDecoField } from '../lib/inlineTagsField'
import { headingsField } from '../lib/headingsField'
import { editorStore, setEditorStore } from '../stores/editorStore'
import { fileSystemStore } from '../stores/fileSystemStore'
import { saveCurrentFile } from '../services/fileSystemService'
import { reindexFile } from '../services/knowledgeService'

export function Editor() {
  let container!: HTMLDivElement
  let view: EditorView | null = null
  let isExternalUpdate = false
  let reindexTimer: ReturnType<typeof setTimeout> | null = null

  onMount(() => {
    const doc = editorStore.content

    view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: [
          markdown({ codeLanguages: languages, extensions: [GFM, wikiLinkParser] }),
          syntaxHighlighting(darkHighlightStyle),
          darkTheme,
          livePreviewExtension,
          frontmatterField,
          outLinksField,
          inlineTagsField,
          inlineTagDecoField,
          headingsField,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              setEditorStore('outLinks', update.state.field(outLinksField))
              setEditorStore('headings', update.state.field(headingsField))

              // Debounced reindex: fires when outLinks OR tags change so the
              // backlink map stays current while the user is editing.
              if (reindexTimer !== null) clearTimeout(reindexTimer)
              reindexTimer = setTimeout(() => {
                reindexTimer = null
                const { activeFilePath } = fileSystemStore
                if (activeFilePath && view) {
                  reindexFile(activeFilePath, view.state.doc.toString())
                }
              }, 800)

              const isRemote = update.transactions.some(tr => tr.annotation(Transaction.remote))
              if (!isExternalUpdate && !isRemote) {
                setEditorStore('isDirty', true)
                setEditorStore('content', update.state.doc.toString())
              }
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
    setEditorStore('outLinks', view.state.field(outLinksField))
    setEditorStore('headings', view.state.field(headingsField))
  })

  onCleanup(() => {
    if (reindexTimer !== null) clearTimeout(reindexTimer)
    view?.destroy()
    setEditorStore('cmView', null)
  })

  createEffect(() => {
    if (!view) return
    const content = editorStore.content
    const current = view.state.doc.toString()
    if (current === content) return
    isExternalUpdate = true
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
      selection: { anchor: content.length },
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
