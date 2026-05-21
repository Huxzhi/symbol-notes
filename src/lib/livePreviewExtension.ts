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

// ── Widgets ──────────────────────────────────────────────────────────────────

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly markerFrom: number) {
    super()
  }

  eq(other: CheckboxWidget) { return other.checked === this.checked }

  toDOM(view: EditorView) {
    const el = document.createElement('input')
    el.type = 'checkbox'
    el.checked = this.checked
    el.className = 'cm-task-checkbox'
    el.addEventListener('mousedown', (e) => {
      e.preventDefault()
      view.dispatch({
        changes: {
          from: this.markerFrom,
          to: this.markerFrom + 3,
          insert: this.checked ? '[ ]' : '[x]',
        },
      })
    })
    return el
  }
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

    // Wrap in a div using padding (not margin) so CM6's offsetHeight measurement
    // includes the spacing, keeping cursor position mapping accurate below tables.
    const wrapper = document.createElement('div')
    wrapper.className = 'cm-table-widget-wrapper'
    wrapper.appendChild(table)
    return wrapper
  }
}

// ── StateField: block decorations (Blockquote line class + HR + Table) ─────────

const blockquoteLine = Decoration.line({ class: 'cm-blockquote' })

function buildBlockDecos(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const sel = state.selection.main
  const seenLines = new Set<number>()

  syntaxTree(state).iterate({
    from: 0,
    to: state.doc.length,
    enter(node) {
      // QuoteMark: add a line-level class for the left border.
      // Must be in StateField (not ViewPlugin) to avoid from-position conflicts
      // with the ViewPlugin's Decoration.replace for the same QuoteMark.
      if (node.name === 'QuoteMark') {
        const line = state.doc.lineAt(node.from)
        if (sel.from <= line.to && sel.to >= line.from) return
        if (!seenLines.has(line.number)) {
          seenLines.add(line.number)
          builder.add(line.from, line.from, blockquoteLine)
        }
        return
      }

      if (node.name === 'HorizontalRule' || node.name === 'Table') {
        // +1 to include the trailing \n — block decorations must cover complete lines
        const to = Math.min(node.to + 1, state.doc.length)
        if (sel.from < to && sel.to >= node.from) return

        if (node.name === 'HorizontalRule') {
          builder.add(node.from, to, Decoration.replace({ widget: new HRWidget(), block: true }))
          return
        }

        const text = state.doc.sliceString(node.from, node.to)
        builder.add(node.from, to, Decoration.replace({ widget: new TableWidget(text), block: true }))
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
  const sel = state.selection.main

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        const selOverlaps = sel.from <= node.to && sel.to >= node.from
        switch (node.name) {
          case 'QuoteMark': {
            // Use line-level check: cursor anywhere on the blockquote line reveals >
            const line = state.doc.lineAt(node.from)
            if (sel.from <= line.to && sel.to >= line.from) return
            builder.add(node.from, node.to, hide)
            break
          }

          case 'TaskMarker': {
            if (selOverlaps) return
            const text = state.doc.sliceString(node.from, node.to)
            const checked = text === '[x]' || text === '[X]'
            builder.add(node.from, node.to, Decoration.replace({
              widget: new CheckboxWidget(checked, node.from),
            }))
            break
          }

          case 'StrongEmphasis':
          case 'Emphasis': {
            if (selOverlaps) return
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
            if (selOverlaps) return
            const c = node.node.cursor()
            if (!c.firstChild()) return
            do {
              if (c.name === 'HeaderMark') {
                const end = (c.to < node.to && state.doc.sliceString(c.to, c.to + 1) === ' ')
                  ? c.to + 1 : c.to
                builder.add(c.from, end, hide)
              }
            } while (c.nextSibling())
            break
          }

          case 'InlineCode': {
            if (selOverlaps) return
            const c = node.node.cursor()
            if (!c.firstChild()) return
            do {
              if (c.name === 'CodeMark') builder.add(c.from, c.to, hide)
            } while (c.nextSibling())
            break
          }

          case 'WikiLink': {
            if (selOverlaps) return
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
