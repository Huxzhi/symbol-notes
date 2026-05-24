import { createMemo, For } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { globalStore } from '../../stores/globalStore'
import { workspaceActions } from '../../actions/workspaceActions'
import { getLeftPanelViews, getRightPanelViews } from '../../lib/viewRegistry'

function LeftContent() {
  const panels = getLeftPanelViews()
  const activePanel = createMemo(() =>
    panels.find(p => p.type === globalStore.workspace.leftPanelView),
  )
  return <Dynamic component={activePanel()?.component} />
}

function RightContent() {
  const panels = getRightPanelViews()
  const activePanel = createMemo(() =>
    panels.find(p => p.type === globalStore.workspace.rightPanelView),
  )
  return (
    <div class="flex flex-col h-full">
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

export function SidebarRenderer(props: { side: 'left' | 'right' }) {
  const sidebar = () => globalStore.workspace[props.side]

  return (
    <div
      class={`transition-all duration-200 overflow-hidden shrink-0 h-full bg-[var(--bg-surface)]
        ${props.side === 'left' ? 'border-r' : 'border-l'} border-[var(--border)]`}
      style={{ width: sidebar().collapsed ? '0px' : `${sidebar().width}px` }}
    >
      {props.side === 'left' ? <LeftContent /> : <RightContent />}
    </div>
  )
}
