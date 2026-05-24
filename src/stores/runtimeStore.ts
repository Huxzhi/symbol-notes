import { createStore } from 'solid-js/store'
import type { RuntimeState } from './types'

const [runtimeStore, setRuntimeStore] = createStore<RuntimeState>({
  rootHandle: null,
  leafInstances: {},
})

export { runtimeStore, setRuntimeStore }
