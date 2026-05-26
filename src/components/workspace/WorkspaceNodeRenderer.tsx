import { Match, Switch } from 'solid-js'
import { ROOT_TABS_ID } from '../../stores/workspaceStore'
import { WorkspaceSplitView } from './WorkspaceSplitView'
import { WorkspaceTabsView } from './WorkspaceTabsView'
import { WorkspaceLeafView } from './WorkspaceLeafView'
import type { WorkspaceNode, WorkspaceSplit, WorkspaceTabs, WorkspaceLeaf } from '../../stores/types'

export function WorkspaceNodeRenderer(props: { node: WorkspaceNode }) {
  return (
    <Switch>
      <Match when={props.node.type === 'split'}>
        <WorkspaceSplitView node={props.node as WorkspaceSplit} />
      </Match>
      <Match when={props.node.type === 'tabs'}>
        <WorkspaceTabsView
          node={props.node as WorkspaceTabs}
          isRoot={(props.node as WorkspaceTabs).id === ROOT_TABS_ID}
        />
      </Match>
      <Match when={props.node.type === 'leaf'}>
        <WorkspaceLeafView
          leaf={props.node as WorkspaceLeaf}
          isActive={true}
        />
      </Match>
    </Switch>
  )
}
