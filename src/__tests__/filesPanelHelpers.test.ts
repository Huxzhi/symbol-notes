import { describe, it, expect } from 'vitest'

import { toggleInArray } from '../lib/arrayUtils'

describe('toggleInArray', () => {
  it('adds path when not present', () => {
    expect(toggleInArray(['a', 'b'], 'c')).toEqual(['a', 'b', 'c'])
  })
  it('removes path when already present', () => {
    expect(toggleInArray(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
  })
  it('handles empty array', () => {
    expect(toggleInArray([], 'x')).toEqual(['x'])
  })
})
