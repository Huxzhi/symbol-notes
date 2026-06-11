import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { CompletionContext } from '@codemirror/autocomplete'
import type { FileMeta } from '../../../stores/types'
import {
  wikiLinkCompletionSource,
  recencyBoost,
  buildWikiInsertion,
} from '../wikiLinkComplete'

function ctxAt(doc: string, pos: number) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: [GFM] })],
  })
  return new CompletionContext(state, pos, true)
}

function file(path: string, mtime: number, aliases: string[] = []): FileMeta {
  return {
    name: path.split('/').pop()!, path, kind: 'file', parent: null,
    size: 0, mtime, hash: '', frontmatter: {}, outLinks: [], etags: [],
    tags: [], aliases, created: '', updated: null, dated: '', lists: [],
  }
}

const NOW = 1_000 * 86_400_000 // 任意基准(单位 ms)
const files: Record<string, FileMeta> = {
  'notes/Todo.md': file('notes/Todo.md', NOW, ['待办']),
  'work/Plan.md': file('work/Plan.md', NOW - 10 * 86_400_000),
  'image.png': file('image.png', NOW),       // 非 md,应跳过
}

describe('recencyBoost', () => {
  it('newest → 0, older → negative, clamped at -99', () => {
    expect(recencyBoost(NOW, NOW)).toBe(0)
    expect(recencyBoost(NOW - 10 * 86_400_000, NOW)).toBe(-10)
    expect(recencyBoost(NOW - 500 * 86_400_000, NOW)).toBe(-99)
  })
})

describe('buildWikiInsertion', () => {
  it('appends ]] and anchors after it when not already closed', () => {
    expect(buildWikiInsertion('Note', '')).toEqual({ insert: 'Note]]', anchor: 6 })
  })
  it('skips appending when ]] already follows, anchor past existing ]]', () => {
    expect(buildWikiInsertion('Note', ']]')).toEqual({ insert: 'Note', anchor: 6 })
  })
})

describe('wikiLinkCompletionSource', () => {
  it('triggers after [[ and lists filenames + aliases, skipping non-md', () => {
    const doc = '[['
    const res = wikiLinkCompletionSource(ctxAt(doc, doc.length), files, NOW)
    expect(res).not.toBeNull()
    expect(res!.from).toBe(2) // 落在 [[ 之后
    const labels = res!.options.map((o) => o.label).sort()
    expect(labels).toEqual(['Plan', 'Todo', '待办'])
  })

  it('alias option carries filename as detail', () => {
    const res = wikiLinkCompletionSource(ctxAt('[[', 2), files, NOW)!
    const alias = res.options.find((o) => o.label === '待办')!
    expect(alias.detail).toBe('Todo')
  })

  it('boosts more-recently-modified files higher', () => {
    const res = wikiLinkCompletionSource(ctxAt('[[', 2), files, NOW)!
    const todo = res.options.find((o) => o.label === 'Todo')!
    const plan = res.options.find((o) => o.label === 'Plan')!
    expect(todo.boost!).toBeGreaterThan(plan.boost!)
  })

  it('keeps from after [[ when a prefix is typed', () => {
    const doc = 'text [[To'
    const res = wikiLinkCompletionSource(ctxAt(doc, doc.length), files, NOW)!
    expect(res.from).toBe(doc.indexOf('[[') + 2)
  })

  it('does not trigger after the pipe (display-name part)', () => {
    expect(wikiLinkCompletionSource(ctxAt('[[Todo|', 7), files, NOW)).toBeNull()
  })

  it('does not trigger on a single [', () => {
    expect(wikiLinkCompletionSource(ctxAt('[', 1), files, NOW)).toBeNull()
  })
})
