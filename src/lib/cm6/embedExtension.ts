import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { EditorState, RangeSetBuilder } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import { GFM } from '@lezer/markdown'
import { vaultStore, vaultFs, getFile as fsGetFile } from '../../vault'
import { darkHighlightStyle, darkTheme } from './cmTheme'
import { livePreviewExtension } from './livePreviewExtension'
import { parseFrontmatter } from '../parseFrontmatter'
import { wikiEmbedParser, wikiLinkParser } from './wikiLinkParser'

export const IMAGE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.bmp',
  '.avif',
])
// ── Target resolution via fileMap (available before knowledge scan) ───────────

function resolveEmbedTarget(target: string): string | null {
  const stem = target.split('/').pop()!
  const hasExt = stem.includes('.')
  const searchName = hasExt ? stem : `${stem}.md`
  const entry = Object.values(vaultStore.files).find(
    (e) => e.kind === 'file' && e.name === searchName,
  )
  return entry?.path ?? null
}

// ── Data URL cache — keyed by path, no revocation needed ─────────────────────

const imageUrlCache = new Map<string, string>()

export function clearEmbedUrlCache() {
  imageUrlCache.clear()
}

// ── File loading ──────────────────────────────────────────────────────────────

async function getImageDataUrl(path: string): Promise<string> {
  const cached = imageUrlCache.get(path)
  if (cached) return cached
  const file = await fsGetFile(path)
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  imageUrlCache.set(path, dataUrl)
  return dataUrl
}

// ── Embedded CM6 read-only theme ─────────────────────────────────────────────

const embedReadOnlyTheme = EditorView.theme({
  '&': { background: 'transparent !important' },
  '.cm-scroller': { overflow: 'auto', maxHeight: '320px' },
  '.cm-content': { padding: '8px 10px', fontSize: '13px', lineHeight: '1.65' },
  '.cm-line': { padding: '0' },
  // hide cursor and selection in read-only view
  '.cm-cursor': { display: 'none !important' },
  '.cm-selectionBackground': { display: 'none !important' },
})

// ── Widget ────────────────────────────────────────────────────────────────────
// resolved is pre-computed in buildEmbedDecos; if resolution fails we skip
// the decoration entirely (raw text shows) so the widget never gets stuck
// in a "missing" state after the file tree becomes available.

class EmbedWidget extends WidgetType {
  private cmView: EditorView | null = null

  constructor(
    readonly target: string,
    readonly resolved: string,
  ) {
    super()
  }

  eq(other: EmbedWidget) {
    return other.target === this.target && other.resolved === this.resolved
  }

  toDOM() {
    const el = document.createElement('div')
    el.className = 'cm-embed'

    const ext = this.resolved
      .slice(this.resolved.lastIndexOf('.'))
      .toLowerCase()

    if (IMAGE_EXTS.has(ext)) {
      const img = document.createElement('img')
      img.className = 'cm-embed-img'
      img.alt = this.target
      el.appendChild(img)
      getImageDataUrl(this.resolved)
        .then((url) => { img.src = url })
        .catch(() => { el.textContent = `[图片加载失败: ${this.target}]` })
    } else {
      el.className += ' cm-embed-md'
      const titleBar = document.createElement('div')
      titleBar.className = 'cm-embed-md-title'
      titleBar.textContent = this.resolved.split('/').pop()!.replace(/\.md$/, '')
      el.appendChild(titleBar)

      const editorHost = document.createElement('div')
      editorHost.className = 'cm-embed-md-body'
      el.appendChild(editorHost)

      fsGetFile(this.resolved)
        .then(async (f) => {
          const { body } = parseFrontmatter(await f.text())
          const state = EditorState.create({
            doc: body.replace(/^\n/, ''),
            extensions: [
              markdown({ codeLanguages: languages, extensions: [GFM, wikiLinkParser, wikiEmbedParser] }),
              syntaxHighlighting(darkHighlightStyle),
              darkTheme,
              embedReadOnlyTheme,
              livePreviewExtension,
              EditorState.readOnly.of(true),
              EditorView.editable.of(false),
              EditorView.lineWrapping,
            ],
          })
          this.cmView = new EditorView({ state, parent: editorHost })
        })
        .catch(() => {
          editorHost.textContent = `[文件加载失败: ${this.target}]`
        })
    }

    return el
  }

  destroy(_dom: HTMLElement) {
    this.cmView?.destroy()
    this.cmView = null
  }

  ignoreEvent() {
    return true
  }
}

// ── ViewPlugin ────────────────────────────────────────────────────────────────

function buildEmbedDecos(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const { state } = view
  const sel = state.selection.main
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== 'WikiEmbed') return
        if (sel.from <= node.to && sel.to >= node.from) return false

        let target = ''
        const c = node.node.cursor()
        if (c.firstChild()) {
          do {
            if (c.name === 'WikiEmbedTarget')
              target = state.doc.sliceString(c.from, c.to).trim()
          } while (c.nextSibling())
        }
        if (!target) return false

        if (!vaultFs()) return false
        const resolved = resolveEmbedTarget(target)
        if (!resolved) return false

        builder.add(
          node.from,
          node.to,
          Decoration.replace({ widget: new EmbedWidget(target, resolved) }),
        )
        return false
      },
    })
  }

  return builder.finish()
}

export const embedPreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildEmbedDecos(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildEmbedDecos(update.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

// ── Theme ─────────────────────────────────────────────────────────────────────

export const embedTheme = EditorView.baseTheme({
  '.cm-embed': {
    display: 'block',
    // Vertical spacing as inner padding (not margin) so CM6's offsetHeight
    // measures it, keeping cursor mapping accurate below embeds.
    padding: '6px 0',
    borderRadius: '6px',
    overflow: 'hidden',
    userSelect: 'none',
  },
  '.cm-embed-missing': {
    display: 'inline',
    opacity: '0.45',
    fontStyle: 'italic',
  },
  '.cm-embed-img': {
    maxWidth: '100%',
    maxHeight: '480px',
    display: 'block',
    borderRadius: '4px',
  },
  '.cm-embed-md': {
    border: '1px solid var(--border)',
    background: 'var(--bg-surface)',
  },
  '.cm-embed-md-title': {
    fontSize: '11px',
    fontWeight: '600',
    color: 'var(--accent)',
    padding: '5px 10px',
    borderBottom: '1px solid var(--border)',
  },
  '.cm-embed-md-body': {
    color: 'var(--text-2)',
  },
})
