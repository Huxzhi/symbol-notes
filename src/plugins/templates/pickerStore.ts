import { createSignal } from 'solid-js'

export type PickerMode = 'create' | 'insert'

export interface PickerResult {
  templatePath: string
  /** Only present in 'create' mode: the new note name (without extension). */
  name?: string
}

interface PickerState {
  mode: PickerMode
  resolve: (result: PickerResult | null) => void
}

const [pickerState, setPickerState] = createSignal<PickerState | null>(null)

export { pickerState }

export function openTemplatePicker(mode: PickerMode): Promise<PickerResult | null> {
  // Cancel any in-flight picker first.
  const existing = pickerState()
  if (existing) existing.resolve(null)
  return new Promise((resolve) => setPickerState({ mode, resolve }))
}

export function resolveTemplatePicker(result: PickerResult | null): void {
  const state = pickerState()
  if (state) state.resolve(result)
  setPickerState(null)
}
