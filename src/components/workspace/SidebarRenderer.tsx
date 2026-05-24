import { For } from 'solid-js'
import { WorkspaceNodeRenderer } from './WorkspaceNodeRenderer'

export function SidebarRenderer(props: { node: any }) {
  const sidebar = () => props.node

  return (
    <div
      class={`transition-all duration-200 overflow-hidden shrink-0 h-full bg-(--bg-surface) flex flex-col
        border-(--border)`}
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
