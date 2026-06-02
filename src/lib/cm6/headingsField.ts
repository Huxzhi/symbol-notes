import { syntaxTree } from '@codemirror/language'
import { StateField } from '@codemirror/state'
import type { EditorState } from '@codemirror/state'
import { detectFrontmatter } from './frontmatterField'

export interface Heading {
  level: number
  text: string
  from: number
}

function extractHeadings(state: EditorState): Heading[] {
  const headings: Heading[] = []
  const fm = detectFrontmatter(state)
  const fmEnd = fm?.blockTo ?? 0

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name.startsWith('ATXHeading')) {
        if (node.from < fmEnd) return false
        const level = parseInt(node.name[10])
        const c = node.node.cursor()
        let textFrom = node.from
        if (c.firstChild()) {
          do {
            if (c.name === 'HeaderMark') textFrom = c.to
          } while (c.nextSibling())
        }
        headings.push({ level, text: state.doc.sliceString(textFrom, node.to).trim(), from: node.from })
        return false
      }

      if (node.name.startsWith('SetextHeading')) {
        if (node.from < fmEnd) return false
        const level = parseInt(node.name[13])
        const c = node.node.cursor()
        let textTo = node.to
        if (c.firstChild()) {
          do {
            if (c.name === 'HeaderMark') { textTo = c.from; break }
          } while (c.nextSibling())
        }
        headings.push({ level, text: state.doc.sliceString(node.from, textTo).trim(), from: node.from })
        return false
      }
    },
  })

  return headings
}

export const headingsField = StateField.define<Heading[]>({
  create: extractHeadings,
  update(headings, tr) {
    if (tr.docChanged) return extractHeadings(tr.state)
    return headings
  },
})
