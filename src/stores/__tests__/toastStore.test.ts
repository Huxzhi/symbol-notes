import { describe, it, expect } from 'vitest'
import { showToast, updateToast, dismissToast, toastStore } from '../toastStore'

describe('toastStore', () => {
  it('showToast returns an incrementing id and adds the item', () => {
    const id1 = showToast('a', { requireClick: true })
    const id2 = showToast('b', { requireClick: true })
    expect(typeof id1).toBe('number')
    expect(id2).toBeGreaterThan(id1)
    expect(toastStore.items.find((t) => t.id === id1)?.msg).toBe('a')
    dismissToast(id1); dismissToast(id2)
  })

  it('updateToast changes the message of an existing toast', () => {
    const id = showToast('parsing 0', { requireClick: true })
    updateToast(id, 'parsing 5')
    expect(toastStore.items.find((t) => t.id === id)?.msg).toBe('parsing 5')
    dismissToast(id)
  })

  it('updateToast is a no-op for an unknown id', () => {
    expect(() => updateToast(99999, 'x')).not.toThrow()
  })
})
