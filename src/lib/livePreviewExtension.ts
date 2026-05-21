import { syntaxTree } from '@codemirror/language'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import { RangeSetBuilder, StateField, type EditorState } from '@codemirror/state'

// ── Shared decorations ──────────────────────────────────────────────────────

const hide = Decoration.replace({})
const wikiLinkMark = Decoration.mark({ class: 'cm-wikilink' })

// ── Block widgets (must live in StateField, not ViewPlugin) ─────────────────

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

// ── StateField: block decorations (HR + Table) ──────────────────────────────

function buildBlockDecos(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const cursorPos = state.selection.main.head
  const cursorLine = state.doc.lineAt(cursorPos).number

  syntaxTree(state).iterate({
    from: 0,
    to: state.doc.length,
    enter(node) {
      if (node.name === 'HorizontalRule') {
        if (state.doc.lineAt(node.from).number === cursorLine) return
        // +1 to include the trailing \n — CM6 block decorations must cover complete lines
        const to = Math.min(node.to + 1, state.doc.length)
        builder.add(node.from, to, Decoration.replace({
          widget: new HRWidget(),
          block: true,
        }))
        return
      }

      if (node.name === 'Table') {
        // +1 to include the trailing \n for the same reason
        const to = Math.min(node.to + 1, state.doc.length)
        if (cursorPos >= node.from && cursorPos < to) return
        const text = state.doc.sliceString(node.from, node.to)
        builder.add(node.from, to, Decoration.replace({
          widget: new TableWidget(text),
          block: true,
        }))
        return false  // skip Table children — handled as one unit
      }
    },
  })

  return builder.finish()
}

const blockPreviewField = StateField.define<DecorationSet>({
  create(state) { return buildBlockDecos(state) },
  update(decos, tr) {
    const selMoved = tr.state.selection.main.head !== tr.startState.selection.main.head
    if (tr.docChanged || selMoved) return buildBlockDecos(tr.state)
    return decos.map(tr.changes)
  },
  provide: f => EditorView.decorations.from(f),
})

// ── ViewPlugin: inline decorations (bold / italic / code / wikilink) ─────────

function buildInlineDecos(view: EditorView): DecorationSet {
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
            if (cursorPos >= node.from && cursorPos <= node.to) return
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
            if (cursorPos >= node.from && cursorPos <= node.to) return
            const c = node.node.cursor()
            if (!c.firstChild()) return
            do {
              if (c.name === 'CodeMark') builder.add(c.from, c.to, hide)
            } while (c.nextSibling())
            break
          }

          case 'WikiLink': {
            if (cursorPos >= node.from && cursorPos <= node.to) return
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

const inlinePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildInlineDecos(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildInlineDecos(update.view)
      }
    }
  },
  { decorations: v => v.decorations },
)

// ── Public export ────────────────────────────────────────────────────────────

export const livePreviewExtension = [inlinePreviewPlugin, blockPreviewField]
