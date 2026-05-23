import { For, Show } from 'solid-js'
import { PanelRight, CalendarRange } from 'lucide-solid'
import { fileSystemStore } from '../stores/fileSystemStore'
import { openFile, closeFile } from '../services/fileSystemService'
import { uiStore, setUIStore } from '../stores/uiStore'

export function TabBar() {
  function baseName(path: string) {
    return path.split('/').pop() ?? path
  }

  return (
    <div class="h-8 bg-[var(--bg-base)] border-b border-[var(--border)] flex items-stretch shrink-0 overflow-y-hidden">
      <div class="flex flex-1 overflow-x-auto overflow-y-hidden">

        {/* Calendar tab — stays until explicitly closed with × */}
        <Show when={uiStore.calendarOpen}>
          <div
            class={`flex items-center gap-1.5 px-3 border-r border-[var(--border)] text-[11px] shrink-0 cursor-pointer select-none
              ${uiStore.calendarActive
                ? 'bg-[var(--bg-base)] text-[var(--text)] border-b-2 border-b-[var(--accent)] -mb-px'
                : 'text-[var(--text-3)] hover:bg-[var(--bg-hover)]'}`}
            onClick={() => setUIStore('calendarActive', true)}
          >
            <CalendarRange size={11} class={`shrink-0 ${uiStore.calendarActive ? 'text-[var(--accent)]' : ''}`} />
            <span>日历</span>
            <button
              class="text-[var(--text-4)] hover:text-[var(--text-2)] text-[13px] leading-none ml-0.5 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation()
                setUIStore({ calendarOpen: false, calendarActive: false })
              }}
              title="关闭日历"
            >×</button>
          </div>
        </Show>

        {/* File tabs */}
        <For each={fileSystemStore.openFilePaths}>
          {(path) => {
            const isActive = () => fileSystemStore.activeFilePath === path && !uiStore.calendarActive
            return (
              <div
                class={`flex items-center gap-1.5 px-3 border-r border-[var(--border)] cursor-pointer text-[11px] shrink-0
                  ${isActive()
                    ? 'bg-[var(--bg-base)] text-[var(--text)] border-b-2 border-b-[var(--accent)] -mb-px'
                    : 'text-[var(--text-3)] hover:bg-[var(--bg-hover)]'}`}
                onClick={() => { setUIStore('calendarActive', false); openFile(path) }}
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
