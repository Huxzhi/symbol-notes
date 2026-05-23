import type { MarkdownConfig, InlineParser } from '@lezer/markdown'
import { tags } from '@lezer/highlight'

const wikiLinkInlineParser: InlineParser = {
  name: 'WikiLink',
  before: 'Link',
  parse(cx, next, pos) {
    if (next !== 91 /* [ */ || cx.char(pos + 1) !== 91 /* [ */) return -1

    let end = pos + 2
    while (end < cx.end) {
      if (cx.char(end) === 93 /* ] */ && cx.char(end + 1) === 93 /* ] */) break
      end++
    }
    if (end >= cx.end) return -1

    let pipePos = -1
    for (let i = pos + 2; i < end; i++) {
      if (cx.char(i) === 124 /* | */) { pipePos = i; break }
    }

    const children = pipePos === -1
      ? [
          cx.elt('WikiLinkMark',   pos,         pos + 2),
          cx.elt('WikiLinkTarget', pos + 2,     end),
          cx.elt('WikiLinkMark',   end,         end + 2),
        ]
      : [
          cx.elt('WikiLinkMark',   pos,         pos + 2),
          cx.elt('WikiLinkTarget', pos + 2,     pipePos),
          cx.elt('WikiLinkMark',   pipePos,     pipePos + 1),
          cx.elt('WikiLinkAlias',  pipePos + 1, end),
          cx.elt('WikiLinkMark',   end,         end + 2),
        ]

    return cx.addElement(cx.elt('WikiLink', pos, end + 2, children))
  },
}

export const wikiLinkParser: MarkdownConfig = {
  defineNodes: [
    { name: 'WikiLink',       style: tags.link },
    { name: 'WikiLinkMark',   style: tags.processingInstruction },
    { name: 'WikiLinkTarget', style: tags.link },
    { name: 'WikiLinkAlias',  style: tags.labelName },
  ],
  parseInline: [wikiLinkInlineParser],
}
