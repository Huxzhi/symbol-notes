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

export function parseMarkdown(content: string): ParseResult {
  const state = EditorState.create({
    doc: content,
    extensions: [
      markdown({ extensions: [GFM, wikiLinkParser] }),
      outLinksField,
      inlineTagsField,
      tasksField,
    ],
  })
  return {
    outLinks: state.field(outLinksField)
      .filter(l => l.type === 'wiki')
      .map(l => l.target.endsWith('.md') ? l.target : `${l.target}.md`),
    inlineTags: state.field(inlineTagsField).map(m => m.tag),
    tasks: state.field(tasksField),
  }
}
