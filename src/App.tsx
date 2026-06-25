import { SettingsIcon } from 'lucide-solid'
import { createEffect, createSignal, onMount, Show } from 'solid-js'

const [showSettings, setShowSettings] = createSignal(false)
import { ConfirmModal } from './components/ConfirmModal'
import { ConflictModal } from './components/ConflictModal'
import { ContextMenu } from './components/ContextMenu'
import { Ribbon } from './components/Ribbon'
import { Settings } from './components/Settings'
import { StatusBar } from './components/StatusBar'
import { ToastContainer } from './components/ToastContainer'
import { SidebarRenderer } from './components/workspace/SidebarRenderer'
import { WorkspaceNodeRenderer } from './components/workspace/WorkspaceNodeRenderer'
import {
  definePlugin,
  registerPlugin,
  startPlugins,
} from './lib/pluginRegistry'

import { CalendarPlugin } from './plugins/calendar'
import { DailyNotePlugin } from './plugins/daily-note'
import { EditorPlugin } from './plugins/editor'
import { ExcalidrawPlugin } from './plugins/excalidraw'
import { FilesPlugin } from './plugins/files'
import { LinksPlugin } from './plugins/links'
import { OutlinePlugin } from './plugins/outline'
import { SearchPlugin } from './plugins/search'
import { TagsPlugin } from './plugins/tags'
import { TemplatesPlugin } from './plugins/templates'
import { TemplatePicker } from './plugins/templates/TemplatePicker'
import { TimelinePlugin } from './plugins/timeline'
import { LoadingOverlay } from './components/LoadingOverlay'
import { restoreVault } from './loader'
import { settingsStore } from './stores/settingsStore'
import { activeRoot } from './stores/workspaceStore'
import { applyTheme, resolveTheme } from './lib/theme'
import { snapshotMaskColors, writeMaskColors } from './lib/themeCache'

const customStyleEl = document.createElement('style')
document.head.appendChild(customStyleEl)

const AppPlugin = definePlugin({
  id: 'app',
  name: '应用',
  core: true,
  setup(ctx) {
    ctx.ribbon({
      id: 'settings',
      title: '设置',
      getIcon: () => <SettingsIcon size={18} />,
      onClick: () => setShowSettings(v => !v),
      position: 'bottom',
    })
  },
})

// Core plugins first; specific plugins registered later take priority (last-wins in getFileViewForPath)
registerPlugin(EditorPlugin)
registerPlugin(FilesPlugin)
registerPlugin(LinksPlugin)
registerPlugin(OutlinePlugin)
registerPlugin(TagsPlugin)
registerPlugin(SearchPlugin)
registerPlugin(AppPlugin)
registerPlugin(CalendarPlugin)
registerPlugin(DailyNotePlugin)
registerPlugin(ExcalidrawPlugin)
registerPlugin(TemplatesPlugin)
registerPlugin(TimelinePlugin)
startPlugins()

export default function App() {
  createEffect(() => {
    applyTheme(resolveTheme(settingsStore.theme, settingsStore.customThemes))
    void writeMaskColors(snapshotMaskColors()) // 刷新遮罩缓存供下次启动
  })

  createEffect(() => {
    customStyleEl.textContent = settingsStore.customCSS
  })

  onMount(() => {
    void restoreVault()
  })

  return (
    <div class="h-full flex flex-col bg-(--bg-base) text-(--text) overflow-hidden">
      <div class="flex flex-1 overflow-hidden">
        <Ribbon />
        <SidebarRenderer
          node={activeRoot().left}
          side="left"
        />
        <div class="flex-1 flex flex-col overflow-hidden min-w-0">
          <WorkspaceNodeRenderer
            node={activeRoot().main}
            area="main"
          />
        </div>
        <SidebarRenderer
          node={activeRoot().right}
          side="right"
        />
      </div>
      <StatusBar />
      <Show when={showSettings()}>
        <Settings onClose={() => setShowSettings(false)} />
      </Show>
      <ContextMenu />
      <ToastContainer />
      <ConfirmModal />
      <ConflictModal />
      <TemplatePicker />
      <LoadingOverlay />
    </div>
  )
}
