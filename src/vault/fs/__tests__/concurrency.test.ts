import { describe, it, expect } from 'vitest'
import { mapWithConcurrency } from '../concurrency'

describe('mapWithConcurrency', () => {
  it('preserves order of results', async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => n * 10)
    expect(out).toEqual([10, 20, 30, 40])
  })

  it('never exceeds the concurrency limit', async () => {
    let active = 0, peak = 0
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      active++; peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
    })
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('handles empty input', async () => {
    expect(await mapWithConcurrency([], 4, async (x) => x)).toEqual([])
  })

  it('propagates errors', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => { if (n === 2) throw new Error('boom'); return n }),
    ).rejects.toThrow('boom')
  })
})
