import { For, Show } from 'solid-js'
import { ChevronLeft, ChevronRight } from 'lucide-solid'
import { workspaceActions, leafInstances } from '../../stores/workspaceStore'
import { revealFolder } from '../../stores/revealStore'
import { getView } from '../../lib/pluginRegistry'
import { splitBreadcrumb } from './breadcrumb'
import type { WorkspaceTabs, WorkspaceLeaf } from '../../stores/types'

export function WorkspaceNavBar(props: { node: WorkspaceTabs }) {
  const activeLeaf = (): WorkspaceLeaf | undefined =>
    props.node.children.find((l) => l.id === props.node.activeLeafId)
  const leafId = () => activeLeaf()?.id ?? ''
  const inst = () => leafInstances[leafId()]
  const index = () => inst()?.historyIndex ?? -1
  const len = () => inst()?.history?.length ?? 0
  const file = () => activeLeaf()?.viewState.state.file as string | undefined

  const canBack = () => index() > 0
  const canFwd = () => index() < len() - 1

  const pageTitle = () => {
    const def = getView(activeLeaf()?.viewState.type ?? '')
    return def && def.kind !== 'file' ? def.getDisplayText() : ''
  }

  const btn =
    'w-5 h-5 flex items-center justify-center rounded hover:bg-(--bg-hover) disabled:opacity-30 disabled:hover:bg-transparent transition-colors cursor-pointer'

  return (
    <div class="h-7 shrink-0 flex items-center gap-1 px-2 border-b border-(--border) bg-(--bg-base) text-[11px] text-(--text-3)">
      <button class={btn} disabled={!canBack()} title="后退" onClick={() => workspaceActions.navigateBack(leafId())}>
        <ChevronLeft size={14} />
      </button>
      <button class={btn} disabled={!canFwd()} title="前进" onClick={() => workspaceActions.navigateForward(leafId())}>
        <ChevronRight size={14} />
      </button>
      <div class="flex items-center gap-1 min-w-0 overflow-hidden ml-1">
        <Show when={file()} fallback={<span class="truncate text-(--text-3)">{pageTitle()}</span>}>
          {(f) => {
            const parts = () => splitBreadcrumb(f())
            return (
              <>
                <For each={parts().folders}>
                  {(seg) => (
                    <>
                      <button
                        type="button"
                        class="shrink-0 hover:text-(--text) hover:underline truncate max-w-32 cursor-pointer"
                        title={`在文件面板中定位 ${seg.path}`}
                        onClick={() => {
                          workspaceActions.switchSidebarPanel('left', 'files', false)
                          revealFolder(seg.path)
                        }}
                      >
                        {seg.name}
                      </button>
                      <span class="shrink-0 text-(--text-4)">/</span>
                    </>
                  )}
                </For>
                <span class="truncate text-(--text-2) font-medium" title={f()}>{parts().file}</span>
              </>
            )
          }}
        </Show>
      </div>
    </div>
  )
}
