import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'
import { RangeSetBuilder, StateField } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { detectFrontmatter } from './frontmatterField'

export interface TagMatch {
  tag: string  // without #
  from: number
  to: number
}

const TAG_RE = /(?<!\S)#([a-zA-Z_一-龥][a-zA-Z0-9_一-龥\/-]*)/g

function scanTags(state: EditorState): TagMatch[] {
  const fm = detectFrontmatter(state)
  const bodyStart = fm ? fm.blockTo : 0

  const codeRanges: Array<[number, number]> = []
  syntaxTree(state).iterate({
    from: bodyStart,
    to: state.doc.length,
    enter(node) {
      if (
        node.name === 'FencedCode' ||
        node.name === 'CodeBlock' ||
        node.name === 'InlineCode'
      ) {
        codeRanges.push([node.from, node.to])
        return false
      }
    },
  })

  const bodyText = state.doc.sliceString(bodyStart, state.doc.length)
  const matches: TagMatch[] = []

  // 注意：不去重——每个出现位置都要装饰。去重（用于建索引）由消费方负责。
  // 否则同一标签在列表里重复出现时，只有第一处会高亮，看起来像「列表中不生效」。
  TAG_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TAG_RE.exec(bodyText)) !== null) {
    const absFrom = bodyStart + m.index + (m[0].length - m[1].length - 1) // position of #
    const absTo = bodyStart + m.index + m[0].length
    const inCode = codeRanges.some(([f, t]) => absFrom >= f && absFrom < t)
    if (inCode) continue
    matches.push({ tag: m[1], from: absFrom, to: absTo })
  }

  return matches
}

export const inlineTagsField = StateField.define<TagMatch[]>({
  create: scanTags,
  update(matches, tr) {
    if (!tr.docChanged) return matches
    const next = scanTags(tr.state)
    if (
      next.length === matches.length &&
      next.every((m, i) => m.tag === matches[i].tag && m.from === matches[i].from)
    ) return matches
    return next
  },
})

function buildDecos(matches: TagMatch[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  // RangeSetBuilder requires ranges sorted by `from`
  const sorted = [...matches].sort((a, b) => a.from - b.from)
  for (const { from, to } of sorted) {
    builder.add(from, to, Decoration.mark({ class: 'cm-hashtag' }))
  }
  return builder.finish()
}

export const inlineTagDecoField = StateField.define<DecorationSet>({
  create(state) {
    return buildDecos(state.field(inlineTagsField))
  },
  update(decos, tr) {
    if (!tr.docChanged) return decos.map(tr.changes)
    return buildDecos(tr.state.field(inlineTagsField))
  },
  provide: f => EditorView.decorations.from(f),
})
