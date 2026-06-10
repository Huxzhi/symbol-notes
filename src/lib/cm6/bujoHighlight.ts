import { RangeSetBuilder } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { listsField } from './listsField'
import type { ListItem } from '../../stores/types'

/** 渲染插件自有的语义映射：signifier → 整行背景 class。解析层不涉及含义。 */
export const SIGNIFIER_CLASS: Record<string, string> = {
  '-': 'cm-bujo-event',
  '=': 'cm-bujo-mood',
  '~': 'cm-bujo-idea',
  '!': 'cm-bujo-important',
  '&': 'cm-bujo-attention',
}

/** 纯函数：列表项 → (0-based 行号 → class)，只收 signifier 命中映射表的项。 */
export function buildLineClassMap(items: ListItem[]): Map<number, string> {
  const map = new Map<number, string>()
  for (const it of items) {
    const cls = it.signifier ? SIGNIFIER_CLASS[it.signifier] : undefined
    if (cls) map.set(it.line, cls)
  }
  return map
}

function buildBujoDecos(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const byLine = buildLineClassMap(view.state.field(listsField))
  if (byLine.size === 0) return builder.finish()
  for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos)
      const cls = byLine.get(line.number - 1)
      if (cls) builder.add(line.from, line.from, Decoration.line({ class: cls }))
      pos = line.to + 1
    }
  }
  return builder.finish()
}

export const bujoHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildBujoDecos(view)
    }
    update(update: ViewUpdate) {
      // signifier 仅随文档变化；不依赖光标，故不监听 selectionSet
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildBujoDecos(update.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)
