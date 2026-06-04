import { PanelRight } from 'lucide-solid'
import { For, Show, createMemo, createSignal } from 'solid-js'
import { workspaceActions } from '../../stores/workspaceStore'
import { getView } from '../../lib/pluginRegistry'
import { dragState, setDragState, isDraggingMainTab } from '../../lib/tabDragState'
import type { WorkspaceLeaf, WorkspaceTabs } from '../../stores/types'
import { leafInstances } from '../../stores/workspaceStore'
import { WorkspaceLeafView } from './WorkspaceLeafView'

function getTabLabel(leaf: WorkspaceLeaf): string {
  const def = getView(leaf.viewState.type)
  if (!def) return leaf.viewState.type
  const file = leaf.viewState.state.file as string | undefined
  if (def.kind === 'file' && file) return def.getDisplayText(file)
  if (def.kind === 'page') return def.getDisplayText()
  if (def.kind === 'panel') return def.getDisplayText()
  return leaf.viewState.type
}

export function WorkspaceTabsView(props: {
  node: WorkspaceTabs
  area: 'left' | 'main' | 'right'
  isRoot?: boolean
}) {
  const [insertBeforeId, setInsertBeforeId] = createSignal<string>('__end__')
  const [tabBarOver, setTabBarOver] = createSignal(false)
  const [activeZone, setActiveZone] = createSignal<'left' | 'right' | 'bottom' | null>(null)

  function makeZone(zone: 'left' | 'right' | 'bottom') {
    return (
      <div
        class={`tab-drop-zone tab-drop-zone-${zone}${activeZone() === zone ? ' tab-drop-zone-active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          e.dataTransfer!.dropEffect = 'move'
          setActiveZone(zone)
        }}
        onDragLeave={(e) => {
          if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
            setActiveZone(null)
          }
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setActiveZone(null)
          const state = dragState()
          if (!state || state.sourceArea !== 'main') return
          workspaceActions.moveLeafAsSplit(state.leafId, props.node.id, zone)
          setDragState(null)
        }}
      />
    )
  }

  return (
    <div class="flex flex-col h-full">
      {/* Tab bar */}
      <div class="h-8 bg-(--bg-base) border-b border-(--border)] flex items-stretch shrink-0 overflow-y-hidden">
        <div
          class="flex flex-1 overflow-x-auto overflow-y-hidden relative"
          onDragOver={(e) => {
            const state = dragState()
            if (!state) return
            if (props.area === 'main' && state.sourceArea !== 'main') return
            if (props.area !== 'main' && state.sourceArea === 'main') return
            e.preventDefault()
            e.dataTransfer!.dropEffect = 'move'
            setTabBarOver(true)
            const tabEls = Array.from(
              (e.currentTarget as HTMLElement).querySelectorAll('[data-leaf-id]'),
            ) as HTMLElement[]
            let target = '__end__'
            for (const el of tabEls) {
              const rect = el.getBoundingClientRect()
              if (e.clientX < rect.left + rect.width / 2) {
                target = el.dataset.leafId!
                break
              }
            }
            setInsertBeforeId(target)
          }}
          onDragLeave={(e) => {
            if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
              setTabBarOver(false)
              setInsertBeforeId('__end__')
            }
          }}
          onDrop={(e) => {
            e.preventDefault()
            setTabBarOver(false)
            const state = dragState()
            if (!state) return
            const beforeId = insertBeforeId() === '__end__' ? null : insertBeforeId()
            setInsertBeforeId('__end__')

            if (props.area !== 'main') {
              if (state.sourceArea === props.area) {
                workspaceActions.reorderSidebarLeafInTabs(
                  props.area as 'left' | 'right',
                  props.node.id,
                  state.leafId,
                  beforeId,
                )
              } else if (state.sourceArea !== 'main') {
                workspaceActions.moveSidebarLeaf(
                  state.leafId,
                  state.sourceArea as 'left' | 'right',
                  props.area as 'left' | 'right',
                )
              }
              setDragState(null)
              return
            }

            if (state.sourceTabsId === props.node.id) {
              workspaceActions.reorderLeafInTabs(props.node.id, state.leafId, beforeId)
            } else {
              workspaceActions.moveLeafToTabs(state.leafId, props.node.id, beforeId)
            }
            setDragState(null)
          }}
        >
          <For each={props.node.children}>
            {(leaf) => {
              const isActive = createMemo(() => leaf.id === props.node.activeLeafId)
              const isPinned = () => leaf.pinned
              const def = () => getView(leaf.viewState.type)
              const isPanelLeaf = () => def()?.kind === 'panel'
              const isDraggable = () => !isPanelLeaf() || props.area !== 'main'
              const isBeingDragged = () => dragState()?.leafId === leaf.id
              const showCursorBefore = () => tabBarOver() && insertBeforeId() === leaf.id
              const isDirty = () => leafInstances[leaf.id]?.isDirty ?? false

              return (
                <>
                  <Show when={showCursorBefore()}>
                    <div class="tab-insert-cursor" />
                  </Show>
                  <div
                    data-ctx={!isPanelLeaf() ? 'tab' : undefined}
                    data-leaf-id={leaf.id}
                    data-tabs-id={props.node.id}
                    draggable={isDraggable()}
                    onDragStart={(e) => {
                      if (!isDraggable()) return
                      setDragState({ leafId: leaf.id, sourceTabsId: props.node.id, sourceArea: props.area })
                      e.dataTransfer!.effectAllowed = 'move'
                      const ghost = (e.currentTarget as HTMLElement).cloneNode(true) as HTMLElement
                      ghost.style.cssText = 'position:fixed;top:-200px;left:0;opacity:0.8;pointer-events:none;z-index:9999'
                      document.body.appendChild(ghost)
                      e.dataTransfer!.setDragImage(ghost, 16, 12)
                      requestAnimationFrame(() => document.body.removeChild(ghost))
                    }}
                    onDragEnd={() => setDragState(null)}
                    class={`flex items-center gap-1.5 px-3 border-r border-(--border)] cursor-pointer text-[11px] shrink-0
                      ${isActive()
                        ? 'bg-(--bg-base) text-(--text) border-b-2 border-b-(--accent) -mb-px'
                        : 'text-(--text-3) hover:bg-(--bg-hover)'}
                      ${isBeingDragged() ? 'opacity-40' : ''}`}
                    onMouseDown={(e) => {
                      if (e.button === 1) {
                        e.preventDefault()
                        if (!isPanelLeaf()) workspaceActions.closeLeaf(leaf.id)
                      }
                    }}
                    onClick={() => {
                      if (isPanelLeaf()) {
                        workspaceActions.activateSidebarLeafById(leaf.id)
                      } else {
                        workspaceActions.activateLeaf(leaf.id)
                      }
                    }}
                    onDblClick={() => {
                      if (!isPanelLeaf()) workspaceActions.setLeafPinned(leaf.id, true)
                    }}
                  >
                    {def()?.getIcon?.()}
                    <span
                      class={`max-w-30 truncate ${!isPanelLeaf() && !isPinned() && leaf.viewState.state.file ? 'italic' : ''}`}
                    >
                      {getTabLabel(leaf)}
                    </span>
                    {!isPanelLeaf() && (
                      <button
                        class="group/close ml-0.5 w-3.5 h-3.5 flex items-center justify-center rounded-sm shrink-0"
                        onClick={(e) => {
                          e.stopPropagation()
                          workspaceActions.closeLeaf(leaf.id)
                        }}
                      >
                        <Show when={isDirty()} fallback={
                          <span class="text-(--text-4) group-hover/close:text-(--text-2) text-[13px] leading-none">×</span>
                        }>
                          <span class="block group-hover/close:hidden w-1.5 h-1.5 rounded-full bg-(--accent)" />
                          <span class="hidden group-hover/close:block text-(--text-4) group-hover/close:text-(--text-2) text-[13px] leading-none">×</span>
                        </Show>
                      </button>
                    )}
                  </div>
                </>
              )
            }}
          </For>
          {/* End-of-list insert cursor */}
          <Show when={tabBarOver() && insertBeforeId() === '__end__'}>
            <div class="tab-insert-cursor" />
          </Show>
        </div>
        {props.isRoot && (
          <button
            class="px-2 shrink-0 text-(--text-3) hover:text-(--text-2) hover:bg-(--bg-hover) flex items-center transition-colors"
            onClick={() => workspaceActions.toggleSidebar('right')}
            title="切换右侧栏"
          >
            <PanelRight size={15} />
          </button>
        )}
      </div>
      {/* Leaf area */}
      <div class="flex-1 relative overflow-hidden">
        <For each={props.node.children}>
          {(leaf) => {
            const isActive = createMemo(() => leaf.id === props.node.activeLeafId)
            return (
              <div
                class="absolute inset-0 flex flex-col overflow-hidden"
                style={{ display: isActive() ? 'flex' : 'none' }}
              >
                <WorkspaceLeafView leaf={leaf} isActive={isActive()} />
              </div>
            )
          }}
        </For>
        <Show when={isDraggingMainTab() && props.area === 'main'}>
          {makeZone('left')}
          {makeZone('right')}
          {makeZone('bottom')}
        </Show>
      </div>
    </div>
  )
}
