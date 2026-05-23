import { For, Show } from 'solid-js'
import { PanelRight, CalendarRange } from 'lucide-solid'
import { fileSystemStore } from '../stores/fileSystemStore'
import { openFile, closeFile } from '../services/fileSystemService'
import { uiStore, setUIStore, openPage, closePage, isPageTab } from '../stores/uiStore'
import { PAGE_MAP } from '../lib/pageRegistry'
import { isImagePath } from '../lib/fileTypes'
import type { Component } from 'solid-js'

const PAGE_ICONS: Record<string, Component<{ size?: number; class?: string }>> = {
  calendar: CalendarRange,
}

export function TabBar() {
  function baseName(path: string) {
    return path.split('/').pop() ?? path
  }

  return (
    <div class="h-8 bg-[var(--bg-base)] border-b border-[var(--border)] flex items-stretch shrink-0 overflow-y-hidden">
      <div class="flex flex-1 overflow-x-auto overflow-y-hidden">

        <For each={uiStore.tabOrder}>
          {(id) => {
            const isPage = () => isPageTab(id)

            return (
              <Show
                when={isPage()}
                fallback={
                  /* File tab */
                  <div
                    class={`flex items-center gap-1.5 px-3 border-r border-[var(--border)] cursor-pointer text-[11px] shrink-0
                      ${fileSystemStore.activeFilePath === id && uiStore.activePageId === null
                        ? 'bg-[var(--bg-base)] text-[var(--text)] border-b-2 border-b-[var(--accent)] -mb-px'
                        : 'text-[var(--text-3)] hover:bg-[var(--bg-hover)]'}`}
                    onClick={() => { setUIStore('activePageId', null); openFile(id) }}
                  >
                    <span class="text-[9px] text-[var(--accent)]">{isImagePath(id) ? '⊡' : '◻'}</span>
                    <span class="max-w-[120px] truncate">{baseName(id)}</span>
                    <button
                      class="text-[var(--text-4)] hover:text-[var(--text-2)] text-[13px] leading-none ml-0.5"
                      onClick={(e) => { e.stopPropagation(); closeFile(id) }}
                    >×</button>
                  </div>
                }
              >
                {/* Page tab */}
                {(() => {
                  const def = PAGE_MAP[id]
                  if (!def) return null
                  const Icon = PAGE_ICONS[id]
                  return (
                    <div
                      class={`flex items-center gap-1.5 px-3 border-r border-[var(--border)] text-[11px] shrink-0 cursor-pointer select-none
                        ${uiStore.activePageId === id
                          ? 'bg-[var(--bg-base)] text-[var(--text)] border-b-2 border-b-[var(--accent)] -mb-px'
                          : 'text-[var(--text-3)] hover:bg-[var(--bg-hover)]'}`}
                      onClick={() => openPage(id)}
                    >
                      <Show when={Icon}>
                        {(_) => <Icon size={11} class={uiStore.activePageId === id ? 'text-[var(--accent)] shrink-0' : 'shrink-0'} />}
                      </Show>
                      <span>{def.label}</span>
                      <button
                        class="text-[var(--text-4)] hover:text-[var(--text-2)] text-[13px] leading-none ml-0.5 cursor-pointer"
                        onClick={(e) => { e.stopPropagation(); closePage(id) }}
                        title={`关闭${def.label}`}
                      >×</button>
                    </div>
                  )
                })()}
              </Show>
            )
          }}
        </For>

      </div>

      <button
        class="px-2 shrink-0 text-[var(--text-3)] hover:text-[var(--text-2)] hover:bg-[var(--bg-hover)] flex items-center transition-colors"
        onClick={() => setUIStore('showRight', v => !v)}
        title="切换右侧栏"
      >
        <PanelRight size={15} />
      </button>
    </div>
  )
}
