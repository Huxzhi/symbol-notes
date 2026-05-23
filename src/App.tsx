import { createEffect, onMount, Show } from 'solid-js'
import { Ribbon } from './components/Ribbon'
import { Sidebar } from './components/Sidebar'
import { CalendarPanel } from './components/CalendarPanel'
import { CalendarPage } from './components/CalendarPage'
import { TabBar } from './components/TabBar'
import { Editor } from './components/Editor'
import { RightPanel } from './components/RightPanel'
import { StatusBar } from './components/StatusBar'
import { Settings } from './components/Settings'
import { FileTitle } from './components/FileTitle'
import { restoreDirectory } from './services/fileSystemService'
import { uiStore } from './stores/uiStore'

const customStyleEl = document.createElement('style')
document.head.appendChild(customStyleEl)

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
        <div class={`transition-all duration-200 overflow-hidden ${uiStore.showLeft ? 'w-47.5' : 'w-0'}`}>
          <Show when={uiStore.sidebarView === 'calendar'} fallback={<Sidebar />}>
            <CalendarPanel />
          </Show>
        </div>
        <div class="flex-1 flex flex-col overflow-hidden min-w-0">
          <Show when={uiStore.mainView === 'editor'} fallback={<CalendarPage />}>
            <TabBar />
            <FileTitle />
            <div class="flex-1 flex flex-col overflow-hidden">
              <Editor />
            </div>
          </Show>
        </div>
        <div class={`transition-all duration-200 overflow-hidden ${uiStore.showRight ? 'w-50' : 'w-0'}`}>
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
