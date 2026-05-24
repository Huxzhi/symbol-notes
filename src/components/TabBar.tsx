import { For } from 'solid-js'
import { PanelRight } from 'lucide-solid'
import { uiStore, setUIStore } from '../stores/uiStore'
import { closeTab, setActiveTab, pinTab } from '../services/workspaceService'
import { getView } from '../lib/viewRegistry'

export function TabBar() {
  return (
    <div class="h-8 bg-[var(--bg-base)] border-b border-[var(--border)] flex items-stretch shrink-0 overflow-y-hidden">
      <div class="flex flex-1 overflow-x-auto overflow-y-hidden">
        <For each={uiStore.tabOrder}>
          {(tabId) => {
            const tab = () => uiStore.tabs[tabId]
            const def = () => (tab() ? getView(tab().type) : undefined)
            const isActive = () => uiStore.activeTabId === tabId
            const label = () => {
              const d = def()
              if (!d) return tabId
              return d.kind === 'file'
                ? d.getDisplayText(tab().path!)
                : d.getDisplayText()
            }
            const isPinned = () => tab()?.pinned ?? false

            return (
              <div
                class={`flex items-center gap-1.5 px-3 border-r border-[var(--border)] cursor-pointer text-[11px] shrink-0
                  ${
                    isActive()
                      ? 'bg-[var(--bg-base)] text-[var(--text)] border-b-2 border-b-[var(--accent)] -mb-px'
                      : 'text-[var(--text-3)] hover:bg-[var(--bg-hover)]'
                  }`}
                onClick={() => setActiveTab(tabId)}
                onDblClick={() => pinTab(tabId)}
              >
                {def()?.getIcon?.()}
                <span
                  class={`max-w-[120px] truncate ${!isPinned() && tab()?.path ? 'italic' : ''}`}
                >
                  {label()}
                </span>
                <button
                  class="text-[var(--text-4)] hover:text-[var(--text-2)] text-[13px] leading-none ml-0.5"
                  onClick={e => {
                    e.stopPropagation()
                    closeTab(tabId)
                  }}
                >
                  ×
                </button>
              </div>
            )
          }}
        </For>
      </div>
      <button
        class="px-2 shrink-0 text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--bg-hover)] flex items-center transition-colors"
        onClick={() => setUIStore('showRight', v => !v)}
        title="切换右侧栏"
      >
        <PanelRight size={15} />
      </button>
    </div>
  )
}
