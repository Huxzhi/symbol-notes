import { createEffect, onMount, Show } from 'solid-js'
import { CalendarRange } from 'lucide-solid'
import { Ribbon } from './components/Ribbon'
import { Sidebar } from './components/Sidebar'
import { CalendarPanel } from './components/CalendarPanel'
import { StatusBar } from './components/StatusBar'
import { Settings } from './components/Settings'
import { WorkspaceNodeRenderer } from './components/workspace/WorkspaceNodeRenderer'
import { SidebarRenderer } from './components/workspace/SidebarRenderer'
import { fsActions } from './actions/fsActions'
import { globalStore } from './stores/globalStore'
import { registerView } from './lib/viewRegistry'
import { EditorPane } from './components/EditorPane'
import { ImageViewer } from './components/ImageViewer'
import { CalendarPage } from './components/CalendarPage'
import { LinksPanel } from './components/panels/LinksPanel'
import { OutlinePanel } from './components/panels/OutlinePanel'
import { TagsPanel } from './components/panels/TagsPanel'

const customStyleEl = document.createElement('style')
document.head.appendChild(customStyleEl)

const IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif',
])

// ── File views ────────────────────────────────────────────────────────────────
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

// ── Page views (full-tab) ─────────────────────────────────────────────────────
registerView({
  kind: 'page',
  type: 'calendar',
  getDisplayText: () => '日历',
  getIcon: () => <CalendarRange size={11} />,
  component: CalendarPage,
})

// ── Left sidebar panels ───────────────────────────────────────────────────────
registerView({ kind: 'panel', position: 'left', type: 'files',           getDisplayText: () => '文件', component: Sidebar })
registerView({ kind: 'panel', position: 'left', type: 'calendar-panel',  getDisplayText: () => '日历', component: CalendarPanel })

// ── Right sidebar panels ──────────────────────────────────────────────────────
registerView({ kind: 'panel', position: 'right', type: 'links',   getDisplayText: () => '链接', component: LinksPanel })
registerView({ kind: 'panel', position: 'right', type: 'outline', getDisplayText: () => '大纲', component: OutlinePanel })
registerView({ kind: 'panel', position: 'right', type: 'tags',    getDisplayText: () => '标签', component: TagsPanel })

export default function App() {
  createEffect(() => {
    document.documentElement.setAttribute('data-theme', globalStore.workspace.theme)
  })

  createEffect(() => {
    customStyleEl.textContent = globalStore.workspace.customCSS
  })

  onMount(async () => {
    await fsActions.restoreDirectory()
  })

  return (
    <div class="h-full flex flex-col bg-[var(--bg-base)] text-[var(--text)] overflow-hidden">
      <div class="flex flex-1 overflow-hidden">
        <Ribbon />
        <SidebarRenderer side="left" />
        <div class="flex-1 flex flex-col overflow-hidden min-w-0">
          <WorkspaceNodeRenderer node={globalStore.workspace.main} />
        </div>
        <SidebarRenderer side="right" />
      </div>
      <StatusBar />
      <Show when={globalStore.workspace.showSettings}>
        <Settings />
      </Show>
    </div>
  )
}
