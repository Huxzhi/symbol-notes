import { definePlugin } from '../../lib/pluginRegistry'
import { workspaceActions, activeLayout } from '../../stores/workspaceStore'
import { EditorViewer } from './EditorViewer'
import { ImageViewer } from './ImageViewer'

const IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif',
])

export const EditorPlugin = definePlugin({
  id: 'editor',
  name: '编辑器',
  core: true,
  setup(ctx) {
    ctx.view({
      kind: 'file',
      type: 'markdown',
      getDisplayText: (p) => p.split('/').pop()!,
      canAcceptFile: (p) => p.endsWith('.md'),
      component: EditorViewer,
    })

    ctx.view({
      kind: 'file',
      type: 'image',
      getDisplayText: (p) => p.split('/').pop()!,
      canAcceptFile: (path) => IMAGE_EXTS.has(path.slice(path.lastIndexOf('.'))),
      component: ImageViewer,
    })

    ctx.contextMenu('tab', (d) => {
      const leafId = d.leafId!
      const tabsId = d.tabsId!
      const root = activeLayout().root
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function findTabs(node: any): any {
        if (node.type === 'tabs' && node.id === tabsId) return node
        if (node.type === 'split') for (const c of node.children) { const f = findTabs(c); if (f) return f }
        return null
      }
      const tabs = findTabs(root.main)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const siblings: any[] = tabs?.children ?? []
      const idx = siblings.findIndex((l: any) => l.id === leafId)
      return [
        { label: '关闭', action: () => workspaceActions.closeLeaf(leafId) },
        { label: '关闭其他', action: () => workspaceActions.closeOtherLeaves(tabsId, leafId), disabled: siblings.length <= 1 },
        { label: '关闭右侧', action: () => workspaceActions.closeRightLeaves(tabsId, leafId), disabled: idx >= siblings.length - 1 },
      ]
    })
  },
})
