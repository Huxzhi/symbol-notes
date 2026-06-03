import { createStore } from 'solid-js/store'

interface ConflictState {
  open: boolean
  filename: string
  editorContent: string
  diskContent: string
  onChoice: (choice: 'overwrite' | 'reload' | 'cancel') => void
}

const [conflictStore, setConflictStore] = createStore<ConflictState>({
  open: false,
  filename: '',
  editorContent: '',
  diskContent: '',
  onChoice: () => {},
})

export function showConflict(opts: Omit<ConflictState, 'open'>): void {
  setConflictStore({ ...opts, open: true })
}

export function closeConflict(): void {
  setConflictStore('open', false)
}

export { conflictStore }
