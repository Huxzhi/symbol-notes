import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  loadProgress,
  beginLoadProgress,
  endLoadProgress,
  setLoadPhase,
  incDetected,
  incParsed,
  easeCount,
} from '../loadProgress'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('easeCount', () => {
  it('returns the target when already reached', () => {
    expect(easeCount(0, 0)).toBe(0)
    expect(easeCount(5, 5)).toBe(5)
  })
  it('always advances by at least 1 toward the target', () => {
    expect(easeCount(0, 1)).toBe(1)
    expect(easeCount(0, 2)).toBeGreaterThanOrEqual(1)
  })
  it('never overshoots the target', () => {
    expect(easeCount(0, 100)).toBeLessThanOrEqual(100)
  })
  it('clamps down if current somehow exceeds target', () => {
    expect(easeCount(50, 10)).toBe(10)
  })
  it('converges to the target', () => {
    let v = 0
    for (let i = 0; i < 500 && v < 1000; i++) v = easeCount(v, 1000)
    expect(v).toBe(1000)
  })
})

describe('loadProgress', () => {
  it('starts hidden in scanning phase', () => {
    const s = {}
    beginLoadProgress(s)
    expect(loadProgress().visible).toBe(false)
    expect(loadProgress().phase).toBe('scanning')
    endLoadProgress(s)
  })

  it('becomes visible after 300ms', () => {
    const s = {}
    beginLoadProgress(s)
    vi.advanceTimersByTime(299)
    expect(loadProgress().visible).toBe(false)
    vi.advanceTimersByTime(1)
    expect(loadProgress().visible).toBe(true)
    endLoadProgress(s)
  })

  it('never shows when ended before the 300ms delay', () => {
    const s = {}
    beginLoadProgress(s)
    vi.advanceTimersByTime(100)
    endLoadProgress(s)
    vi.advanceTimersByTime(1000)
    expect(loadProgress().visible).toBe(false)
  })

  it('eases the displayed count up toward the raw target across frames', () => {
    const s = {}
    beginLoadProgress(s)
    for (let i = 0; i < 100; i++) incDetected()
    expect(loadProgress().detected).toBe(0) // no frame has run yet
    vi.advanceTimersByTime(16) // one frame
    const after1 = loadProgress().detected
    expect(after1).toBeGreaterThan(0)
    expect(after1).toBeLessThan(100)
    vi.advanceTimersByTime(16 * 80) // many frames
    expect(loadProgress().detected).toBe(100)
    endLoadProgress(s)
  })

  it('snaps to the exact raw totals on end', () => {
    const s = {}
    beginLoadProgress(s)
    incDetected()
    incParsed()
    incParsed()
    endLoadProgress(s)
    expect(loadProgress().detected).toBe(1)
    expect(loadProgress().parsed).toBe(2)
    expect(loadProgress().visible).toBe(false)
    expect(loadProgress().phase).toBe('done')
  })

  it('updates phase only for the current session', () => {
    const s1 = {}
    beginLoadProgress(s1)
    setLoadPhase(s1, 'parsing')
    expect(loadProgress().phase).toBe('parsing')
    endLoadProgress(s1)
  })

  it('ignores end / phase from a superseded session', () => {
    const s1 = {}
    const s2 = {}
    beginLoadProgress(s1)
    beginLoadProgress(s2) // s2 now current
    vi.advanceTimersByTime(300)
    expect(loadProgress().visible).toBe(true)
    endLoadProgress(s1) // stale → ignored
    expect(loadProgress().visible).toBe(true)
    setLoadPhase(s1, 'done') // stale → ignored
    expect(loadProgress().phase).toBe('scanning')
    endLoadProgress(s2)
  })
})
