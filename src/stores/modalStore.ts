import { createStore } from 'solid-js/store'

export interface ModalButton {
  label: string
  variant?: 'primary' | 'danger' | 'ghost'
  onClick: () => void
}

interface ModalState {
  open: boolean
  title: string
  message: string
  buttons: ModalButton[]
}

const [modalStore, setModalStore] = createStore<ModalState>({
  open: false,
  title: '',
  message: '',
  buttons: [],
})

export function showModal(opts: Omit<ModalState, 'open'>): void {
  setModalStore({ ...opts, open: true })
}

export function closeModal(): void {
  setModalStore('open', false)
}

export { modalStore }
