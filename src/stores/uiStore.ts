import { createStore } from 'solid-js/store'

interface UIState {
  showLeft: boolean
  showRight: boolean
}

const [uiStore, setUIStore] = createStore<UIState>({
  showLeft: true,
  showRight: true,
})

export { uiStore, setUIStore }
