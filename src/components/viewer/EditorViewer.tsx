import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { EditorState, Transaction } from '@codemirror/state'
import type { ViewUpdate } from '@codemirror/view'
import { EditorView } from '@codemirror/view'
import { GFM } from '@lezer/markdown'
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  Show,
} from 'solid-js'
import { fileActions } from '../../actions/fileActions'
import { knowledgeActions } from '../../actions/knowledgeActions'
import { darkHighlightStyle, darkTheme } from '../../lib/cmTheme'
import { embedPreviewPlugin, embedTheme } from '../../lib/embedExtension'
import { frontmatterField } from '../../lib/frontmatterField'
import { headingsField } from '../../lib/headingsField'
import { inlineTagDecoField, inlineTagsField } from '../../lib/inlineTagsField'
import { livePreviewExtension } from '../../lib/livePreviewExtension'
import { outLinksField } from '../../lib/outLinksField'
import {
  formatTimestamp,
  parseFrontmatter,
  setFrontmatterField,
} from '../../lib/parseFrontmatter'
import { wikiEmbedParser, wikiLinkParser } from '../../lib/wikiLinkParser'
import { readFile, writeFile } from '../../services/fileCacheService'
import { globalStore } from '../../stores/globalStore'
import { runtimeStore, setRuntimeStore } from '../../stores/runtimeStore'
import type { ViewComponentProps } from '../../stores/types'

async function loadFileContent(path: string): Promise<string> {
  let content = await readFile(path)
  if (globalStore.workspace.autoTimestamps) {
    const { frontmatter } = parseFrontmatter(content)
    const ts = formatTimestamp(Date.now())
    let updated = content
    if (!frontmatter.created)
      updated = setFrontmatterField(updated, 'created', ts)
    if (!frontmatter.updated)
      updated = setFrontmatterField(updated, 'updated', ts)
    if (updated !== content) {
      await writeFile(path, updated)
      content = updated
    }
  }
  return content
}

function buildEditorState(
  doc: string,
  onDocChange: (u: ViewUpdate) => void,
  onKeyDown: (e: KeyboardEvent) => void,
): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: doc.length },
    extensions: [
      markdown({
        codeLanguages: languages,
        extensions: [GFM, wikiLinkParser, wikiEmbedParser],
      }),
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

export function EditorViewer(props: ViewComponentProps) {
  const filePath = () => props.viewState.file as string | undefined

  let container!: HTMLDivElement
  let view: EditorView | null = null
  let reindexTimer: ReturnType<typeof setTimeout> | null = null
  let localDirty = false

  function setLeafRuntime(
    patch: Partial<{
      cmView: EditorView | null
      isDirty: boolean
      outLinks: any[]
      headings: any[]
    }>,
  ) {
    setRuntimeStore('leafInstances', props.leafId, (prev) => ({
      ...(prev ?? { cmView: null, isDirty: false, outLinks: [], headings: [] }),
      ...patch,
    }))
  }

  function handleDocChange(update: ViewUpdate) {
    if (!update.docChanged) return
    const isRemote = update.transactions.some((tr) =>
      tr.annotation(Transaction.remote),
    )
    if (!isRemote) {
      localDirty = true
      if (props.isActive) setLeafRuntime({ isDirty: true })
    }
    if (reindexTimer !== null) clearTimeout(reindexTimer)
    reindexTimer = setTimeout(() => {
      reindexTimer = null
      const p = filePath()
      if (p && view) {
        const outLinks = view.state
          .field(outLinksField)
          .filter((l) => l.type === 'wiki')
          .map((l) => (l.target.endsWith('.md') ? l.target : `${l.target}.md`))
        const inlineTags = view.state.field(inlineTagsField).map((m) => m.tag)
        void knowledgeActions.reindexFile(p, view.state.doc.toString(), {
          outLinks,
          inlineTags,
        })
      }
    }, 800)
    if (props.isActive) {
      setLeafRuntime({
        outLinks: update.state.field(outLinksField),
        headings: update.state.field(headingsField),
      })
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
    if (globalStore.workspace.autoTimestamps) {
      const ts = formatTimestamp(Date.now())
      const withUpdated = setFrontmatterField(content, 'updated', ts)
      if (withUpdated !== content) {
        let from = 0
        while (
          from < content.length &&
          from < withUpdated.length &&
          content[from] === withUpdated[from]
        )
          from++
        let toOld = content.length
        let toNew = withUpdated.length
        while (
          toOld > from &&
          toNew > from &&
          content[toOld - 1] === withUpdated[toNew - 1]
        ) {
          toOld--
          toNew--
        }
        view.dispatch({
          changes: { from, to: toOld, insert: withUpdated.slice(from, toNew) },
          annotations: Transaction.remote.of(true),
        })
        content = withUpdated
      }
    }
    await writeFile(p, content)
    localDirty = false
    if (props.isActive) setLeafRuntime({ isDirty: false })
    const outLinks = view.state
      .field(outLinksField)
      .filter((l) => l.type === 'wiki')
      .map((l) => (l.target.endsWith('.md') ? l.target : `${l.target}.md`))
    const inlineTags = view.state.field(inlineTagsField).map((m) => m.tag)
    await knowledgeActions.reindexFile(p, content, { outLinks, inlineTags })
  }

  createEffect(on(
    () => runtimeStore.rootHandle,
    async (rootHandle) => {
      if (!rootHandle || view) return
      const p = filePath()
      if (!p) return
      const doc = await loadFileContent(p)
      if (view) return
      view = new EditorView({
        state: buildEditorState(doc, handleDocChange, handleKeyDown),
        parent: container,
      })
      if (filePath() === p && props.isActive) {
        setLeafRuntime({
          cmView: view,
          outLinks: view.state.field(outLinksField),
          headings: view.state.field(headingsField),
          isDirty: false,
        })
      }
    },
  ))

  onCleanup(() => {
    if (reindexTimer !== null) clearTimeout(reindexTimer)
    view?.destroy()
    view = null
    if (props.isActive)
      setLeafRuntime({
        cmView: null,
        isDirty: false,
        outLinks: [],
        headings: [],
      })
  })

  // viewState.file changed (preview replacement): reload without unmounting
  createEffect(async () => {
    const p = filePath()
    if (!view || !p) return
    const newContent = await loadFileContent(p)
    const newState = buildEditorState(
      newContent,
      handleDocChange,
      handleKeyDown,
    )
    view.setState(newState)
    view.scrollDOM.scrollTop = 0
    localDirty = false
    if (props.isActive) {
      setLeafRuntime({
        isDirty: false,
        outLinks: view.state.field(outLinksField),
        headings: view.state.field(headingsField),
      })
    }
  })

  // Sync runtimeStore when this pane becomes the active tab
  createEffect(() => {
    if (props.isActive && view) {
      setLeafRuntime({
        cmView: view,
        outLinks: view.state.field(outLinksField),
        headings: view.state.field(headingsField),
        isDirty: localDirty,
      })
    }
  })

  // ── Inline file rename ───────────────────────────────────────────────────
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
    await fileActions.renameFile(p, name)
  }
  const onTitleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void confirmRename()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
  }

  return (
    <div class="flex flex-col flex-1 overflow-hidden">
      <Show when={filePath()}>
        <div class="px-8 pt-6 pb-1 shrink-0 min-w-0">
          <Show
            when={editing()}
            fallback={
              <h1
                class="text-[22px] font-bold text-(--text) cursor-text hover:text-(--accent) transition-colors truncate leading-tight"
                onClick={startEdit}
                title="点击修改文件名"
              >
                {stem() || '未命名'}
              </h1>
            }
          >
            <input
              class="w-full bg-transparent border-b-2 border-(--accent) outline-none text-[22px] font-bold text-(--text) pb-0.5 leading-tight"
              value={draft()}
              onInput={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={onTitleKeyDown}
              onBlur={() => void confirmRename()}
              ref={(el) =>
                setTimeout(() => {
                  el.focus()
                  el.select()
                }, 0)
              }
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
