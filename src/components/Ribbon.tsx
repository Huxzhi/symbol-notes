import { FolderOpen, Search, Network, Settings, PanelLeft } from 'lucide-solid'
import { openDirectory } from '../services/fileSystemService'
import { setUIStore } from '../stores/uiStore'

export function Ribbon() {
  return (
    <div class="w-9 bg-[#0d0d1a] border-r border-[#1e1e35] flex flex-col items-center py-2 gap-1.5 shrink-0">
      <button onClick={() => setUIStore('showLeft', v => !v)} class="p-1.5 text-[#555] hover:bg-[#1e1e35] rounded cursor-pointer" title="切换左侧栏">
        <PanelLeft size={18} />
      </button>
      <button onClick={openDirectory} class="p-1.5 text-[#6c63ff] hover:bg-[#1e1e35] rounded cursor-pointer" title="打开文件夹">
        <FolderOpen size={18} />
      </button>
      <button class="p-1.5 text-[#555] hover:bg-[#1e1e35] rounded cursor-pointer" title="搜索">
        <Search size={18} />
      </button>
      <button class="p-1.5 text-[#555] hover:bg-[#1e1e35] rounded cursor-pointer" title="知识图谱">
        <Network size={18} />
      </button>
      <div class="flex-1" />
      <button class="p-1.5 text-[#555] hover:bg-[#1e1e35] rounded cursor-pointer" title="设置">
        <Settings size={18} />
      </button>
    </div>
  )
}
