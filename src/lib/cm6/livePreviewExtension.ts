import { syntaxTree } from '@codemirror/language'
import {
  type EditorState,
  RangeSetBuilder,
  StateField,
} from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import { detectFrontmatter } from './frontmatterField'
import { completionLineEdit, todayISO } from './listsField'

// ── Shared decorations ──────────────────────────────────────────────────────

const hide = Decoration.replace({})
const wikiLinkMark = Decoration.mark({ class: 'cm-wikilink' })
const mdLinkMark = Decoration.mark({ class: 'cm-mdlink' })

// ── Widgets ──────────────────────────────────────────────────────────────────

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly markerFrom: number,
  ) {
    super()
  }

  eq(other: CheckboxWidget) {
    return other.checked === this.checked
  }

  toDOM(view: EditorView) {
    const el = document.createElement('input')
    el.type = 'checkbox'
    el.checked = this.checked
    el.className = 'cm-task-checkbox'
    el.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const willCheck = !this.checked
      const line = view.state.doc.lineAt(this.markerFrom)
      const changes: { from: number; to: number; insert: string }[] = [
        {
          from: this.markerFrom,
          to: this.markerFrom + 3,
          insert: willCheck ? '[x]' : '[ ]',
        },
      ]
      const edit = completionLineEdit(line.text, willCheck, todayISO())
      if (edit.append) {
        changes.push({ from: line.to, to: line.to, insert: edit.append })
      } else if (edit.remove) {
        changes.push({
          from: line.from + edit.remove.from,
          to: line.from + edit.remove.to,
          insert: '',
        })
      }
      view.dispatch({ changes })
    })
    return el
  }
}

class FencedTopWidget extends WidgetType {
  constructor(readonly lang: string) {
    super()
  }
  eq(other: FencedTopWidget) {
    return other.lang === this.lang
  }
  toDOM() {
    const el = document.createElement('div')
    el.className = 'cm-fenced-top'
    if (this.lang) {
      const label = document.createElement('span')
      label.className = 'cm-fenced-lang'
      label.textContent = this.lang
      el.appendChild(label)
    }
    return el
  }
}

class FencedBottomWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const el = document.createElement('div')
    el.className = 'cm-fenced-bottom'
    return el
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-list-bullet'
    return el
  }
}

class HRWidget extends WidgetType {
  toDOM() {
    const el = document.createElement('div')
    el.className = 'cm-hr-widget'
    return el
  }
  eq() {
    return true
  }
}

class TableWidget extends WidgetType {
  constructor(readonly text: string) {
    super()
  }

  eq(other: TableWidget) {
    return other.text === this.text
  }

  toDOM() {
    const lines = this.text.split('\n').filter((l) => l.trim())
    const parseRow = (line: string) =>
      line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim())

    const headers = parseRow(lines[0] ?? '')
    const dataRows = lines.slice(2).map(parseRow)

    const table = document.createElement('table')
    table.className = 'cm-table-widget'

    const thead = table.createTHead()
    const headerRow = thead.insertRow()
    headers.forEach((h) => {
      const th = document.createElement('th')
      th.textContent = h
      headerRow.appendChild(th)
    })

    const tbody = table.createTBody()
    dataRows.forEach((cells) => {
      const tr = tbody.insertRow()
      cells.forEach((cell) => {
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
  const fm = detectFrontmatter(state)

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

      if (node.name === 'FencedCode') {
        const openLine = state.doc.lineAt(node.from)

        // Find lang (CodeInfo) and closing CodeMark position
        const c = node.node.cursor()
        let lang = ''
        let closeMarkFrom = node.to
        if (c.firstChild()) {
          do {
            if (c.name === 'CodeInfo')
              lang = state.doc.sliceString(c.from, c.to).trim()
            else if (c.name === 'CodeMark' && c.from > openLine.to)
              closeMarkFrom = c.from
          } while (c.nextSibling())
        }
        const closeLine = state.doc.lineAt(closeMarkFrom)

        const cursorOnOpen = sel.from <= openLine.to && sel.to >= openLine.from
        const cursorOnClose =
          sel.from <= closeLine.to && sel.to >= closeLine.from

        // Opening ``` line → top border widget (hide only if cursor is on that line)
        // 这里没有添加 openLine.to + 1 ，因为第一行被top widget完全覆盖了
        if (!cursorOnOpen) {
          const openTo = Math.min(openLine.to, state.doc.length)
          builder.add(
            openLine.from,
            openTo,
            Decoration.replace({
              widget: new FencedTopWidget(lang),
              block: true,
            }),
          )
        }

        // Code content lines → side-border line class (always, no height change on cursor move)
        const fencedLine = Decoration.line({ class: 'cm-fenced-code-line' })
        for (let n = openLine.number + 1; n < closeLine.number; n++) {
          const ln = state.doc.line(n)
          builder.add(ln.from, ln.from, fencedLine)
        }

        // Closing ``` line → bottom border widget (hide only if cursor is on that line)
        if (!cursorOnClose && closeLine.from > openLine.to) {
          const closeFrom = closeLine.from
          const closeTo = Math.min(closeLine.to + 1, state.doc.length)
          builder.add(
            closeFrom,
            closeTo,
            Decoration.replace({
              widget: new FencedBottomWidget(),
              block: true,
            }),
          )
        }

        return false
      }

      if (node.name === 'HorizontalRule' || node.name === 'Table') {
        // Skip HR nodes that are the --- delimiters of a frontmatter block
        if (fm && node.name === 'HorizontalRule' && node.from < fm.blockTo)
          return
        // +1 to include the trailing \n — block decorations must cover complete lines
        const to = Math.min(node.to + 1, state.doc.length)
        if (sel.from < to && sel.to >= node.from) return

        if (node.name === 'HorizontalRule') {
          builder.add(
            node.from,
            to,
            Decoration.replace({ widget: new HRWidget(), block: true }),
          )
          return
        }

        const text = state.doc.sliceString(node.from, node.to)
        builder.add(
          node.from,
          to,
          Decoration.replace({ widget: new TableWidget(text), block: true }),
        )
        return false // skip Table children — handled as one unit
      }
    },
  })

  return builder.finish()
}

const blockPreviewField = StateField.define<DecorationSet>({
  create(state) {
    return buildBlockDecos(state)
  },
  update(decos, tr) {
    const selMoved =
      tr.state.selection.main.head !== tr.startState.selection.main.head
    if (tr.docChanged || selMoved) return buildBlockDecos(tr.state)
    return decos.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f),
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
          case 'FencedCode':
          case 'CodeBlock':
            return false // skip — content handled by blockPreviewField; embedded language nodes can break ordering

          case 'QuoteMark': {
            // Use line-level check: cursor anywhere on the blockquote line reveals >
            const line = state.doc.lineAt(node.from)
            if (sel.from <= line.to && sel.to >= line.from) return
            builder.add(node.from, node.to, hide)
            break
          }

          case 'ListMark': {
            if (selOverlaps) return
            const mark = state.doc.sliceString(node.from, node.to)
            if (mark !== '-' && mark !== '*' && mark !== '+') break
            // If this list item is a task ("- [ ]"), hide the mark + space so the
            // checkbox widget (from TaskMarker) becomes the leading element.
            const rest = state.doc.sliceString(node.to, node.to + 4)
            if (/^ \[[ xX]\]/.test(rest)) {
              builder.add(node.from, node.to + 1, hide)
            } else {
              builder.add(
                node.from,
                node.to,
                Decoration.replace({ widget: new BulletWidget() }),
              )
            }
            break
          }

          case 'TaskMarker': {
            if (selOverlaps) return
            const text = state.doc.sliceString(node.from, node.to)
            const checked = text === '[x]' || text === '[X]'
            builder.add(
              node.from,
              node.to,
              Decoration.replace({
                widget: new CheckboxWidget(checked, node.from),
              }),
            )
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
                const end =
                  c.to < node.to &&
                  state.doc.sliceString(c.to, c.to + 1) === ' '
                    ? c.to + 1
                    : c.to
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
            if (selOverlaps) return false
            const c = node.node.cursor()
            if (!c.firstChild()) return false
            const children: { name: string; from: number; to: number }[] = []
            do {
              children.push({ name: c.name, from: c.from, to: c.to })
            } while (c.nextSibling())
            const hasAlias = children.some((ch) => ch.name === 'WikiLinkAlias')
            for (const ch of children) {
              if (ch.name === 'WikiLinkMark') {
                builder.add(ch.from, ch.to, hide)
              } else if (ch.name === 'WikiLinkTarget') {
                if (!hasAlias) builder.add(ch.from, ch.to, wikiLinkMark)
                else builder.add(ch.from, ch.to, hide)
              } else if (ch.name === 'WikiLinkAlias') {
                builder.add(ch.from, ch.to, wikiLinkMark)
              }
            }
            return false
          }

          case 'Autolink': {
            if (selOverlaps) return false
            const text = state.doc.sliceString(node.from, node.to)
            if (text.startsWith('<') && text.endsWith('>')) {
              builder.add(node.from, node.from + 1, hide)
              builder.add(node.from + 1, node.to - 1, mdLinkMark)
              builder.add(node.to - 1, node.to, hide)
            } else {
              builder.add(node.from, node.to, mdLinkMark)
            }
            return false
          }

          case 'Link':
          case 'Image': {
            if (selOverlaps) return
            const c = node.node.cursor()
            let urlFrom = -1
            if (c.firstChild()) {
              do {
                if (c.name === 'URL') {
                  urlFrom = c.from
                  break
                }
              } while (c.nextSibling())
            }
            if (urlFrom < 0) return false
            const prefixLen = node.name === 'Image' ? 2 : 1 // `![` vs `[`
            const labelStart = node.from + prefixLen
            const labelEnd = urlFrom - 2 // position of `](`
            builder.add(node.from, labelStart, hide)
            if (labelEnd > labelStart)
              builder.add(labelStart, labelEnd, mdLinkMark)
            builder.add(labelEnd, node.to, hide)
            return false
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
  { decorations: (v) => v.decorations },
)

// ── Public export ────────────────────────────────────────────────────────────

export const livePreviewExtension = [inlinePreviewPlugin, blockPreviewField]
