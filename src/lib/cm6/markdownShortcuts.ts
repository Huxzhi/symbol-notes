import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state'
import { keymap, type Command } from '@codemirror/view'
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands'

/**
 * 切换包裹标记(加粗 `**` / 斜体 `*`),纯函数,对每个选区分别处理:
 *  - 空选区:插入 `marker+marker`,光标落中间;
 *  - 选区内部已被 marker 包裹 / marker 紧贴选区外侧 → 去掉(取消);
 *  - 否则 → 用 marker 包裹选区。
 * 返回值可直接交给 state.update / view.dispatch。
 */
export function toggleMarker(state: EditorState, marker: string): TransactionSpec {
  const len = marker.length
  return state.changeByRange((range) => {
    const { from, to } = range
    if (from === to) {
      return {
        changes: { from, insert: marker + marker },
        range: EditorSelection.cursor(from + len),
      }
    }
    const selected = state.sliceDoc(from, to)
    // 选区自身包含两侧 marker → 去掉
    if (selected.length >= len * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
      const insert = selected.slice(len, selected.length - len)
      return {
        changes: { from, to, insert },
        range: EditorSelection.range(from, from + insert.length),
      }
    }
    // marker 紧贴在选区外侧 → 去掉外侧
    const before = state.sliceDoc(Math.max(0, from - len), from)
    const after = state.sliceDoc(to, Math.min(state.doc.length, to + len))
    if (before === marker && after === marker) {
      return {
        changes: [
          { from: from - len, to: from },
          { from: to, to: to + len },
        ],
        range: EditorSelection.range(from - len, to - len),
      }
    }
    // 包裹选区
    return {
      changes: [
        { from, insert: marker },
        { from: to, insert: marker },
      ],
      range: EditorSelection.range(from + len, to + len),
    }
  })
}

function toggleCommand(marker: string): Command {
  return (view) => {
    view.dispatch(
      view.state.update(toggleMarker(view.state, marker), {
        scrollIntoView: true,
        userEvent: 'input.toggleMarker',
      }),
    )
    return true
  }
}

export const toggleBold = toggleCommand('**')
export const toggleItalic = toggleCommand('*')

/** 编辑器键位:历史(撤销/重做)+ 标准编辑键 + Markdown 加粗/斜体。 */
export const editorKeymap = [
  history(),
  keymap.of([
    { key: 'Mod-b', run: toggleBold, preventDefault: true },
    { key: 'Mod-i', run: toggleItalic, preventDefault: true },
    ...historyKeymap,
    ...defaultKeymap,
  ]),
]
