import { CalendarRange } from 'lucide-solid'
import { createEffect, onMount, Show } from 'solid-js'
import { appActions } from './actions/appActions'
import { CalendarPanel } from './components/panels/CalendarPanel'
import { FilesPanel } from './components/panels/FilesPanel'
import { LinksPanel } from './components/panels/LinksPanel'
import { OutlinePanel } from './components/panels/OutlinePanel'
import { TagsPanel } from './components/panels/TagsPanel'
import { Ribbon } from './components/Ribbon'
import { Settings } from './components/Settings'
import { StatusBar } from './components/StatusBar'
import { CalendarViewer } from './components/viewer/CalendarViewer'
import { EditorViewer } from './components/viewer/EditorViewer'
import { ImageViewer } from './components/viewer/ImageViewer'
import { SidebarRenderer } from './components/workspace/SidebarRenderer'
import { WorkspaceNodeRenderer } from './components/workspace/WorkspaceNodeRenderer'
import { registerView } from './lib/viewRegistry'
import { activeRoot, globalStore } from './stores/globalStore'

const customStyleEl = document.createElement('style')
document.head.appendChild(customStyleEl)

// ── View registration ─────────────────────────────────────────────────────────
registerView({
  kind: 'panel',
  position: 'left',
  type: 'files',
  getDisplayText: () => '文件',
  component: FilesPanel,
})
registerView({
  kind: 'panel',
  position: 'left',
  type: 'calendar-panel',
  getDisplayText: () => '日历',
  component: CalendarPanel,
})
registerView({
  kind: 'panel',
  position: 'right',
  type: 'links',
  getDisplayText: () => '链接',
  component: LinksPanel,
})
registerView({
  kind: 'panel',
  position: 'right',
  type: 'outline',
  getDisplayText: () => '大纲',
  component: OutlinePanel,
})
registerView({
  kind: 'panel',
  position: 'right',
  type: 'tags',
  getDisplayText: () => '标签',
  component: TagsPanel,
})
registerView({
  kind: 'file',
  type: 'markdown',
  getDisplayText: (p) => p.split('/').pop()!,
  canAcceptFile: (ext) => ext === '.md',
  component: EditorViewer,
})
registerView({
  kind: 'file',
  type: 'image',
  getDisplayText: (p) => p.split('/').pop()!,
  canAcceptFile: (ext) => IMAGE_EXTS.has(ext),
  component: ImageViewer,
})
registerView({
  kind: 'page',
  type: 'calendar',
  getDisplayText: () => '日历',
  getIcon: () => <CalendarRange size={11} />,
  component: CalendarViewer,
})

export const IMAGE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.bmp',
  '.avif',
])

export default function App() {
  createEffect(() => {
    document.documentElement.setAttribute(
      'data-theme',
      globalStore.workspace.theme,
    )
  })

  createEffect(() => {
    customStyleEl.textContent = globalStore.workspace.customCSS
  })

  onMount(async () => {
    await appActions.restoreVault()
  })

  return (
    <div class="h-full flex flex-col bg-(--bg-base) text-(--text) overflow-hidden">
      <div class="flex flex-1 overflow-hidden">
        <Ribbon />
        <SidebarRenderer node={activeRoot().left} />
        <div class="flex-1 flex flex-col overflow-hidden min-w-0">
          <WorkspaceNodeRenderer node={activeRoot().main} />
        </div>
        <SidebarRenderer node={activeRoot().right} />
      </div>
      <StatusBar />
      <Show when={globalStore.workspace.showSettings}>
        <Settings />
      </Show>
    </div>
  )
}
