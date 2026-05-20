import { FolderOpen, Search, Network, Settings, PanelLeft, PanelRight } from 'lucide-solid'
import { openDirectory } from '../services/fileSystemService'

interface Props {
  onToggleLeft: () => void
  onToggleRight: () => void
}

export function Ribbon(props: Props) {
  async function handleOpen() {
    await openDirectory()
  }

  return (
    <div class="w-9 bg-[#0d0d1a] border-r border-[#1e1e35] flex flex-col items-center py-2 gap-1.5 shrink-0">
      <button onClick={handleOpen} class="p-1.5 text-[#6c63ff] hover:bg-[#1e1e35] rounded cursor-pointer" title="打开文件夹">
        <FolderOpen size={18} />
      </button>
      <button class="p-1.5 text-[#555] hover:bg-[#1e1e35] rounded cursor-pointer" title="搜索">
        <Search size={18} />
      </button>
      <button class="p-1.5 text-[#555] hover:bg-[#1e1e35] rounded cursor-pointer" title="知识图谱">
        <Network size={18} />
      </button>
      <div class="flex-1" />
      <button onClick={props.onToggleLeft} class="p-1.5 text-[#555] hover:bg-[#1e1e35] rounded cursor-pointer" title="切换左栏">
        <PanelLeft size={18} />
      </button>
      <button onClick={props.onToggleRight} class="p-1.5 text-[#555] hover:bg-[#1e1e35] rounded cursor-pointer" title="切换右栏">
        <PanelRight size={18} />
      </button>
      <button class="p-1.5 text-[#555] hover:bg-[#1e1e35] rounded cursor-pointer" title="设置">
        <Settings size={18} />
      </button>
    </div>
  )
}
