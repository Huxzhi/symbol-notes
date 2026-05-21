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

const hide = Decoration.replace({})
const wikiLinkMark = Decoration.mark({ class: 'cm-wikilink' })

function cursorInNode(cursorPos: number, from: number, to: number): boolean {
  return cursorPos >= from && cursorPos <= to
}

class HRWidget extends WidgetType {
  toDOM() {
    const el = document.createElement('div')
    el.className = 'cm-hr-widget'
    return el
  }
  eq() { return true }
}

class TableWidget extends WidgetType {
  constructor(readonly text: string) { super() }

  eq(other: TableWidget) { return other.text === this.text }

  toDOM() {
    const lines = this.text.split('\n').filter(l => l.trim())
    const parseRow = (line: string) =>
      line.split('|').slice(1, -1).map(c => c.trim())

    const headers = parseRow(lines[0] ?? '')
    const dataRows = lines.slice(2).map(parseRow)

    const table = document.createElement('table')
    table.className = 'cm-table-widget'

    const thead = table.createTHead()
    const headerRow = thead.insertRow()
    headers.forEach(h => {
      const th = document.createElement('th')
      th.textContent = h
      headerRow.appendChild(th)
    })

    const tbody = table.createTBody()
    dataRows.forEach(cells => {
      const tr = tbody.insertRow()
      cells.forEach(cell => {
        const td = tr.insertCell()
        td.textContent = cell
      })
    })

    return table
  }
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

          case 'HorizontalRule': {
            if (state.doc.lineAt(node.from).number === cursorLine) return
            builder.add(node.from, node.to, Decoration.replace({
              widget: new HRWidget(),
              block: true,
            }))
            break
          }

          case 'Table': {
            if (cursorInNode(cursorPos, node.from, node.to)) return
            const text = state.doc.sliceString(node.from, node.to)
            builder.add(node.from, node.to, Decoration.replace({
              widget: new TableWidget(text),
              block: true,
            }))
            return false  // skip child nodes, table is handled as one unit
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
