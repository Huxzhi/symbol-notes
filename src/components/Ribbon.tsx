import {
  Search,
  Network,
  Settings,
  CalendarDays,
  CalendarRange,
  PanelLeft,
} from 'lucide-solid'
import { activeRoot, activeLayout, findLeafInTree } from '../stores/workspaceStore'
import { workspaceActions } from '../stores/workspaceStore'
import { appActions } from '../stores/runtimeStore'

export function Ribbon() {
  const leftSidebar = () => activeRoot().left
  const leftOpen = () => !leftSidebar().collapsed

  // Returns the viewState.type of the active leaf in the first left tabs group, or null
  const leftActiveType = (): string | null => {
    if (!leftOpen()) return null
    for (const node of leftSidebar().children) {
      if (node.type === 'tabs' && node.activeLeafId) {
        const leaf = node.children.find(l => l.id === node.activeLeafId)
        if (leaf) return leaf.viewState.type
      }
    }
    return null
  }

  // Toggle to a panel type: open + activate, or close if already active
  const switchLeftPanel = (viewType: string) => {
    if (leftActiveType() === viewType && leftOpen()) {
      workspaceActions.toggleSidebar('left')
      return
    }
    for (const node of leftSidebar().children) {
      if (node.type === 'tabs') {
        const leaf = node.children.find(l => l.viewState.type === viewType)
        if (leaf) {
          workspaceActions.activateSidebarLeaf('left', leaf.id)
          break
        }
      }
    }
    if (!leftOpen()) workspaceActions.toggleSidebar('left')
  }

  const calendarPageActive = () => {
    const { activeLeafId } = activeLayout()
    if (!activeLeafId) return false
    const leaf = findLeafInTree(activeRoot().main, activeLeafId)
    return leaf?.viewState.type === 'calendar'
  }

  return (
    <div class="w-9 bg-(--bg-base) border-r border-(--border) flex flex-col items-center py-2 gap-1.5 shrink-0">
      <button
        onClick={() => workspaceActions.toggleSidebar('left')}
        class="p-1.5 text-(--text-3) hover:bg-(--bg-hover) hover:text-(--text) rounded cursor-pointer transition-colors"
        title="切换左侧栏"
      >
        <PanelLeft size={18} />
      </button>

      <button
        class={`p-1.5 rounded cursor-pointer transition-colors hover:bg-(--bg-hover)
          ${leftActiveType() === 'files' ? 'text-(--accent)' : 'text-(--text-3) hover:text-(--text)'}`}
        title="文件列表"
        onClick={() => switchLeftPanel('files')}
      >
        <Search size={18} />
      </button>
      <button
        class={`p-1.5 rounded cursor-pointer transition-colors hover:bg-(--bg-hover)
          ${leftActiveType() === 'calendar-panel' ? 'text-(--accent)' : 'text-(--text-3) hover:text-(--text)'}`}
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
