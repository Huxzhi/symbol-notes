import { For } from 'solid-js'
import { PanelRight } from 'lucide-solid'
import { fileSystemStore } from '../stores/fileSystemStore'
import { openFile, closeFile } from '../services/fileSystemService'
import { setUIStore } from '../stores/uiStore'

export function TabBar() {
  function baseName(path: string) {
    return path.split('/').pop() ?? path
  }

  return (
    <div class="h-8 bg-[#0d0d1a] border-b border-[#1e1e35] flex items-stretch shrink-0 overflow-y-hidden">
      <div class="flex flex-1 overflow-x-auto overflow-y-hidden">
        <For each={fileSystemStore.openFilePaths}>
          {(path) => {
            const isActive = () => fileSystemStore.activeFilePath === path
            return (
              <div
                class={`flex items-center gap-1.5 px-3 border-r border-[#1e1e35] cursor-pointer text-[11px] shrink-0
                  ${isActive()
                    ? 'bg-[#0f0f1c] text-white border-b-2 border-b-[#6c63ff] -mb-px'
                    : 'text-[#555] hover:bg-[#1a1a2e]'}`}
                onClick={() => openFile(path)}
              >
                <span class="text-[9px] text-[#6c63ff]">◻</span>
                <span class="max-w-[120px] truncate">{baseName(path)}</span>
                <button
                  class="text-[#333] hover:text-[#888] text-[13px] leading-none ml-0.5"
                  onClick={(e) => { e.stopPropagation(); closeFile(path) }}
                >
                  ×
                </button>
              </div>
            )
          }}
        </For>
      </div>

      <button
        class="px-2 shrink-0 text-[#555] hover:text-[#aaa] hover:bg-[#1a1a2e] flex items-center"
        onClick={() => setUIStore('showRight', v => !v)}
        title="切换右侧栏"
      >
        <PanelRight size={15} />
      </button>
    </div>
  )
}
