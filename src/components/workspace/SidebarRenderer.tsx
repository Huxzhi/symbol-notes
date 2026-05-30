import { createSignal, For } from 'solid-js'
import { workspaceActions } from '../../stores/workspaceStore'
import { WorkspaceNodeRenderer } from './WorkspaceNodeRenderer'

export function SidebarRenderer(props: { node: any; side: 'left' | 'right' }) {
  const sidebar = () => props.node
  const [isDragging, setIsDragging] = createSignal(false)

  let startX = 0
  let initWidth = 0

  function onPointerDown(e: PointerEvent) {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    startX = e.clientX
    initWidth = sidebar().width
    setIsDragging(true)
  }

  function onPointerMove(e: PointerEvent) {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return
    const delta = e.clientX - startX
    const newWidth = props.side === 'left' ? initWidth + delta : initWidth - delta
    if (newWidth < 50) {
      workspaceActions.toggleSidebar(props.side)
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      setIsDragging(false)
      return
    }
    workspaceActions.setSidebarWidth(props.side, Math.min(newWidth, 800))
  }

  function onPointerUp(e: PointerEvent) {
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    setIsDragging(false)
  }

  const handle = (
    <div
      class="w-1 shrink-0 cursor-col-resize self-stretch flex items-stretch justify-center group"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div class="w-0.5 bg-(--border) group-hover:bg-(--accent) transition-colors" />
    </div>
  )

  return (
    <div
      class={`overflow-hidden shrink-0 h-full bg-(--bg-surface) flex border-(--border)
        ${isDragging() ? '' : 'transition-[width] duration-200'}`}
      style={{ width: sidebar().collapsed ? '0px' : `${sidebar().width}px` }}
    >
      {props.side === 'right' && handle}
      <div class="flex-1 flex flex-col overflow-hidden min-h-0 min-w-0">
        <For each={sidebar().children}>
          {(node) => (
            <div class="flex-1 min-h-0 overflow-hidden">
              <WorkspaceNodeRenderer node={node} area={props.side} />
            </div>
          )}
        </For>
      </div>
      {props.side === 'left' && handle}
    </div>
  )
}
