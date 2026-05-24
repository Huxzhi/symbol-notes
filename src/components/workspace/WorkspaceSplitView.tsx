import { For } from 'solid-js'
import { WorkspaceNodeRenderer } from './WorkspaceNodeRenderer'
import type { WorkspaceSplit } from '../../stores/types'

export function WorkspaceSplitView(props: { node: WorkspaceSplit }) {
  return (
    <div
      class="flex h-full w-full"
      style={{ 'flex-direction': props.node.direction === 'horizontal' ? 'row' : 'column' }}
    >
      <For each={props.node.children}>
        {(child) => (
          <div class="flex-1 min-w-0 min-h-0 overflow-hidden">
            <WorkspaceNodeRenderer node={child} />
          </div>
        )}
      </For>
    </div>
  )
}
