import { onMount } from 'solid-js'
import { Ribbon } from './components/Ribbon'
import { Sidebar } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { PropertiesPanel } from './components/PropertiesPanel'
import { Editor } from './components/Editor'
import { RightPanel } from './components/RightPanel'
import { StatusBar } from './components/StatusBar'
import { restoreDirectory } from './services/fileSystemService'
import { uiStore } from './stores/uiStore'

export default function App() {
  onMount(async () => {
    await restoreDirectory()
  })

  return (
    <div class="h-full flex flex-col bg-[#0f0f1c] text-white overflow-hidden">
      <div class="flex flex-1 overflow-hidden">
        <Ribbon />
        <div class={`transition-all duration-200 overflow-hidden ${uiStore.showLeft ? 'w-[190px]' : 'w-0'}`}>
          <Sidebar />
        </div>
        <div class="flex-1 flex flex-col overflow-hidden min-w-0">
          <TabBar />
          <div class="flex-1 flex flex-col overflow-hidden">
            <PropertiesPanel />
            <Editor />
          </div>
        </div>
        <div class={`transition-all duration-200 overflow-hidden ${uiStore.showRight ? 'w-[200px]' : 'w-0'}`}>
          <RightPanel />
        </div>
      </div>
      <StatusBar />
    </div>
  )
}
