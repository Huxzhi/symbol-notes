import { For } from 'solid-js'
import { activeRoot } from '../../stores/globalStore'
import { WorkspaceNodeRenderer } from './WorkspaceNodeRenderer'

export function SidebarRenderer(props: { side: 'left' | 'right' }) {
  const sidebar = () => activeRoot()[props.side]

  return (
    <div
      class={`transition-all duration-200 overflow-hidden shrink-0 h-full bg-[var(--bg-surface)] flex flex-col
        ${props.side === 'left' ? 'border-r' : 'border-l'} border-[var(--border)]`}
      style={{ width: sidebar().collapsed ? '0px' : `${sidebar().width}px` }}
    >
      <For each={sidebar().children}>
        {(node) => (
          <div class="flex-1 min-h-0 overflow-hidden">
            <WorkspaceNodeRenderer node={node} />
          </div>
        )}
      </For>
    </div>
  )
}
