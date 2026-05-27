import { describe, it, expect } from 'vitest'
import { computeWikiLink, isValidMoveDrop } from '../lib/dragDropHelpers'

describe('computeWikiLink', () => {
  it('strips .md extension for markdown files', () => {
    expect(computeWikiLink('note.md', 'file')).toBe('[[note]]')
  })
  it('uses ![[]] for image files', () => {
    expect(computeWikiLink('photo.png', 'file')).toBe('![[photo.png]]')
  })
  it('uses ![[]] for all image extensions', () => {
    expect(computeWikiLink('a.jpg', 'file')).toBe('![[a.jpg]]')
    expect(computeWikiLink('b.webp', 'file')).toBe('![[b.webp]]')
    expect(computeWikiLink('c.svg', 'file')).toBe('![[c.svg]]')
  })
  it('uses [[]] for other file types', () => {
    expect(computeWikiLink('data.csv', 'file')).toBe('[[data.csv]]')
  })
  it('uses [[]] for directories', () => {
    expect(computeWikiLink('projects', 'directory')).toBe('[[projects]]')
  })
})

describe('isValidMoveDrop', () => {
  it('rejects drop onto current parent (no-op)', () => {
    expect(isValidMoveDrop('a/note.md', 'a', 'a')).toBe(false)
  })
  it('rejects drop onto self (folder → itself)', () => {
    expect(isValidMoveDrop('a/b', 'a/b', 'a')).toBe(false)
  })
  it('rejects drop into own descendant', () => {
    expect(isValidMoveDrop('a', 'a/b', null)).toBe(false)
    expect(isValidMoveDrop('a', 'a/b/c', null)).toBe(false)
  })
  it('rejects root-level file dropped back to root', () => {
    expect(isValidMoveDrop('note.md', null, null)).toBe(false)
  })
  it('accepts drop into a sibling folder', () => {
    expect(isValidMoveDrop('a/note.md', 'b', 'a')).toBe(true)
  })
  it('accepts drop to root from nested folder', () => {
    expect(isValidMoveDrop('a/note.md', null, 'a')).toBe(true)
  })
  it('accepts drop into a nested folder', () => {
    expect(isValidMoveDrop('note.md', 'a/b', null)).toBe(true)
  })
})
