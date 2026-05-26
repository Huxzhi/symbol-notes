import { CalendarRange } from 'lucide-solid'
import { createEffect, onMount, Show } from 'solid-js'
import { appActions } from './actions/appActions'
import { fileActions } from './actions/fileActions'
import { workspaceActions } from './actions/workspaceActions'
import { CalendarPanel } from './components/panels/CalendarPanel'
import { FilesPanel } from './components/panels/FilesPanel'
import { LinksPanel } from './components/panels/LinksPanel'
import { OutlinePanel } from './components/panels/OutlinePanel'
import { TagsPanel } from './components/panels/TagsPanel'
import { Ribbon } from './components/Ribbon'
import { Settings } from './components/Settings'
import { StatusBar } from './components/StatusBar'
import { ContextMenu } from './components/ContextMenu'
import { CalendarViewer } from './components/viewer/CalendarViewer'
import { EditorViewer } from './components/viewer/EditorViewer'
import { ImageViewer } from './components/viewer/ImageViewer'
import { SidebarRenderer } from './components/workspace/SidebarRenderer'
import { WorkspaceNodeRenderer } from './components/workspace/WorkspaceNodeRenderer'
import { syncToStorage } from './lib/localStorage'
import { registerContextMenu } from './lib/contextMenuRegistry'
import { registerView } from './lib/viewRegistry'
import { activeLayout, activeRoot, globalStore } from './stores/globalStore'

const customStyleEl = document.createElement('style')
document.head.appendChild(customStyleEl)

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

// ── Context menu factories ────────────────────────────────────────────────────

registerContextMenu('tab', (d) => {
  const leafId = d.leafId!
  const tabsId = d.tabsId!
  const root = activeLayout().root
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function findTabs(node: any): any {
    if (node.type === 'tabs' && node.id === tabsId) return node
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (node.type === 'split') for (const c of node.children) { const f = findTabs(c); if (f) return f }
    return null
  }
  const tabs = findTabs(root.main)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const siblings: any[] = tabs?.children ?? []
  const idx = siblings.findIndex((l) => l.id === leafId)
  return [
    { label: '关闭', action: () => workspaceActions.closeLeaf(leafId) },
    { label: '关闭其他', action: () => workspaceActions.closeOtherLeaves(tabsId, leafId), disabled: siblings.length <= 1 },
    { label: '关闭右侧', action: () => workspaceActions.closeRightLeaves(tabsId, leafId), disabled: idx >= siblings.length - 1 },
  ]
})

registerContextMenu('file', (d) => {
  const path = d.path!
  return [
    { label: '重命名', action: () => fileActions.beginRename(path) },
    { separator: true as const },
    { label: '删除', action: () => { if (confirm(`删除 ${path.split('/').pop()}？`)) void fileActions.deleteFile(path) } },
  ]
})

registerContextMenu('directory', (d) => {
  const path = d.path!
  return [
    { label: '新建文件', action: () => fileActions.beginCreate('file', path + '/') },
    { label: '新建文件夹', action: () => fileActions.beginCreate('folder', path + '/') },
    { separator: true as const },
    { label: '删除文件夹', action: () => { if (confirm(`删除文件夹 ${path.split('/').pop()}？`)) void fileActions.deleteFolder(path) } },
  ]
})

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

  syncToStorage('sn-workspace', () => ({
    layouts: globalStore.workspace.layouts,
    activeLayoutId: globalStore.workspace.activeLayoutId,
  }))

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
      <ContextMenu />
    </div>
  )
}
