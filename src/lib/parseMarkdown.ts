import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { wikiLinkParser } from './cm6/wikiLinkParser'
import { outLinksField } from './cm6/outLinksField'
import { inlineTagsField } from './cm6/inlineTagsField'
import { listsField } from './cm6/listsField'
import { splitWikiTarget } from './cm6/wikiTarget'
import type { ListItem, WikiLinkInfo } from '../stores/types'

export interface ParseResult {
  outLinks: WikiLinkInfo[]
  inlineTags: string[]
  lists: ListItem[]
}

const EXTENSIONS = [
  markdown({ extensions: [GFM, wikiLinkParser] }),
  outLinksField,
  inlineTagsField,
  listsField,
]

// 从一个已含 outLinksField/inlineTagsField/listsField 的 EditorState 抽取结果。
// 供活跃编辑器复用（避免重新解析整篇）。
export function parseFromState(state: EditorState): ParseResult {
  return extractResult(state)
}

function extractResult(state: EditorState): ParseResult {
  const tagMatches = state.field(inlineTagsField)
  const lineOfTag = new Map<number, string[]>()
  for (const t of tagMatches) {
    const ln = state.doc.lineAt(t.from).number
    const arr = lineOfTag.get(ln) ?? []
    arr.push(t.tag)
    lineOfTag.set(ln, arr)
  }

  const outLinks: WikiLinkInfo[] = state.field(outLinksField)
    .filter(l => l.type === 'wiki')
    .map(l => {
      const { base, anchor } = splitWikiTarget(l.target)
      const target = base.endsWith('.md') ? base : `${base}.md`
      const ln = l.from != null ? state.doc.lineAt(l.from).number : -1
      return {
        target,
        alias: l.alias,
        anchor,
        headingPath: l.headingPath ?? [],
        lineTags: lineOfTag.get(ln) ?? [],
        from: l.from ?? 0,
        to: l.to ?? 0,
      }
    })

  return {
    outLinks,
    inlineTags: state.field(inlineTagsField).map(m => m.tag),
    lists: state.field(listsField),
  }
}

// One-shot parse — creates a fresh EditorState each call.
export function parseMarkdown(content: string): ParseResult {
  return extractResult(EditorState.create({ doc: content, extensions: EXTENSIONS }))
}

// Reusable parser — initialises extensions once, replaces doc via transaction.
// Create at the start of a batch, call parse() per file, discard when done.
export function createMarkdownParser(): { parse(content: string): ParseResult } {
  let state = EditorState.create({ doc: '', extensions: EXTENSIONS })
  return {
    parse(content: string): ParseResult {
      state = state.update({
        changes: { from: 0, to: state.doc.length, insert: content },
      }).state
      return extractResult(state)
    },
  }
}
