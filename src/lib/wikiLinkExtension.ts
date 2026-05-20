import { MatchDecorator, ViewPlugin, Decoration, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { EditorView } from '@codemirror/view'

const matcher = new MatchDecorator({
  regexp: /\[\[([^\]]+)\]\]/g,
  decoration: () => Decoration.mark({ class: 'cm-wikilink' }),
})

export const wikiLinkExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = matcher.createDeco(view)
    }
    update(update: ViewUpdate) {
      this.decorations = matcher.updateDeco(update, this.decorations)
    }
  },
  { decorations: (v) => v.decorations },
)
