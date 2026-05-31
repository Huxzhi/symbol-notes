import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { wikiLinkParser } from './wikiLinkParser'
import { outLinksField } from './outLinksField'
import { inlineTagsField } from './inlineTagsField'
import { tasksField } from './tasksField'
import type { TaskItem } from '../stores/types'

export interface ParseResult {
  outLinks: string[]
  inlineTags: string[]
  tasks: TaskItem[]
}

const EXTENSIONS = [
  markdown({ extensions: [GFM, wikiLinkParser] }),
  outLinksField,
  inlineTagsField,
  tasksField,
]

function extractResult(state: EditorState): ParseResult {
  return {
    outLinks: state.field(outLinksField)
      .filter(l => l.type === 'wiki')
      .map(l => l.target.endsWith('.md') ? l.target : `${l.target}.md`),
    inlineTags: state.field(inlineTagsField).map(m => m.tag),
    tasks: state.field(tasksField),
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
