import { FolderOpen } from 'lucide-solid'
import { fileActions } from '../../../commands'
import {
  registerContextMenu,
  registerRibbonItem,
  registerView,
} from '../../../lib/pluginRegistry'
import {
  activeSidebarType,
  workspaceActions,
} from '../../../stores/workspaceStore'
import { beginCreate, beginRename } from './fileOpStore'
import { FilesPanel } from './FilesPanel'

// 文件列表是内核 shell（恒在、不可关闭），不走插件生命周期、不进设置开关。
// 启动时由 App 直接调用本函数注册；越层直连 vault/fileManager/stores 是合法的（内核身份）。
export function registerFilesView(): void {
  registerView({
    kind: 'panel',
    position: 'left',
    type: 'files',
    getDisplayText: () => '文件',
    component: FilesPanel,
  })

  registerRibbonItem({
    id: 'files',
    title: '文件列表',
    getIcon: () => <FolderOpen size={18} />,
    onClick: () => workspaceActions.switchSidebarPanel('left', 'files'),
    isActive: () => activeSidebarType('left') === 'files',
  })

  registerContextMenu('file', (d) => {
    const path = d.path!
    return [
      { label: '重命名', action: () => beginRename(path) },
      { separator: true as const },
      {
        label: '删除',
        action: () => {
          if (confirm(`删除 ${path.split('/').pop()}？`))
            void fileActions.deleteFile(path)
        },
      },
    ]
  })

  registerContextMenu('directory', (d) => {
    const path = d.path!
    return [
      { label: '新建文件', action: () => beginCreate('file', path + '/') },
      { label: '新建文件夹', action: () => beginCreate('folder', path + '/') },
      { separator: true as const },
      {
        label: '删除文件夹',
        action: () => {
          if (confirm(`删除文件夹 ${path.split('/').pop()}？`))
            void fileActions.deleteFolder(path)
        },
      },
    ]
  })
}
