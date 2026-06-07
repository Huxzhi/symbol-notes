import type { MarkdownConfig, InlineParser } from '@lezer/markdown'
import { tags } from '@lezer/highlight'

// ── ![[...]] embed parser (must run before Image and WikiLink) ────────────────

const wikiEmbedInlineParser: InlineParser = {
  name: 'WikiEmbed',
  before: 'Image',
  parse(cx, next, pos) {
    if (next !== 33 /* ! */ || cx.char(pos + 1) !== 91 /* [ */ || cx.char(pos + 2) !== 91 /* [ */) return -1
    let end = pos + 3
    while (end < cx.end) {
      if (cx.char(end) === 93 /* ] */ && cx.char(end + 1) === 93 /* ] */) break
      end++
    }
    if (end >= cx.end) return -1
    return cx.addElement(cx.elt('WikiEmbed', pos, end + 2, [
      cx.elt('WikiEmbedMark',   pos,     pos + 3),
      cx.elt('WikiEmbedTarget', pos + 3, end),
      cx.elt('WikiEmbedMark',   end,     end + 2),
    ]))
  },
}

export const wikiEmbedParser: MarkdownConfig = {
  defineNodes: [
    { name: 'WikiEmbed',       style: tags.atom },
    { name: 'WikiEmbedMark',   style: tags.processingInstruction },
    { name: 'WikiEmbedTarget', style: tags.link },
  ],
  parseInline: [wikiEmbedInlineParser],
}

// ── [[...]] link parser ───────────────────────────────────────────────────────

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
    // Target/Alias intentionally have no highlight style: the .cm-wikilink mark
    // (in livePreviewExtension) owns their color so the accent applies cleanly.
    { name: 'WikiLink' },
    { name: 'WikiLinkMark',   style: tags.processingInstruction },
    { name: 'WikiLinkTarget' },
    { name: 'WikiLinkAlias' },
  ],
  parseInline: [wikiLinkInlineParser],
}
