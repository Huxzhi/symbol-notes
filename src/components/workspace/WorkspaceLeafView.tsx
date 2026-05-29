import { Dynamic } from 'solid-js/web'
import { ErrorBoundary, onMount, onCleanup } from 'solid-js'
import { getView } from '../../lib/pluginRegistry'
import type { PanelViewDef } from '../../lib/pluginRegistry'
import type { WorkspaceLeaf } from '../../stores/types'

export function WorkspaceLeafView(props: { leaf: WorkspaceLeaf; isActive: boolean }) {
  const def = () => getView(props.leaf.viewState.type)
  const panelDef = () => def()?.kind === 'panel' ? def() as PanelViewDef : undefined

  onMount(() => panelDef()?.onLeafOpen?.(props.leaf.id))
  onCleanup(() => panelDef()?.onLeafClose?.(props.leaf.id))

  return (
    <ErrorBoundary fallback={(err) => (
      <div class="p-4 text-[11px] text-red-400 flex flex-col gap-1">
        <div class="font-medium">插件渲染失败</div>
        <div class="text-(--text-4) font-mono break-all">{String(err)}</div>
      </div>
    )}>
      <Dynamic
        component={def()?.component}
        leafId={props.leaf.id}
        isActive={props.isActive}
        viewState={props.leaf.viewState.state}
      />
    </ErrorBoundary>
  )
}
