import { syntaxTree } from '@codemirror/language'
import { StateField } from '@codemirror/state'
import type { EditorState } from '@codemirror/state'

export interface OutLink {
  type: 'wiki' | 'md'
  target: string
  label: string
}

function extractOutLinks(state: EditorState): OutLink[] {
  const links: OutLink[] = []
  const seen = new Set<string>()

  syntaxTree(state).iterate({
    from: 0,
    to: state.doc.length,
    enter(node) {
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') return false

      if (node.name === 'WikiLink') {
        const c = node.node.cursor()
        let target = '', alias = ''
        if (c.firstChild()) {
          do {
            if (c.name === 'WikiLinkTarget') target = state.doc.sliceString(c.from, c.to)
            else if (c.name === 'WikiLinkAlias') alias = state.doc.sliceString(c.from, c.to)
          } while (c.nextSibling())
        }
        if (target) {
          const key = `wiki:${target}`
          if (!seen.has(key)) {
            seen.add(key)
            links.push({ type: 'wiki', target, label: alias || target })
          }
        }
        return false
      }

      if (node.name === 'Autolink') {
        let url = state.doc.sliceString(node.from, node.to)
        if (url.startsWith('<') && url.endsWith('>')) url = url.slice(1, -1)
        if (url) {
          const key = `md:${url}`
          if (!seen.has(key)) {
            seen.add(key)
            links.push({ type: 'md', target: url, label: url })
          }
        }
        return false
      }

      if (node.name === 'Link' || node.name === 'Image') {
        const c = node.node.cursor()
        let url = '', urlFrom = -1, labelText = ''
        if (c.firstChild()) {
          do {
            if (c.name === 'URL') { url = state.doc.sliceString(c.from, c.to); urlFrom = c.from }
          } while (c.nextSibling())
        }
        if (url) {
          if (urlFrom > node.from + 1) {
            // Link: [label](url) → label is between node.from+1 and urlFrom-2
            // Image: ![label](url) → label is between node.from+2 and urlFrom-2
            const labelStart = node.name === 'Image' ? node.from + 2 : node.from + 1
            labelText = state.doc.sliceString(labelStart, urlFrom - 2).trim()
          }
          const key = `md:${url}`
          if (!seen.has(key)) {
            seen.add(key)
            links.push({ type: 'md', target: url, label: labelText || url })
          }
        }
        return false
      }
    },
  })

  return links
}

export const outLinksField = StateField.define<OutLink[]>({
  create: extractOutLinks,
  update(links, tr) {
    if (tr.docChanged) return extractOutLinks(tr.state)
    return links
  },
})
