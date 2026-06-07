import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  loadProgress,
  beginLoadProgress,
  endLoadProgress,
  setLoadPhase,
  incDetected,
  incParsed,
} from '../loadProgress'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

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

  it('samples raw counters into the snapshot every 500ms', () => {
    const s = {}
    beginLoadProgress(s)
    incDetected()
    incDetected()
    incParsed()
    expect(loadProgress().detected).toBe(0) // not yet sampled
    vi.advanceTimersByTime(500)
    expect(loadProgress().detected).toBe(2)
    expect(loadProgress().parsed).toBe(1)
    endLoadProgress(s)
  })

  it('does a final sample and hides on end', () => {
    const s = {}
    beginLoadProgress(s)
    incDetected()
    endLoadProgress(s)
    expect(loadProgress().detected).toBe(1)
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
