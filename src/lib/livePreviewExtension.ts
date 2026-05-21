import { syntaxTree } from '@codemirror/language'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'

const hide = Decoration.replace({})
const wikiLinkMark = Decoration.mark({ class: 'cm-wikilink' })

function cursorInNode(cursorPos: number, from: number, to: number): boolean {
  return cursorPos >= from && cursorPos <= to
}

function buildDecos(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const { state } = view
  const cursorPos = state.selection.main.head
  const cursorLine = state.doc.lineAt(cursorPos).number

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        switch (node.name) {
          case 'StrongEmphasis':
          case 'Emphasis': {
            if (cursorInNode(cursorPos, node.from, node.to)) return
            const c = node.node.cursor()
            if (!c.firstChild()) return
            do {
              if (c.name === 'EmphasisMark') builder.add(c.from, c.to, hide)
            } while (c.nextSibling())
            break
          }

          case 'ATXHeading1':
          case 'ATXHeading2':
          case 'ATXHeading3':
          case 'ATXHeading4':
          case 'ATXHeading5':
          case 'ATXHeading6': {
            if (state.doc.lineAt(node.from).number === cursorLine) return
            const c = node.node.cursor()
            if (!c.firstChild()) return
            do {
              // +1 covers the space after the # markers (e.g. "# " or "## ")
              if (c.name === 'HeaderMark') builder.add(c.from, c.to + 1, hide)
            } while (c.nextSibling())
            break
          }

          case 'InlineCode': {
            if (cursorInNode(cursorPos, node.from, node.to)) return
            const c = node.node.cursor()
            if (!c.firstChild()) return
            do {
              if (c.name === 'CodeMark') builder.add(c.from, c.to, hide)
            } while (c.nextSibling())
            break
          }

          case 'WikiLink': {
            if (cursorInNode(cursorPos, node.from, node.to)) return
            const c = node.node.cursor()
            if (!c.firstChild()) return
            do {
              if (c.name === 'WikiLinkMark') {
                builder.add(c.from, c.to, hide)
              } else if (c.name === 'WikiLinkTarget') {
                builder.add(c.from, c.to, wikiLinkMark)
              }
            } while (c.nextSibling())
            break
          }
        }
      },
    })
  }

  return builder.finish()
}

export const livePreviewExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDecos(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecos(update.view)
      }
    }
  },
  { decorations: v => v.decorations },
)
