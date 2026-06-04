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
import { fileActions } from '../../stores/runtimeStore'
import { showConflict } from '../../stores/conflictStore'
import { vaultActions, vaultStore } from '../../stores/vaultStore'
import { darkHighlightStyle, darkTheme } from '../../lib/cm6/cmTheme'
import { embedPreviewPlugin, embedTheme } from '../../lib/cm6/embedExtension'
import { frontmatterField } from '../../lib/cm6/frontmatterField'
import { headingsField } from '../../lib/cm6/headingsField'
import { inlineTagDecoField, inlineTagsField } from '../../lib/cm6/inlineTagsField'
import { livePreviewExtension } from '../../lib/cm6/livePreviewExtension'
import { outLinksField } from '../../lib/cm6/outLinksField'
import { tasksField } from '../../lib/cm6/tasksField'
import {
  formatTimestamp,
  parseFrontmatter,
  setFrontmatterField,
} from '../../lib/parseFrontmatter'
import { wikiEmbedParser, wikiLinkParser } from '../../lib/cm6/wikiLinkParser'
import { extractDateFromName, resolveLink } from '../../lib/knowledgeUtils'
import { getStemIndex } from '../../stores/vaultStore'
import { workspaceActions, setLeafInstances } from '../../stores/workspaceStore'
import { syntaxTree } from '@codemirror/language'
import { readFile, writeFile, getFileMtime, invalidateFile } from '../../services/fileIO'
import { settingsStore } from '../../stores/settingsStore'
import { runtimeStore } from '../../stores/runtimeStore'
import type { ViewComponentProps } from '../../stores/types'

async function loadFileContent(path: string): Promise<string> {
  let content = await readFile(path)
  if (settingsStore.autoTimestamps) {
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
  onMouseDown: (e: MouseEvent, view: EditorView) => boolean,
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
      tasksField,
      headingsField,
      EditorView.updateListener.of(onDocChange),
      EditorView.domEventHandlers({ keydown: onKeyDown, mousedown: onMouseDown }),
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
    setLeafInstances(props.leafId, (prev) => ({
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
        const tasks = view.state.field(tasksField)
        void vaultActions.reindexFile(p, view.state.doc.toString(), {
          outLinks,
          inlineTags,
          tasks,
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

  function handleMouseDown(e: MouseEvent, cmView: EditorView): boolean {
    const pos = cmView.posAtCoords({ x: e.clientX, y: e.clientY })
    if (pos === null) return false

    const sel = cmView.state.selection.main
    let targetText: string | null = null

    syntaxTree(cmView.state).iterate({
      from: Math.max(0, pos - 1),
      to: Math.min(cmView.state.doc.length, pos + 1),
      enter(node) {
        if (node.name === 'WikiLink') {
          // Only navigate when link is in rendered state (cursor not overlapping)
          if (sel.from > node.to || sel.to < node.from) {
            const c = node.node.cursor()
            if (c.firstChild()) {
              do {
                if (c.name === 'WikiLinkTarget') {
                  targetText = cmView.state.doc.sliceString(c.from, c.to)
                }
              } while (c.nextSibling())
            }
          }
          return false
        }
      },
    })

    if (!targetText) return false

    const clean = (targetText as string).split('#')[0].trim()
    const withExt = clean.endsWith('.md') ? clean : `${clean}.md`
    const stemIndex = getStemIndex()
    const resolved = resolveLink(withExt, stemIndex, vaultStore.files)
    if (!resolved) return false

    e.preventDefault()
    workspaceActions.openFile(resolved)
    return true
  }

  async function saveFile(): Promise<void> {
    const p = filePath()
    if (!view || !p) return

    const knownMtime = vaultStore.files[p]?.mtime
    if (knownMtime) {
      const currentMtime = await getFileMtime(p)
      if (currentMtime > knownMtime) {
        const filename = p.split('/').pop() ?? p
        const diskContent = await readFile(p)
        showConflict({
          filename,
          editorContent: view.state.doc.toString(),
          diskContent,
          onChoice: (choice) => {
            if (choice === 'overwrite') void doSave(p)
            else if (choice === 'reload') void doReload(p)
          },
        })
        return
      }
    }
    await doSave(p)
  }

  async function doSave(p: string): Promise<void> {
    if (!view) return
    let content = view.state.doc.toString()
    if (settingsStore.autoTimestamps) {
      const ts = formatTimestamp(Date.now())
      const { frontmatter } = parseFrontmatter(content)
      const filename = p.split('/').at(-1) ?? ''
      const dateFromName = extractDateFromName(filename)
      let newContent = setFrontmatterField(content, 'updated', ts)
      if (dateFromName && !frontmatter.dated)
        newContent = setFrontmatterField(newContent, 'dated', dateFromName)
      if (newContent !== content) {
        let from = 0
        while (
          from < content.length &&
          from < newContent.length &&
          content[from] === newContent[from]
        )
          from++
        let toOld = content.length
        let toNew = newContent.length
        while (
          toOld > from &&
          toNew > from &&
          content[toOld - 1] === newContent[toNew - 1]
        ) {
          toOld--
          toNew--
        }
        view.dispatch({
          changes: { from, to: toOld, insert: newContent.slice(from, toNew) },
          annotations: Transaction.remote.of(true),
        })
        content = newContent
      }
    }
    const outLinks = view.state
      .field(outLinksField)
      .filter((l) => l.type === 'wiki')
      .map((l) => (l.target.endsWith('.md') ? l.target : `${l.target}.md`))
    const inlineTags = view.state.field(inlineTagsField).map((m) => m.tag)
    const tasks = view.state.field(tasksField)
    await fileActions.saveFile(p, content, { outLinks, inlineTags, tasks })
    localDirty = false
    if (props.isActive) setLeafRuntime({ isDirty: false })
  }

  async function doReload(p: string): Promise<void> {
    if (!view) return
    invalidateFile(p)
    const newContent = await loadFileContent(p)
    const newState = buildEditorState(newContent, handleDocChange, handleKeyDown, handleMouseDown)
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
  }

  createEffect(on(
    () => runtimeStore.fs,
    async (fs) => {
      if (!fs || view) return
      const p = filePath()
      if (!p) return
      const doc = await loadFileContent(p)
      if (view) return
      view = new EditorView({
        state: buildEditorState(doc, handleDocChange, handleKeyDown, handleMouseDown),
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
      handleMouseDown,
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

  // Auto-save when switching away from this tab
  createEffect(on(
    () => props.isActive,
    (isActive, prevIsActive) => {
      if (prevIsActive && !isActive && localDirty) {
        void saveFile()
      }
    },
  ))

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
