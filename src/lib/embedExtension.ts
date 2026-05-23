import { syntaxTree } from '@codemirror/language'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'
import { fileSystemStore, type FileNode } from '../stores/fileSystemStore'
import { IMAGE_EXTS } from './fileTypes'
import { parseFrontmatter } from './parseFrontmatter'

// ── Target resolution via file tree (available before knowledge scan) ─────────

function searchTree(nodes: FileNode[], name: string): string | null {
  for (const node of nodes) {
    if (node.kind === 'file' && node.name === name) return node.path
    if (node.kind === 'directory' && node.children) {
      const found = searchTree(node.children, name)
      if (found) return found
    }
  }
  return null
}

function resolveEmbedTarget(target: string): string | null {
  const stem = target.split('/').pop()!
  const hasExt = stem.includes('.')
  const searchName = hasExt ? stem : `${stem}.md`
  return searchTree(fileSystemStore.tree, searchName)
}

// ── Image URL cache — keyed by path, valid for the session ───────────────────
// Avoids the object URL being revoked when cursor enters/exits the embed range.

const imageUrlCache = new Map<string, string>()

export function clearEmbedUrlCache() {
  for (const url of imageUrlCache.values()) URL.revokeObjectURL(url)
  imageUrlCache.clear()
}

// ── File loading ──────────────────────────────────────────────────────────────

async function getFile(path: string, root: FileSystemDirectoryHandle): Promise<File> {
  const parts = path.split('/')
  let dir: FileSystemDirectoryHandle = root
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i])
  }
  return (await dir.getFileHandle(parts[parts.length - 1])).getFile()
}

async function getImageUrl(path: string, root: FileSystemDirectoryHandle): Promise<string> {
  const cached = imageUrlCache.get(path)
  if (cached) return cached
  const url = URL.createObjectURL(await getFile(path, root))
  imageUrlCache.set(path, url)
  return url
}

// ── Markdown → safe HTML ──────────────────────────────────────────────────────

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function inlineHtml(text: string): string {
  return esc(text)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
}

function markdownToHtml(md: string): string {
  const { body } = parseFrontmatter(md)
  const lines = body.split('\n')
  let html = ''
  let inPara = false
  let inCode = false

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (!inCode) {
        if (inPara) { html += '</p>'; inPara = false }
        html += '<pre><code>'
        inCode = true
      } else {
        html += '</code></pre>'
        inCode = false
      }
      continue
    }
    if (inCode) { html += esc(line) + '\n'; continue }

    if (!line.trim()) {
      if (inPara) { html += '</p>'; inPara = false }
      continue
    }

    const hm = line.match(/^(#{1,6})\s+(.*)/)
    if (hm) {
      if (inPara) { html += '</p>'; inPara = false }
      html += `<h${hm[1].length} class="cm-embed-h">${inlineHtml(hm[2])}</h${hm[1].length}>`
      continue
    }

    const lm = line.match(/^[-*+]\s+(.*)/)
    if (lm) {
      if (inPara) { html += '</p>'; inPara = false }
      html += `<div class="cm-embed-li">• ${inlineHtml(lm[1])}</div>`
      continue
    }

    if (!inPara) { html += '<p>'; inPara = true } else html += ' '
    html += inlineHtml(line)
  }

  if (inPara) html += '</p>'
  if (inCode) html += '</code></pre>'
  return html
}

// ── Widget ────────────────────────────────────────────────────────────────────

class EmbedWidget extends WidgetType {
  constructor(readonly target: string) { super() }

  eq(other: EmbedWidget) { return other.target === this.target }

  toDOM() {
    const root = fileSystemStore.rootHandle
    const resolved = resolveEmbedTarget(this.target)
    const el = document.createElement('div')

    if (!resolved || !root) {
      el.className = 'cm-embed cm-embed-missing'
      el.textContent = `![[${this.target}]]`
      return el
    }

    el.className = 'cm-embed'

    const resolvedExt = resolved.slice(resolved.lastIndexOf('.')).toLowerCase()
    if (IMAGE_EXTS.has(resolvedExt)) {
      const img = document.createElement('img')
      img.className = 'cm-embed-img'
      img.alt = this.target
      el.appendChild(img)
      getImageUrl(resolved, root)
        .then(url => { img.src = url })
        .catch(() => { el.textContent = `[图片加载失败: ${this.target}]` })
    } else if (resolved.endsWith('.md')) {
      el.className += ' cm-embed-md'
      const title = document.createElement('div')
      title.className = 'cm-embed-md-title'
      title.textContent = resolved.split('/').pop()!.replace(/\.md$/, '')
      const body = document.createElement('div')
      body.className = 'cm-embed-md-body'
      el.appendChild(title)
      el.appendChild(body)
      getFile(resolved, root)
        .then(async f => { body.innerHTML = markdownToHtml(await f.text()) })
        .catch(() => { body.textContent = `[文件加载失败: ${this.target}]` })
    }

    return el
  }

  ignoreEvent() { return false }
}

// ── ViewPlugin ────────────────────────────────────────────────────────────────

function buildEmbedDecos(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const { state } = view
  const sel = state.selection.main

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from, to,
      enter(node) {
        if (node.name !== 'WikiEmbed') return
        if (sel.from <= node.to && sel.to >= node.from) return false // reveal raw text

        let target = ''
        const c = node.node.cursor()
        if (c.firstChild()) {
          do {
            if (c.name === 'WikiEmbedTarget') target = state.doc.sliceString(c.from, c.to).trim()
          } while (c.nextSibling())
        }
        if (!target) return false

        builder.add(node.from, node.to, Decoration.replace({ widget: new EmbedWidget(target) }))
        return false
      },
    })
  }

  return builder.finish()
}

export const embedPreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = buildEmbedDecos(view) }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildEmbedDecos(update.view)
      }
    }
  },
  { decorations: v => v.decorations },
)

// ── Theme ─────────────────────────────────────────────────────────────────────

export const embedTheme = EditorView.baseTheme({
  '.cm-embed': {
    display: 'block',
    margin: '6px 0',
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
    padding: '8px 10px',
    fontSize: '13px',
    lineHeight: '1.65',
    color: 'var(--text-2)',
    maxHeight: '320px',
    overflowY: 'auto',
  },
  '.cm-embed-md-body p': { margin: '0 0 6px' },
  '.cm-embed-md-body p:last-child': { margin: '0' },
  '.cm-embed-h': { fontWeight: '700', margin: '4px 0', color: 'var(--text)' },
  '.cm-embed-li': { paddingBottom: '2px' },
  '.cm-embed-md-body pre': {
    background: 'var(--bg-base)',
    borderRadius: '4px',
    padding: '8px',
    fontSize: '11px',
    overflowX: 'auto',
    margin: '4px 0',
  },
  '.cm-embed-md-body code': {
    background: 'var(--bg-hover)',
    padding: '1px 4px',
    borderRadius: '3px',
    fontSize: '11px',
  },
})
