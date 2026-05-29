import { createStore } from 'solid-js/store'

export type ToastLevel = 'info' | 'error' | 'warn'

export interface Toast {
  id: number
  msg: string
  level: ToastLevel
  requireClick: boolean
  duration: number
}

const [toastStore, setToastStore] = createStore<{ items: Toast[] }>({ items: [] })
let _id = 0

export function showToast(
  msg: string,
  opts?: { level?: ToastLevel; requireClick?: boolean; duration?: number },
): void {
  const id = _id++
  const item: Toast = {
    id,
    msg,
    level: opts?.level ?? 'info',
    requireClick: opts?.requireClick ?? false,
    duration: opts?.duration ?? 3000,
  }
  setToastStore('items', (prev) => [...prev, item])
  if (!item.requireClick) {
    setTimeout(() => dismissToast(id), item.duration)
  }
}

export function showError(
  msg: string,
  opts?: { requireClick?: boolean; duration?: number },
): void {
  showToast(msg, { ...opts, level: 'error' })
}

export function showWarn(
  msg: string,
  opts?: { requireClick?: boolean; duration?: number },
): void {
  showToast(msg, { ...opts, level: 'warn' })
}

export function dismissToast(id: number): void {
  setToastStore('items', (prev) => prev.filter((t) => t.id !== id))
}

export { toastStore }
