import { createSignal } from 'solid-js'

export interface TabDragState {
  leafId: string
  sourceTabsId: string
  sourceArea: 'left' | 'main' | 'right'
}

const [dragState, setDragState] = createSignal<TabDragState | null>(null)

export { dragState, setDragState }

export function isDraggingMainTab(): boolean {
  return dragState()?.sourceArea === 'main'
}
