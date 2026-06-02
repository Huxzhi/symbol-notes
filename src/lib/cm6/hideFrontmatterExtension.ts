import { RangeSetBuilder, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'

function buildFrontmatterDeco(docStr: string): DecorationSet {
  if (!docStr.startsWith('---')) return Decoration.none
  const end = docStr.indexOf('\n---', 3)
  if (end === -1) return Decoration.none
  const hideEnd = end + 4 < docStr.length && docStr[end + 4] === '\n' ? end + 5 : end + 4
  const builder = new RangeSetBuilder<Decoration>()
  builder.add(0, hideEnd, Decoration.replace({}))
  return builder.finish()
}

// StateField (not ViewPlugin) is required for decorations that replace line breaks.
export const hideFrontmatterExtension = StateField.define<DecorationSet>({
  create(state) {
    return buildFrontmatterDeco(state.doc.toString())
  },
  update(deco, tr) {
    return tr.docChanged ? buildFrontmatterDeco(tr.newDoc.toString()) : deco
  },
  provide: (f) => EditorView.decorations.from(f),
})
