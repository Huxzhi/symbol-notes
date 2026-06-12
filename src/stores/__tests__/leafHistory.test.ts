import { describe, it, expect } from 'vitest'
import { pushHistory } from '../leafHistory'

describe('pushHistory', () => {
  it('seeds an empty history with prevFile before appending', () => {
    expect(pushHistory([], -1, 'b', 'a')).toEqual({ history: ['a', 'b'], index: 1 })
  })

  it('appends to an empty history with no prevFile', () => {
    expect(pushHistory([], -1, 'a')).toEqual({ history: ['a'], index: 0 })
  })

  it('does not duplicate the current entry', () => {
    expect(pushHistory(['a'], 0, 'a')).toEqual({ history: ['a'], index: 0 })
  })

  it('appends a new entry at the end', () => {
    expect(pushHistory(['a'], 0, 'b')).toEqual({ history: ['a', 'b'], index: 1 })
  })

  it('truncates forward entries when branching from the middle', () => {
    // at index 0 of [a,b,c], opening x discards b,c
    expect(pushHistory(['a', 'b', 'c'], 0, 'x')).toEqual({ history: ['a', 'x'], index: 1 })
  })
})
