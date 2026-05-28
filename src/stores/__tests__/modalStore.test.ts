import { describe, it, expect, beforeEach } from 'vitest'
import { showModal, closeModal, modalStore } from '../modalStore'

beforeEach(() => closeModal())

describe('modalStore', () => {
  it('starts closed', () => {
    expect(modalStore.open).toBe(false)
  })

  it('showModal opens with correct fields', () => {
    showModal({ title: '标题', message: '消息', buttons: [] })
    expect(modalStore.open).toBe(true)
    expect(modalStore.title).toBe('标题')
    expect(modalStore.message).toBe('消息')
    expect(modalStore.buttons).toEqual([])
  })

  it('closeModal sets open to false', () => {
    showModal({ title: 'T', message: 'M', buttons: [] })
    closeModal()
    expect(modalStore.open).toBe(false)
  })

  it('showModal replaces previous modal', () => {
    showModal({ title: 'First', message: 'A', buttons: [] })
    showModal({ title: 'Second', message: 'B', buttons: [] })
    expect(modalStore.title).toBe('Second')
    expect(modalStore.open).toBe(true)
  })
})
