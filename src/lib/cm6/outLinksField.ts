import { syntaxTree } from '@codemirror/language'
import { StateField } from '@codemirror/state'
import type { EditorState } from '@codemirror/state'
import { pushHeading, headingPathOf, type HeadingFrame } from './headingStack'

export interface OutLink {
  type: 'wiki' | 'md'
  target: string          // wiki: [[]] 内原始目标文本（含 anchor，未归一）；md: url
  label: string
  alias?: string          // wiki only
  headingPath?: string[]  // wiki only
  from?: number           // wiki only：链接起始 offset
  to?: number             // wiki only：链接结束 offset
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/

function extractOutLinks(state: EditorState): OutLink[] {
  const links: OutLink[] = []
  const seenMd = new Set<string>()
  const stack: HeadingFrame[] = []

  syntaxTree(state).iterate({
    from: 0,
    to: state.doc.length,
    enter(node) {
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') return false

      if (/^ATXHeading[1-6]$/.test(node.name)) {
        const line = state.doc.lineAt(node.from).text
        const m = HEADING_RE.exec(line)
        if (m) pushHeading(stack, m[1].length, m[2].trim())
        return false
      }

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
          links.push({
            type: 'wiki',
            target,
            label: alias || target,
            alias: alias || undefined,
            headingPath: headingPathOf(stack),
            from: node.from,
            to: node.to,
          })
        }
        return false
      }

      if (node.name === 'Autolink') {
        let url = state.doc.sliceString(node.from, node.to)
        if (url.startsWith('<') && url.endsWith('>')) url = url.slice(1, -1)
        if (url && !seenMd.has(url)) {
          seenMd.add(url)
          links.push({ type: 'md', target: url, label: url })
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
          if (!seenMd.has(url)) {
            seenMd.add(url)
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
