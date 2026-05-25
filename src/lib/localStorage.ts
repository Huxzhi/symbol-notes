import { createEffect } from 'solid-js'

export function loadFromStorage<T>(
  key: string,
  fallback: T,
  validate?: (v: unknown) => boolean,
): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed = JSON.parse(raw) as unknown
    if (validate && !validate(parsed)) return fallback
    return parsed as T
  } catch {
    return fallback
  }
}

export function saveToStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch { /* quota exceeded */ }
}

export function syncToStorage<T>(key: string, getSlice: () => T): void {
  createEffect(() => saveToStorage(key, getSlice()))
}
