import { For } from 'solid-js'
import { PanelLeft } from 'lucide-solid'
import { workspaceActions } from '../stores/workspaceStore'
import { getRibbonItems } from '../lib/pluginRegistry'

export function Ribbon() {
  return (
    <div class="w-9 bg-(--bg-base) border-r border-(--border) flex flex-col items-center py-2 gap-1.5 shrink-0">
      <button
        onClick={() => workspaceActions.toggleSidebar('left')}
        class="p-1.5 text-(--text-3) hover:bg-(--bg-hover) hover:text-(--text) rounded cursor-pointer transition-colors"
        title="切换左侧栏"
      >
        <PanelLeft size={18} />
      </button>

      <For each={getRibbonItems('top')}>
        {(item) => (
          <button
            class={`p-1.5 rounded cursor-pointer transition-colors hover:bg-(--bg-hover)
              ${item.isActive?.() ? 'text-(--accent)' : 'text-(--text-3) hover:text-(--text)'}`}
            title={item.title}
            onClick={() => item.onClick()}
          >
            {item.getIcon()}
          </button>
        )}
      </For>

      <div class="flex-1" />

      <For each={getRibbonItems('bottom')}>
        {(item) => (
          <button
            class={`p-1.5 rounded cursor-pointer transition-colors hover:bg-(--bg-hover)
              ${item.isActive?.() ? 'text-(--accent)' : 'text-(--text-3) hover:text-(--text)'}`}
            title={item.title}
            onClick={() => item.onClick()}
          >
            {item.getIcon()}
          </button>
        )}
      </For>
    </div>
  )
}
