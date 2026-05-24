import { createEffect, onMount, Show } from 'solid-js'
import { CalendarRange } from 'lucide-solid'
import { Ribbon } from './components/Ribbon'
import { Sidebar } from './components/Sidebar'
import { CalendarPanel } from './components/CalendarPanel'
import { TabBar } from './components/TabBar'
import { ContentPane } from './components/ContentPane'
import { RightPanel } from './components/RightPanel'
import { StatusBar } from './components/StatusBar'
import { Settings } from './components/Settings'
import { restoreDirectory } from './services/fileSystemService'
import { uiStore } from './stores/uiStore'
import { registerView } from './lib/viewRegistry'
import { EditorPane } from './components/EditorPane'
import { ImageViewer } from './components/ImageViewer'
import { CalendarPage } from './components/CalendarPage'

const customStyleEl = document.createElement('style')
document.head.appendChild(customStyleEl)

const IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif',
])

registerView({
  kind: 'file',
  type: 'markdown',
  getDisplayText: path => path.split('/').pop()!,
  canAcceptFile: ext => ext === '.md',
  component: EditorPane,
})

registerView({
  kind: 'file',
  type: 'image',
  getDisplayText: path => path.split('/').pop()!,
  canAcceptFile: ext => IMAGE_EXTS.has(ext),
  component: ImageViewer,
})

registerView({
  kind: 'page',
  type: 'calendar',
  getDisplayText: () => '日历',
  getIcon: () => <CalendarRange size={11} />,
  component: CalendarPage,
})

export default function App() {
  createEffect(() => {
    document.documentElement.setAttribute('data-theme', uiStore.theme)
  })

  createEffect(() => {
    customStyleEl.textContent = uiStore.customCSS
  })

  onMount(async () => {
    await restoreDirectory()
  })

  return (
    <div class="h-full flex flex-col bg-[var(--bg-base)] text-[var(--text)] overflow-hidden">
      <div class="flex flex-1 overflow-hidden">
        <Ribbon />
        <div
          class={`transition-all duration-200 overflow-hidden ${uiStore.showLeft ? 'w-47.5' : 'w-0'}`}
        >
          <Show when={uiStore.sidebarView === 'calendar'} fallback={<Sidebar />}>
            <CalendarPanel />
          </Show>
        </div>
        <div class="flex-1 flex flex-col overflow-hidden min-w-0">
          <TabBar />
          <ContentPane />
        </div>
        <div
          class={`transition-all duration-200 overflow-hidden ${uiStore.showRight ? 'w-50' : 'w-0'}`}
        >
          <RightPanel />
        </div>
      </div>
      <StatusBar />
      <Show when={uiStore.showSettings}>
        <Settings />
      </Show>
    </div>
  )
}
