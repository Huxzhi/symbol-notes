import { FolderOpen, Search, Network, Settings, CalendarDays } from 'lucide-solid'
import { PanelLeft } from 'lucide-solid'
import { openDirectory } from '../services/fileSystemService'
import { uiStore, setUIStore } from '../stores/uiStore'

export function Ribbon() {
  const switchView = (view: 'files' | 'calendar') => {
    if (uiStore.sidebarView === view && uiStore.showLeft) {
      setUIStore('showLeft', false)
    } else {
      setUIStore('sidebarView', view)
      setUIStore('showLeft', true)
    }
  }

  return (
    <div class="w-9 bg-[var(--bg-base)] border-r border-[var(--border)] flex flex-col items-center py-2 gap-1.5 shrink-0">
      <button
        onClick={() => setUIStore('showLeft', v => !v)}
        class="p-1.5 text-[var(--text-3)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] rounded cursor-pointer transition-colors"
        title="切换左侧栏"
      >
        <PanelLeft size={18} />
      </button>
      <button
        onClick={openDirectory}
        class="p-1.5 text-[var(--accent)] hover:bg-[var(--bg-hover)] rounded cursor-pointer transition-colors"
        title="打开文件夹"
      >
        <FolderOpen size={18} />
      </button>
      <button
        class={`p-1.5 rounded cursor-pointer transition-colors hover:bg-[var(--bg-hover)]
          ${uiStore.sidebarView === 'files' && uiStore.showLeft
            ? 'text-[var(--accent)]'
            : 'text-[var(--text-3)] hover:text-[var(--text)]'}`}
        title="文件列表"
        onClick={() => switchView('files')}
      >
        <Search size={18} />
      </button>
      <button
        class={`p-1.5 rounded cursor-pointer transition-colors hover:bg-[var(--bg-hover)]
          ${uiStore.sidebarView === 'calendar' && uiStore.showLeft
            ? 'text-[var(--accent)]'
            : 'text-[var(--text-3)] hover:text-[var(--text)]'}`}
        title="日历"
        onClick={() => switchView('calendar')}
      >
        <CalendarDays size={18} />
      </button>
      <button
        class="p-1.5 text-[var(--text-3)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] rounded cursor-pointer transition-colors"
        title="知识图谱"
      >
        <Network size={18} />
      </button>
      <div class="flex-1" />
      <button
        class="p-1.5 text-[var(--text-3)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] rounded cursor-pointer transition-colors"
        title="设置"
        onClick={() => setUIStore('showSettings', true)}
      >
        <Settings size={18} />
      </button>
    </div>
  )
}
