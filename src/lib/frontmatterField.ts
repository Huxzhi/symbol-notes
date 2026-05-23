import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from '@codemirror/view'
import { EditorSelection, RangeSetBuilder, StateField } from '@codemirror/state'
import type { EditorState } from '@codemirror/state'
import { parseYamlSubset } from './parseFrontmatter'

interface FrontmatterRange {
  blockFrom: number
  blockTo: number
  yamlFrom: number
  yamlTo: number
}

export function detectFrontmatter(state: EditorState): FrontmatterRange | null {
  if (state.doc.lines < 3) return null
  const firstLine = state.doc.line(1)
  if (firstLine.text.trim() !== '---') return null
  for (let i = 2; i <= Math.min(state.doc.lines, 100); i++) {
    const line = state.doc.line(i)
    if (line.text.trim() === '---') {
      return {
        blockFrom: firstLine.from,
        blockTo: Math.min(line.to + 1, state.doc.length),
        yamlFrom: firstLine.to + 1,
        yamlTo: line.from,
      }
    }
  }
  return null
}

class FrontmatterWidget extends WidgetType {
  constructor(
    readonly yaml: string,
    readonly yamlFrom: number,
    readonly yamlTo: number,
  ) { super() }

  eq(other: FrontmatterWidget) {
    return other.yaml === this.yaml &&
      other.yamlFrom === this.yamlFrom &&
      other.yamlTo === this.yamlTo
  }

  toDOM(view: EditorView): HTMLElement {
    const parsed = parseYamlSubset(this.yaml)

    const wrapper = document.createElement('div')
    wrapper.className = 'cm-frontmatter-widget'

    const fields: Array<{ keyInput: HTMLInputElement; valueInput: HTMLInputElement; isArray: boolean }> = []

    const dispatch = () => {
      const pairs: string[] = []
      for (const f of fields) {
        const k = f.keyInput.value.trim()
        const v = f.valueInput.value
        if (!k) continue
        if (f.isArray) {
          const items = v.split(',').map(s => s.trim()).filter(Boolean)
          pairs.push(
            items.length === 0
              ? `${k}: []`
              : `${k}:\n${items.map(i => `  - ${i}`).join('\n')}`,
          )
        } else {
          pairs.push(`${k}: ${v}`)
        }
      }
      const newYaml = pairs.join('\n') + '\n'
      if (newYaml !== this.yaml) {
        view.dispatch({ changes: { from: this.yamlFrom, to: this.yamlTo, insert: newYaml } })
      }
    }

    const addRow = (key = '', val = '', isArray = false): HTMLInputElement => {
      const row = document.createElement('div')
      row.className = 'cm-frontmatter-row'

      const keyInput = document.createElement('input')
      keyInput.type = 'text'
      keyInput.className = 'cm-frontmatter-key cm-frontmatter-key-input'
      keyInput.value = key
      keyInput.placeholder = 'property'

      const valueInput = document.createElement('input')
      valueInput.type = 'text'
      valueInput.className = 'cm-frontmatter-value'
      valueInput.value = val
      valueInput.placeholder = 'value'

      fields.push({ keyInput, valueInput, isArray })
      keyInput.addEventListener('blur', dispatch)
      valueInput.addEventListener('blur', dispatch)

      row.appendChild(keyInput)
      row.appendChild(valueInput)
      wrapper.insertBefore(row, addBtn)
      return keyInput
    }

    const addBtn = document.createElement('button')
    addBtn.className = 'cm-frontmatter-add-btn'
    addBtn.textContent = '+ Add property'
    addBtn.addEventListener('mousedown', (e) => {
      e.preventDefault()
      addRow().focus()
    })
    wrapper.appendChild(addBtn)

    for (const [key, value] of Object.entries(parsed)) {
      const isArray = Array.isArray(value)
      addRow(
        key,
        isArray ? (value as unknown[]).join(', ') : String(value ?? ''),
        isArray,
      )
    }

    return wrapper
  }
}

class AddFrontmatterWidget extends WidgetType {
  eq() { return true }

  toDOM(view: EditorView): HTMLElement {
    const btn = document.createElement('button')
    btn.className = 'cm-frontmatter-add-btn cm-add-frontmatter-btn'
    btn.textContent = '+ Add property'
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const insert = '---\n\n---\n'
      view.dispatch({
        changes: { from: 0, to: 0, insert },
        selection: EditorSelection.cursor(insert.length),
      })
    })
    return btn
  }
}

function buildFrontmatterDecos(state: EditorState): DecorationSet {
  const fm = detectFrontmatter(state)
  if (!fm) {
    const builder = new RangeSetBuilder<Decoration>()
    builder.add(0, 0, Decoration.widget({ widget: new AddFrontmatterWidget(), block: true, side: -1 }))
    return builder.finish()
  }

  const { from: selFrom, to: selTo } = state.selection.main
  if (selFrom < fm.blockTo && selTo >= fm.blockFrom) return Decoration.none

  const yaml = state.doc.sliceString(fm.yamlFrom, fm.yamlTo)
  const builder = new RangeSetBuilder<Decoration>()
  builder.add(
    fm.blockFrom,
    fm.blockTo,
    Decoration.replace({
      widget: new FrontmatterWidget(yaml, fm.yamlFrom, fm.yamlTo),
      block: true,
    }),
  )
  return builder.finish()
}

export const frontmatterField = StateField.define<DecorationSet>({
  create(state) { return buildFrontmatterDecos(state) },
  update(decos, tr) {
    if (tr.docChanged || tr.state.selection.main.head !== tr.startState.selection.main.head) {
      return buildFrontmatterDecos(tr.state)
    }
    return decos.map(tr.changes)
  },
  provide: f => EditorView.decorations.from(f),
})
