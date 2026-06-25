import { describe, it, expect, beforeEach } from 'vitest'
import { ui, modalState, toastState } from '../../stores/ui'

describe('ui.confirm (modal)', () => {
  beforeEach(() => ui.closeConfirm())

  it('starts closed', () => {
    expect(modalState.open).toBe(false)
  })

  it('opens with correct fields', () => {
    ui.confirm({ title: '标题', message: '消息', buttons: [] })
    expect(modalState.open).toBe(true)
    expect(modalState.title).toBe('标题')
    expect(modalState.message).toBe('消息')
    expect(modalState.buttons).toEqual([])
  })

  it('closeConfirm sets open to false', () => {
    ui.confirm({ title: 'T', message: 'M', buttons: [] })
    ui.closeConfirm()
    expect(modalState.open).toBe(false)
  })

  it('replaces previous modal', () => {
    ui.confirm({ title: 'First', message: 'A', buttons: [] })
    ui.confirm({ title: 'Second', message: 'B', buttons: [] })
    expect(modalState.title).toBe('Second')
    expect(modalState.open).toBe(true)
  })
})

describe('ui.toast', () => {
  it('returns an incrementing id and adds the item', () => {
    const id1 = ui.toast('a', { requireClick: true })
    const id2 = ui.toast('b', { requireClick: true })
    expect(typeof id1).toBe('number')
    expect(id2).toBeGreaterThan(id1)
    expect(toastState.items.find((t) => t.id === id1)?.msg).toBe('a')
    ui.dismissToast(id1)
    ui.dismissToast(id2)
  })

  it('updateToast changes the message of an existing toast', () => {
    const id = ui.toast('parsing 0', { requireClick: true })
    ui.updateToast(id, 'parsing 5')
    expect(toastState.items.find((t) => t.id === id)?.msg).toBe('parsing 5')
    ui.dismissToast(id)
  })

  it('updateToast is a no-op for an unknown id', () => {
    expect(() => ui.updateToast(99999, 'x')).not.toThrow()
  })
})
