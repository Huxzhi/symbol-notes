import { Dynamic } from 'solid-js/web'
import { getView } from '../../lib/viewRegistry'
import type { WorkspaceLeaf } from '../../stores/types'

export function WorkspaceLeafView(props: { leaf: WorkspaceLeaf; isActive: boolean }) {
  const def = () => getView(props.leaf.viewState.type)
  return (
    <Dynamic
      component={def()?.component}
      leafId={props.leaf.id}
      isActive={props.isActive}
      viewState={props.leaf.viewState.state}
    />
  )
}
