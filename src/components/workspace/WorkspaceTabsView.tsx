import { PanelRight } from 'lucide-solid'
import { For, createMemo } from 'solid-js'
import { workspaceActions } from '../../stores/workspaceStore'
import { getView } from '../../lib/pluginRegistry'
import type { WorkspaceLeaf, WorkspaceTabs } from '../../stores/types'
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
  return (
    <div class="flex flex-col h-full">
      {/* Tab bar */}
      <div class="h-8 bg-(--bg-base) border-b border-(--border)] flex items-stretch shrink-0 overflow-y-hidden">
        <div class="flex flex-1 overflow-x-auto overflow-y-hidden">
          <For each={props.node.children}>
            {(leaf) => {
              const isActive = createMemo(
                () => leaf.id === props.node.activeLeafId,
              )
              const isPinned = () => leaf.pinned
              const def = () => getView(leaf.viewState.type)
              const isPanelLeaf = () => def()?.kind === 'panel'
              return (
                <div
                  data-ctx={!isPanelLeaf() ? 'tab' : undefined}
                  data-leaf-id={!isPanelLeaf() ? leaf.id : undefined}
                  data-tabs-id={!isPanelLeaf() ? props.node.id : undefined}
                  class={`flex items-center gap-1.5 px-3 border-r border-(--border)] cursor-pointer text-[11px] shrink-0
                    ${
                      isActive()
                        ? 'bg-(--bg-base) text-(--text) border-b-2 border-b-(--accent) -mb-px'
                        : 'text-(--text-3) hover:bg-(--bg-hover)'
                    }`}
                  onClick={() => {
                    if (isPanelLeaf()) {
                      workspaceActions.activateSidebarLeafById(leaf.id)
                    } else {
                      workspaceActions.activateLeaf(leaf.id)
                    }
                  }}
                  onDblClick={() => {
                    if (!isPanelLeaf())
                      workspaceActions.setLeafPinned(leaf.id, true)
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
                      class="text-(--text-4) hover:text-(--text-2) text-[13px] leading-none ml-0.5"
                      onClick={(e) => {
                        e.stopPropagation()
                        workspaceActions.closeLeaf(leaf.id)
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              )
            }}
          </For>
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
      {/* Leaf area — all leaves mounted, only active shown */}
      <div class="flex-1 relative overflow-hidden">
        <For each={props.node.children}>
          {(leaf) => {
            const isActive = createMemo(
              () => leaf.id === props.node.activeLeafId,
            )
            return (
              <div
                class="absolute inset-0 flex flex-col overflow-hidden"
                style={{ display: isActive() ? 'flex' : 'none' }}
              >
                <WorkspaceLeafView
                  leaf={leaf}
                  isActive={isActive()}
                />
              </div>
            )
          }}
        </For>
      </div>
    </div>
  )
}
