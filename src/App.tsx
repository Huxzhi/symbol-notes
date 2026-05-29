import { createEffect, onMount, Show } from 'solid-js'
import { appActions } from './stores/runtimeStore'
import { activeRoot } from './stores/workspaceStore'
import { registerPlugin, startPlugins } from './lib/pluginRegistry'
import { Ribbon } from './components/Ribbon'
import { Settings } from './components/Settings'
import { StatusBar } from './components/StatusBar'
import { ContextMenu } from './components/ContextMenu'
import { ToastContainer } from './components/ToastContainer'
import { ConfirmModal } from './components/ConfirmModal'
import { SidebarRenderer } from './components/workspace/SidebarRenderer'
import { WorkspaceNodeRenderer } from './components/workspace/WorkspaceNodeRenderer'
import { settingsStore } from './stores/settingsStore'
import { initCacheStore } from './stores/cacheStore'
import { runtimeStore } from './stores/runtimeStore'
import { FilesPlugin } from './plugins/files'
import { EditorPlugin } from './plugins/editor'
import { LinksPlugin } from './plugins/links'
import { OutlinePlugin } from './plugins/outline'
import { TagsPlugin } from './plugins/tags'
import { SearchPlugin } from './plugins/search'
import { AppPlugin } from './plugins/app'
import { CalendarPlugin } from './plugins/calendar'

const customStyleEl = document.createElement('style')
document.head.appendChild(customStyleEl)

registerPlugin(FilesPlugin)
registerPlugin(EditorPlugin)
registerPlugin(LinksPlugin)
registerPlugin(OutlinePlugin)
registerPlugin(TagsPlugin)
registerPlugin(SearchPlugin)
registerPlugin(AppPlugin)
registerPlugin(CalendarPlugin)
startPlugins()

export default function App() {
  createEffect(() => {
    document.documentElement.setAttribute('data-theme', settingsStore.theme)
  })

  createEffect(() => {
    customStyleEl.textContent = settingsStore.customCSS
  })

  onMount(async () => {
    await initCacheStore()
    await appActions.restoreVault()
  })

  return (
    <div class="h-full flex flex-col bg-(--bg-base) text-(--text) overflow-hidden">
      <div class="flex flex-1 overflow-hidden">
        <Ribbon />
        <SidebarRenderer node={activeRoot().left} side="left" />
        <div class="flex-1 flex flex-col overflow-hidden min-w-0">
          <WorkspaceNodeRenderer node={activeRoot().main} />
        </div>
        <SidebarRenderer node={activeRoot().right} side="right" />
      </div>
      <StatusBar />
      <Show when={runtimeStore.showSettings}>
        <Settings />
      </Show>
      <ContextMenu />
      <ToastContainer />
      <ConfirmModal />
    </div>
  )
}
