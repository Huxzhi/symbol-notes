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
} from '../../../lib/cm6/wikiLinkComplete'

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

describe('wikiLinkCompletionSource duplicate filenames', () => {
  const dupFiles: Record<string, FileMeta> = {
    'work/Todo.md': file('work/Todo.md', NOW),
    'personal/Todo.md': file('personal/Todo.md', NOW),
    'notes/Plan.md': file('notes/Plan.md', NOW),
  }

  it('labels same-named files with their ext-less full path, unique stays bare', () => {
    const res = wikiLinkCompletionSource(ctxAt('[[', 2), dupFiles, NOW)!
    const labels = res.options.map((o) => o.label).sort()
    expect(labels).toEqual(['Plan', 'personal/Todo', 'work/Todo'])
  })

  it('keeps a unique filename as bare base', () => {
    const res = wikiLinkCompletionSource(ctxAt('[[', 2), dupFiles, NOW)!
    expect(res.options.find((o) => o.label === 'Plan')).toBeDefined()
    expect(res.options.find((o) => o.label === 'notes/Plan')).toBeUndefined()
  })

  it('inserts the full path so it resolves to the right file', () => {
    const res = wikiLinkCompletionSource(ctxAt('[[', 2), dupFiles, NOW)!
    const opt = res.options.find((o) => o.label === 'work/Todo')!
    const state = EditorState.create({ doc: '[[' })
    let inserted = ''
    const view = {
      state,
      dispatch: (tr: { changes: { insert: string } }) => {
        inserted = tr.changes.insert
      },
    }
    ;(opt.apply as (v: unknown, c: unknown, from: number, to: number) => void)(
      view, opt, 2, 2,
    )
    expect(inserted).toBe('work/Todo]]')
  })
})
