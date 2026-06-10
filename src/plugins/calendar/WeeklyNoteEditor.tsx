import { createEffect, createResource, onCleanup, Show } from 'solid-js'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { GFM } from '@lezer/markdown'
import { darkHighlightStyle, darkTheme } from '../../lib/cm6/cmTheme'
import { embedPreviewPlugin, embedTheme } from '../../lib/cm6/embedExtension'
import { livePreviewExtension } from '../../lib/cm6/livePreviewExtension'
import { hideFrontmatterExtension } from '../../lib/cm6/hideFrontmatterExtension'
import { readFile, fileActions, vaultStore } from '../../vault'

export function WeeklyNoteEditor(props: { path: string; label: string }) {
  let editorHost!: HTMLDivElement
  let cmView: EditorView | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  const fileExists = () => !!vaultStore.files[props.path]

  const [content] = createResource(
    () => (vaultStore.files[props.path] ? props.path : null),
    async (path) => {
      try {
        return await readFile(path)
      } catch {
        return null
      }
    },
  )

  async function doSave() {
    if (!cmView) return
    await fileActions.saveFile(props.path, cmView.state.doc.toString())
  }

  function scheduleSave() {
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void doSave()
    }, 500)
  }

  createEffect(() => {
    const text = content()
    if (text === undefined) return
    if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
    cmView?.destroy()
    cmView = null
    if (text === null) return
    const state = EditorState.create({
      doc: text,
      extensions: [
        markdown({ codeLanguages: languages, extensions: [GFM] }),
        syntaxHighlighting(darkHighlightStyle),
        darkTheme,
        embedTheme,
        embedPreviewPlugin,
        livePreviewExtension,
        hideFrontmatterExtension,
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => { if (u.docChanged) scheduleSave() }),
        EditorView.domEventHandlers({
          keydown(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
              e.preventDefault()
              if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
              void doSave()
            }
          },
        }),
      ],
    })
    cmView = new EditorView({ state, parent: editorHost })
  })

  onCleanup(() => {
    if (saveTimer !== null) clearTimeout(saveTimer)
    cmView?.destroy()
    cmView = null
  })

  return (
    <div class="flex flex-col h-full min-h-0 overflow-hidden">
      <div class="px-3 py-1.5 shrink-0 border-b border-(--border) text-[10px] text-(--accent) font-bold tracking-widest uppercase">
        {props.label}
      </div>
      <div class="flex-1 min-h-0 relative">
        <Show when={!content.loading && !fileExists()}>
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-(--text-4)">
            <span class="text-[11px] italic">本周还没有周记</span>
            <button
              class="text-[11px] px-2 py-1 rounded border border-(--border) hover:border-(--accent) hover:text-(--accent) transition-colors"
              onClick={() => void fileActions.createFile(props.path)}
            >
              新建 {props.path.split('/').pop()}
            </button>
          </div>
        </Show>
        <div ref={editorHost} class="h-full overflow-auto" />
      </div>
    </div>
  )
}
