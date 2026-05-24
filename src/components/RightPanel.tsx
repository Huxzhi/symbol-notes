import { createMemo, For } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { globalStore } from '../stores/globalStore'
import { workspaceActions } from '../actions/workspaceActions'
import { getPanelViews } from '../lib/viewRegistry'

export function RightPanel() {
  const panels = getPanelViews()
  const activePanel = createMemo(() =>
    panels.find(p => p.type === globalStore.workspace.rightPanelView),
  )

  return (
    <div class="w-50 h-full bg-[var(--bg-surface)] border-l border-[var(--border)] flex flex-col shrink-0">
      <div class="flex border-b border-[var(--border)] shrink-0">
        <For each={panels}>
          {(panel) => (
            <button
              class={`flex-1 py-1.5 text-[10px] cursor-pointer transition-colors
                ${globalStore.workspace.rightPanelView === panel.type
                  ? 'text-[var(--accent)] border-b-2 border-[var(--accent)] -mb-px'
                  : 'text-[var(--text-3)] hover:text-[var(--text-2)]'}`}
              onClick={() => workspaceActions.setRightPanelView(panel.type)}
            >
              {panel.getDisplayText()}
            </button>
          )}
        </For>
      </div>
      <div class="flex-1 overflow-y-auto min-h-0">
        <Dynamic component={activePanel()?.component} />
      </div>
    </div>
  )
}
