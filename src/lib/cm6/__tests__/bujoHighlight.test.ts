import { describe, it, expect } from 'vitest'
import { SIGNIFIER_CLASS, buildLineClassMap } from '../bujoHighlight'
import type { ListItem } from '../../../stores/types'

function item(over: Partial<ListItem>): ListItem {
  return {
    text: '', visual: '', line: 0, lineCount: 1, symbol: '-',
    signifier: null, status: null, checked: false, task: false,
    fields: {}, tags: [], ...over,
  }
}

describe('SIGNIFIER_CLASS', () => {
  it('maps the five BuJo signifiers to classes', () => {
    expect(SIGNIFIER_CLASS).toEqual({
      '-': 'cm-bujo-event',
      '=': 'cm-bujo-mood',
      '~': 'cm-bujo-idea',
      '!': 'cm-bujo-important',
      '&': 'cm-bujo-attention',
    })
  })
})

describe('buildLineClassMap', () => {
  it('maps a line to its signifier class', () => {
    const m = buildLineClassMap([item({ line: 2, signifier: '-' })])
    expect(m.get(2)).toBe('cm-bujo-event')
  })

  it('maps each known signifier', () => {
    const m = buildLineClassMap([
      item({ line: 0, signifier: '=' }),
      item({ line: 1, signifier: '~' }),
      item({ line: 2, signifier: '!' }),
      item({ line: 3, signifier: '&' }),
    ])
    expect(m.get(0)).toBe('cm-bujo-mood')
    expect(m.get(1)).toBe('cm-bujo-idea')
    expect(m.get(2)).toBe('cm-bujo-important')
    expect(m.get(3)).toBe('cm-bujo-attention')
  })

  it('skips plain lists, tasks, and unknown signifiers', () => {
    const m = buildLineClassMap([
      item({ line: 0, signifier: null }),               // 普通列表
      item({ line: 1, signifier: null, status: ' ', task: true }), // 任务
      item({ line: 2, signifier: '*' }),                // 不在表内
    ])
    expect(m.size).toBe(0)
  })
})
