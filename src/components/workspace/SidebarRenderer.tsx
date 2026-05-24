import type { JSX } from 'solid-js'
import type { SidebarSplit } from '../../stores/types'

export function SidebarRenderer(props: {
  sidebar: SidebarSplit
  children: JSX.Element
}) {
  return (
    <div
      class="transition-all duration-200 overflow-hidden shrink-0"
      style={{ width: props.sidebar.collapsed ? '0px' : `${props.sidebar.width}px` }}
    >
      {props.children}
    </div>
  )
}
