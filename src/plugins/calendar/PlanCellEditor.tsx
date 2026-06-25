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
import { editorKeymap } from '../../lib/cm6/markdownShortcuts'
import { readFile, vaultStore } from '../../vault'
import { fileActions } from '../../fileManager'

export function PlanCellEditor(props: { path: string; label?: string; onClose: () => void }) {
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

  function flushSave() {
    if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
    void doSave()
  }

  function scheduleSave() {
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => { saveTimer = null; void doSave() }, 500)
  }

  function closeNow() {
    flushSave()
    props.onClose()
  }

  createEffect(() => {
    const exists = fileExists()
    const text = content()
    if (exists && content.loading) return
    if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
    cmView?.destroy()
    cmView = null
    if (!exists || text == null) return
    const state = EditorState.create({
      doc: text,
      extensions: [
        markdown({ codeLanguages: languages, extensions: [GFM] }),
        editorKeymap,
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
              flushSave()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              closeNow()
            }
          },
        }),
      ],
    })
    cmView = new EditorView({ state, parent: editorHost })
    cmView.focus()
  })

  // Blur-to-close: when focus leaves the editor host entirely, save & close.
  function onFocusOut(e: FocusEvent) {
    const next = e.relatedTarget as Node | null
    if (next && editorHost.contains(next)) return
    closeNow()
  }

  onCleanup(() => {
    flushSave()
    cmView?.destroy()
    cmView = null
  })

  return (
    <div class="flex flex-col h-full min-h-0 overflow-hidden">
      <div class="px-3 py-1.5 shrink-0 border-b border-(--border) flex items-center justify-between">
        <span class="text-[10px] text-(--accent) font-bold tracking-widest uppercase">{props.label ?? ''}</span>
        <button
          class="text-[11px] text-(--text-4) hover:text-(--text-2) px-1"
          title="收起（保存）"
          onClick={closeNow}
        >✕</button>
      </div>
      <div class="flex-1 min-h-0 relative">
        <Show when={!content.loading && !fileExists()}>
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-(--text-4)">
            <span class="text-[11px] italic">还没有这个计划</span>
            <button
              class="text-[11px] px-2 py-1 rounded border border-(--border) hover:border-(--accent) hover:text-(--accent) transition-colors"
              onClick={() => void fileActions.createFile(props.path)}
            >
              新建 {props.path.split('/').pop()}
            </button>
          </div>
        </Show>
        <div ref={editorHost} class="h-full overflow-auto" onFocusOut={onFocusOut} />
      </div>
    </div>
  )
}
