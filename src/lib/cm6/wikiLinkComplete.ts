import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import { vaultStore } from '../../vault'
import type { FileMeta } from '../../stores/types'

const MS_PER_DAY = 86_400_000
// 触发:光标在 [[ 之后,且其后未出现 ] / | / 换行(竖线后留给显示名,不补全)。
const TRIGGER_RE = /\[\[([^\[\]\n|]*)$/

/** mtime 新旧 → boost:最新约 0,越旧越负,夹在 [-99, 0] 让 CM6 前缀评分占主导、mtime 作次级加权。 */
export function recencyBoost(mtime: number, now: number): number {
  return Math.max(-99, Math.min(0, Math.round((mtime - now) / MS_PER_DAY)))
}

/** 选中后插入文本:未闭合则补 ]] ;无论是否补,光标都落在 ]] 之后(相对 from 偏移 label.length + 2)。 */
export function buildWikiInsertion(
  label: string,
  follows: string,
): { insert: string; anchor: number } {
  const insert = follows.startsWith(']]') ? label : `${label}]]`
  return { insert, anchor: label.length + 2 }
}

function makeApply(label: string): Completion['apply'] {
  return (view: EditorView, _c: Completion, from: number, to: number) => {
    const follows = view.state.sliceDoc(to, to + 2)
    const { insert, anchor } = buildWikiInsertion(label, follows)
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + anchor },
    })
  }
}

/** 纯函数:从给定 files 构建候选(文件名 + 别名),boost 由 mtime 决定。过滤交给 CM6 自带模糊。 */
export function wikiLinkCompletionSource(
  ctx: CompletionContext,
  files: Record<string, FileMeta>,
  now: number,
): CompletionResult | null {
  const m = ctx.matchBefore(TRIGGER_RE)
  if (!m) return null
  const from = m.from + 2 // [[ 之后,使过滤文本不含括号
  const options: Completion[] = []
  for (const [path, meta] of Object.entries(files)) {
    if (meta.kind !== 'file' || !path.endsWith('.md')) continue
    const base = path.split('/').pop()!.replace(/\.md$/, '')
    const boost = recencyBoost(meta.mtime, now)
    options.push({ label: base, type: 'text', boost, apply: makeApply(base) })
    for (const alias of meta.aliases ?? []) {
      options.push({ label: alias, detail: base, type: 'text', boost, apply: makeApply(alias) })
    }
  }
  return { from, options, validFor: /^[^\[\]\n|]*$/ }
}

/** 绑定到响应式 vault 的补全源,供编辑器统一 autocompletion 组合使用。 */
export function wikiLinkSource(ctx: CompletionContext): CompletionResult | null {
  return wikiLinkCompletionSource(ctx, vaultStore.files, Date.now())
}
