import { runtimeStore, setRuntimeStore } from '../stores/runtimeStore'
import { fsActions } from './fsActions'
import { workspaceActions } from './workspaceActions'

export const fileOpActions = {
  startCreate(mode: 'file' | 'folder', prefix = ''): void {
    setRuntimeStore('fileOp', {
      type: mode === 'file' ? 'create-file' : 'create-folder',
      prefix,
    })
  },

  startRename(path: string): void {
    setRuntimeStore('fileOp', { type: 'rename', path })
  },

  cancel(): void {
    setRuntimeStore('fileOp', null)
  },

  async confirmCreate(name: string): Promise<void> {
    const op = runtimeStore.fileOp
    if (!op || (op.type !== 'create-file' && op.type !== 'create-folder')) return
    setRuntimeStore('fileOp', null)
    if (op.type === 'create-file') {
      const path = await fsActions.createFile(name)
      if (path) workspaceActions.openFile(path, { newTab: true, pin: true })
    } else {
      await fsActions.createDirectory(name)
    }
  },

  async confirmRename(path: string, newName: string): Promise<void> {
    setRuntimeStore('fileOp', null)
    await fsActions.renameFile(path, newName)
  },
}
