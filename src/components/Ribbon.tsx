import { FolderOpen, Search, Network, Settings } from 'lucide-solid'
import { PanelLeft } from 'lucide-solid'
import { openDirectory } from '../services/fileSystemService'
import { setUIStore } from '../stores/uiStore'

export function Ribbon() {
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
        class="p-1.5 text-[var(--text-3)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] rounded cursor-pointer transition-colors"
        title="搜索"
      >
        <Search size={18} />
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
