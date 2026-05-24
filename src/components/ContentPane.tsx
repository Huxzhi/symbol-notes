import { For } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { uiStore } from '../stores/uiStore'
import { getView } from '../lib/viewRegistry'

export function ContentPane() {
  return (
    <div class="flex-1 relative overflow-hidden">
      <For each={uiStore.tabOrder}>
        {(tabId) => {
          const tab = () => uiStore.tabs[tabId]
          const def = () => (tab() ? getView(tab().type) : undefined)
          const isActive = () => uiStore.activeTabId === tabId
          return (
            <div
              class="absolute inset-0 flex flex-col overflow-hidden"
              style={{ display: isActive() ? 'flex' : 'none' }}
            >
              <Dynamic
                component={def()?.component}
                tabId={tabId}
                isActive={isActive()}
              />
            </div>
          )
        }}
      </For>
    </div>
  )
}
