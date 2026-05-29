import { createSignal } from 'solid-js'
import type { JSX } from 'solid-js'

export interface RibbonItemDef {
  id: string
  title: string
  getIcon(): JSX.Element
  onClick(): void
  isActive?(): boolean
  position?: 'bottom'  // default: top
}

const [_items, setItems] = createSignal<RibbonItemDef[]>([])

export function registerRibbonItem(def: RibbonItemDef): void {
  setItems(prev => [...prev, def])
}

export function unregisterRibbonItem(id: string): void {
  setItems(prev => prev.filter(d => d.id !== id))
}

export function getRibbonItems(position: 'top' | 'bottom' = 'top'): RibbonItemDef[] {
  return _items().filter(d => (d.position ?? 'top') === position)
}
