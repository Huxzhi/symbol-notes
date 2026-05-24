import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from 'solid-js'
import { EditorView } from '@codemirror/view'
import { EditorState, Transaction } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting } from '@codemirror/language'
import { GFM } from '@lezer/markdown'
import { darkTheme, darkHighlightStyle } from '../lib/cmTheme'
import { wikiLinkParser, wikiEmbedParser } from '../lib/wikiLinkParser'
import { livePreviewExtension } from '../lib/livePreviewExtension'
import { embedPreviewPlugin, embedTheme } from '../lib/embedExtension'
import { frontmatterField } from '../lib/frontmatterField'
import { outLinksField } from '../lib/outLinksField'
import { inlineTagsField, inlineTagDecoField } from '../lib/inlineTagsField'
import { headingsField } from '../lib/headingsField'
import { editorStore, setEditorStore } from '../stores/editorStore'
import { uiStore } from '../stores/uiStore'
import { loadFileContent, writeFile, renameFile } from '../services/fileSystemService'
import { reindexFile } from '../services/knowledgeService'
import { startBackgroundParsing } from '../services/backgroundParser'
import { formatTimestamp, setFrontmatterField } from '../lib/parseFrontmatter'
import type { ViewUpdate } from '@codemirror/view'

function buildEditorState(
  doc: string,
  onDocChange: (u: ViewUpdate) => void,
  onKeyDown: (e: KeyboardEvent) => void,
): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: 0 },
    extensions: [
      markdown({ codeLanguages: languages, extensions: [GFM, wikiLinkParser, wikiEmbedParser] }),
      syntaxHighlighting(darkHighlightStyle),
      darkTheme,
      livePreviewExtension,
      embedPreviewPlugin,
      embedTheme,
      frontmatterField,
      outLinksField,
      inlineTagsField,
      inlineTagDecoField,
      headingsField,
      EditorView.updateListener.of(onDocChange),
      EditorView.domEventHandlers({ keydown: onKeyDown }),
      EditorView.lineWrapping,
    ],
  })
}

export function EditorPane(props: { tabId: string; isActive: boolean }) {
  let container!: HTMLDivElement
  let view: EditorView | null = null
  let reindexTimer: ReturnType<typeof setTimeout> | null = null
  let localDirty = false

  const tab = () => uiStore.tabs[props.tabId]
  const filePath = () => tab()?.path ?? null

  function handleDocChange(update: ViewUpdate) {
    if (!update.docChanged) return
    const isRemote = update.transactions.some(tr => tr.annotation(Transaction.remote))
    if (!isRemote) {
      localDirty = true
      if (props.isActive) setEditorStore('isDirty', true)
    }
    if (reindexTimer !== null) clearTimeout(reindexTimer)
    reindexTimer = setTimeout(() => {
      reindexTimer = null
      const p = filePath()
      if (p && view) void reindexFile(p, view.state.doc.toString())
    }, 800)
    if (props.isActive) {
      setEditorStore('outLinks', update.state.field(outLinksField))
      setEditorStore('headings', update.state.field(headingsField))
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      void saveFile()
    }
  }

  async function saveFile(): Promise<void> {
    const p = filePath()
    if (!view || !p) return
    let content = view.state.doc.toString()
    if (uiStore.autoTimestamps) {
      const ts = formatTimestamp(Date.now())
      const withUpdated = setFrontmatterField(content, 'updated', ts)
      if (withUpdated !== content) {
        let from = 0
        while (from < content.length && from < withUpdated.length && content[from] === withUpdated[from]) from++
        let toOld = content.length
        let toNew = withUpdated.length
        while (toOld > from && toNew > from && content[toOld - 1] === withUpdated[toNew - 1]) { toOld--; toNew-- }
        view.dispatch({
          changes: { from, to: toOld, insert: withUpdated.slice(from, toNew) },
          annotations: Transaction.remote.of(true),
        })
        content = withUpdated
      }
    }
    await writeFile(p, content)
    localDirty = false
    if (props.isActive) setEditorStore('isDirty', false)
    await reindexFile(p, content)
  }

  onMount(async () => {
    const p = filePath()
    if (!p) return
    const doc = await loadFileContent(p)
    view = new EditorView({
      state: buildEditorState(doc, handleDocChange, handleKeyDown),
      parent: container,
    })
    // Guard: path may have changed during async load
    if (filePath() === p && props.isActive) {
      setEditorStore({
        cmView: view,
        outLinks: view.state.field(outLinksField),
        headings: view.state.field(headingsField),
        isDirty: false,
      })
    }
    void startBackgroundParsing(p)
  })

  onCleanup(() => {
    if (reindexTimer !== null) clearTimeout(reindexTimer)
    view?.destroy()
    view = null
    if (props.isActive) {
      setEditorStore({ cmView: null, isDirty: false, outLinks: [], headings: [] })
    }
  })

  // Preview tab replacement: path changes without unmount.
  // On first run view is null (onMount hasn't fired yet), so we return early.
  // Subsequent runs triggered by tab.path change have view set.
  createEffect(async () => {
    const p = filePath()
    if (!view || !p) return
    const newContent = await loadFileContent(p)
    const newState = buildEditorState(newContent, handleDocChange, handleKeyDown)
    view.setState(newState)
    view.scrollDOM.scrollTop = 0
    localDirty = false
    if (props.isActive) {
      setEditorStore({
        isDirty: false,
        outLinks: view.state.field(outLinksField),
        headings: view.state.field(headingsField),
      })
    }
    void startBackgroundParsing(p)
  })

  // Sync editorStore when this pane becomes the active tab.
  createEffect(() => {
    if (props.isActive && view) {
      setEditorStore({
        cmView: view,
        outLinks: view.state.field(outLinksField),
        headings: view.state.field(headingsField),
        isDirty: localDirty,
      })
    }
  })

  // ── FileTitle (inline rename) ────────────────────────────────────────────
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal('')
  let handled = false

  const stem = createMemo(() => {
    const p = filePath()
    if (!p) return ''
    return (p.split('/').pop() ?? p).replace(/\.md$/, '')
  })

  const startEdit = () => {
    handled = false
    setDraft(stem())
    setEditing(true)
  }
  const cancel = () => {
    handled = true
    setEditing(false)
  }
  const confirmRename = async () => {
    if (handled) return
    handled = true
    setEditing(false)
    const name = draft().trim()
    const p = filePath()
    if (!name || name === stem() || !p) return
    await renameFile(p, name)
  }
  const onTitleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); void confirmRename() }
    else if (e.key === 'Escape') { e.preventDefault(); cancel() }
  }

  return (
    <div class="flex flex-col flex-1 overflow-hidden">
      <Show when={filePath()}>
        <div class="px-8 pt-6 pb-1 shrink-0 min-w-0">
          <Show
            when={editing()}
            fallback={
              <h1
                class="text-[22px] font-bold text-[var(--text)] cursor-text hover:text-[var(--accent)] transition-colors truncate leading-tight"
                onClick={startEdit}
                title="点击修改文件名"
              >
                {stem() || '未命名'}
              </h1>
            }
          >
            <input
              class="w-full bg-transparent border-b-2 border-[var(--accent)] outline-none text-[22px] font-bold text-[var(--text)] pb-0.5 leading-tight"
              value={draft()}
              onInput={e => setDraft(e.currentTarget.value)}
              onKeyDown={onTitleKeyDown}
              onBlur={() => void confirmRename()}
              ref={el => setTimeout(() => { el.focus(); el.select() }, 0)}
              spellcheck={false}
            />
          </Show>
        </div>
      </Show>
      <div
        ref={container}
        class="flex-1 overflow-auto bg-[#0f0f1c]"
        style={{ 'min-height': '0' }}
      />
    </div>
  )
}
