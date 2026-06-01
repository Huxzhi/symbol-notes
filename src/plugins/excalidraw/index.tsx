import { PenLine } from 'lucide-solid'
import { definePlugin } from '../../lib/pluginRegistry'
import { fileActions } from '../../stores/runtimeStore'
import { vaultStore } from '../../stores/vaultStore'
import { workspaceActions } from '../../stores/workspaceStore'
import { writeFile } from '../../services/fileIO'
import { EMPTY_EXCALIDRAW_MD } from './excalidrawFormat'
import { ExcalidrawViewer } from './ExcalidrawViewer'

function getUniqueName(dirPath: string | null): string {
  const prefix = dirPath ? `${dirPath}/` : ''
  if (!vaultStore.files[`${prefix}Untitled.excalidraw.md`]) return 'Untitled.excalidraw.md'
  for (let i = 1; i <= 99; i++) {
    const name = `Untitled ${i}.excalidraw.md`
    if (!vaultStore.files[`${prefix}${name}`]) return name
  }
  return `Untitled ${Date.now()}.excalidraw.md`
}

async function createExcalidrawFile(dirPath: string | null): Promise<void> {
  const name = getUniqueName(dirPath)
  const fullName = dirPath ? `${dirPath}/${name}` : name
  const path = await fileActions.createFile(fullName)
  if (!path) return
  await writeFile(path, EMPTY_EXCALIDRAW_MD)
  workspaceActions.openFile(path)
}

export const ExcalidrawPlugin = definePlugin({
  id: 'excalidraw',
  name: 'Excalidraw',
  description: 'Excalidraw 绘图编辑器',
  defaultEnabled: true,
  setup(ctx) {
    ctx.view({
      kind: 'file',
      type: 'excalidraw',
      getDisplayText: (p) => {
        const name = p.split('/').pop() ?? p
        if (name.endsWith('.excalidraw.md')) return name.slice(0, -14)
        if (name.endsWith('.excalidraw')) return name.slice(0, -11)
        return name
      },
      canAcceptFile: (p) => p.endsWith('.excalidraw.md') || p.endsWith('.excalidraw'),
      component: ExcalidrawViewer,
    })

    ctx.ribbon({
      id: 'new-excalidraw',
      title: '新建 Excalidraw 绘图',
      getIcon: () => <PenLine size={18} />,
      onClick: () => void createExcalidrawFile(null),
    })

    ctx.contextMenu('directory', (d) => {
      const dirPath = (d.path as string) ?? null
      return [
        { label: '新建 Excalidraw 绘图', action: () => void createExcalidrawFile(dirPath) },
      ]
    })
  },
})
