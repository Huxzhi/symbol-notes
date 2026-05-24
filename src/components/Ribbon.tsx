import {
  Search,
  Network,
  Settings,
  CalendarDays,
  CalendarRange,
  PanelLeft,
} from 'lucide-solid'
import { globalStore, setGlobalStore, findLeafInTree } from '../stores/globalStore'
import { workspaceActions } from '../actions/workspaceActions'
import { appActions } from '../actions/appActions'

export function Ribbon() {
  const leftOpen = () => !globalStore.workspace.left.collapsed

  const switchLeftPanel = (view: string) => {
    if (globalStore.workspace.leftPanelView === view && leftOpen()) {
      workspaceActions.toggleLeft()
    } else {
      workspaceActions.setLeftPanelView(view)
      setGlobalStore('workspace', 'left', 'collapsed', false)
    }
  }

  const calendarPageActive = () => {
    const { activeLeafId } = globalStore.workspace
    if (!activeLeafId) return false
    const leaf = findLeafInTree(globalStore.workspace.main, activeLeafId)
    return leaf?.viewState.type === 'calendar'
  }

  return (
    <div class="w-9 bg-(--bg-base) border-r border-(--border) flex flex-col items-center py-2 gap-1.5 shrink-0">
      <button
        onClick={() => workspaceActions.toggleLeft()}
        class="p-1.5 text-(--text-3) hover:bg-(--bg-hover) hover:text-(--text) rounded cursor-pointer transition-colors"
        title="切换左侧栏"
      >
        <PanelLeft size={18} />
      </button>

      <button
        class={`p-1.5 rounded cursor-pointer transition-colors hover:bg-(--bg-hover)
          ${globalStore.workspace.leftPanelView === 'files' && leftOpen() ? 'text-(--accent)' : 'text-(--text-3) hover:text-(--text)'}`}
        title="文件列表"
        onClick={() => switchLeftPanel('files')}
      >
        <Search size={18} />
      </button>
      <button
        class={`p-1.5 rounded cursor-pointer transition-colors hover:bg-(--bg-hover)
          ${globalStore.workspace.leftPanelView === 'calendar-panel' && leftOpen() ? 'text-(--accent)' : 'text-(--text-3) hover:text-(--text)'}`}
        title="日历"
        onClick={() => switchLeftPanel('calendar-panel')}
      >
        <CalendarDays size={18} />
      </button>
      <button
        class={`p-1.5 rounded cursor-pointer transition-colors hover:bg-(--bg-hover)
          ${calendarPageActive() ? 'text-(--accent)' : 'text-(--text-3) hover:text-(--text)'}`}
        title="日历大图"
        onClick={() => workspaceActions.openPage('calendar')}
      >
        <CalendarRange size={18} />
      </button>
      <button
        class="p-1.5 text-(--text-3) hover:bg-(--bg-hover) hover:text-(--text) rounded cursor-pointer transition-colors"
        title="知识图谱"
      >
        <Network size={18} />
      </button>
      <div class="flex-1" />
      <button
        class="p-1.5 text-(--text-3) hover:bg-(--bg-hover) hover:text-(--text) rounded cursor-pointer transition-colors"
        title="设置"
        onClick={() => appActions.toggleSettings()}
      >
        <Settings size={18} />
      </button>
    </div>
  )
}
