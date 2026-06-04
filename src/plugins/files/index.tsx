import { FolderOpen } from 'lucide-solid'
import { definePlugin } from '../../lib/pluginRegistry'
import { beginCreate, beginRename } from './fileOpStore'
import { FilesPanel } from './FilesPanel'

export const FilesPlugin = definePlugin({
  id: 'files',
  name: '文件列表',
  core: true,
  setup(ctx) {
    ctx.view({
      kind: 'panel',
      position: 'left',
      type: 'files',
      getDisplayText: () => '文件',
      component: FilesPanel,
    })

    ctx.ribbon({
      id: 'files',
      title: '文件列表',
      getIcon: () => <FolderOpen size={18} />,
      onClick: () => ctx.workspace.switchSidebarPanel('left', 'files'),
      isActive: () => ctx.workspace.activeSidebarType('left') === 'files',
    })

    ctx.contextMenu('file', (d) => {
      const path = d.path!
      return [
        { label: '重命名', action: () => beginRename(path) },
        { separator: true as const },
        { label: '删除', action: () => { if (confirm(`删除 ${path.split('/').pop()}？`)) void ctx.vault.deleteFile(path) } },
      ]
    })

    ctx.contextMenu('directory', (d) => {
      const path = d.path!
      return [
        { label: '新建文件', action: () => beginCreate('file', path + '/') },
        { label: '新建文件夹', action: () => beginCreate('folder', path + '/') },
        { separator: true as const },
        { label: '删除文件夹', action: () => { if (confirm(`删除文件夹 ${path.split('/').pop()}？`)) void ctx.vault.deleteFolder(path) } },
      ]
    })
  },
})
