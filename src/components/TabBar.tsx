import { For, Show } from 'solid-js'
import { PanelRight, CalendarRange } from 'lucide-solid'
import { fileSystemStore } from '../stores/fileSystemStore'
import { openFile, closeFile } from '../services/fileSystemService'
import { uiStore, setUIStore, openPage, closePage } from '../stores/uiStore'
import { PAGE_MAP } from '../lib/pageRegistry'
import type { Component } from 'solid-js'

// Icon lookup — add entries as new page types are registered.
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

        {/* Page tabs (calendar, graph, …) — rendered in open order */}
        <For each={uiStore.openPageIds}>
          {(id) => {
            const def = PAGE_MAP[id]
            if (!def) return null
            const Icon = PAGE_ICONS[id]
            const isActive = () => uiStore.activePageId === id
            return (
              <div
                class={`flex items-center gap-1.5 px-3 border-r border-[var(--border)] text-[11px] shrink-0 cursor-pointer select-none
                  ${isActive()
                    ? 'bg-[var(--bg-base)] text-[var(--text)] border-b-2 border-b-[var(--accent)] -mb-px'
                    : 'text-[var(--text-3)] hover:bg-[var(--bg-hover)]'}`}
                onClick={() => openPage(id)}
              >
                <Show when={Icon}>
                  {(_) => <Icon size={11} class={isActive() ? 'text-[var(--accent)] shrink-0' : 'shrink-0'} />}
                </Show>
                <span>{def.label}</span>
                <button
                  class="text-[var(--text-4)] hover:text-[var(--text-2)] text-[13px] leading-none ml-0.5 cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); closePage(id) }}
                  title={`关闭${def.label}`}
                >×</button>
              </div>
            )
          }}
        </For>

        {/* File tabs */}
        <For each={fileSystemStore.openFilePaths}>
          {(path) => {
            const isActive = () => fileSystemStore.activeFilePath === path && uiStore.activePageId === null
            return (
              <div
                class={`flex items-center gap-1.5 px-3 border-r border-[var(--border)] cursor-pointer text-[11px] shrink-0
                  ${isActive()
                    ? 'bg-[var(--bg-base)] text-[var(--text)] border-b-2 border-b-[var(--accent)] -mb-px'
                    : 'text-[var(--text-3)] hover:bg-[var(--bg-hover)]'}`}
                onClick={() => { setUIStore('activePageId', null); openFile(path) }}
              >
                <span class="text-[9px] text-[var(--accent)]">◻</span>
                <span class="max-w-[120px] truncate">{baseName(path)}</span>
                <button
                  class="text-[var(--text-4)] hover:text-[var(--text-2)] text-[13px] leading-none ml-0.5"
                  onClick={(e) => { e.stopPropagation(); closeFile(path) }}
                >×</button>
              </div>
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
