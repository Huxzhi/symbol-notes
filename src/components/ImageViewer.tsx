import { createEffect, createResource, Match, onCleanup, Switch } from 'solid-js'
import { runtimeStore } from '../stores/runtimeStore'
import type { ViewComponentProps } from '../stores/types'

async function getObjectUrl(
  path: string,
  root: FileSystemDirectoryHandle,
): Promise<string> {
  const parts = path.split('/')
  let dir: FileSystemDirectoryHandle = root
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i])
  }
  const handle = await dir.getFileHandle(parts[parts.length - 1])
  const file = await handle.getFile()
  return URL.createObjectURL(file)
}

export function ImageViewer(props: ViewComponentProps) {
  const path = () => props.viewState.file as string | undefined

  const [objectUrl] = createResource(
    () => {
      const p = path()
      const root = runtimeStore.rootHandle
      return p && root ? { path: p, root } : null
    },
    ({ path, root }) => getObjectUrl(path, root),
  )

  createEffect(() => {
    const url = objectUrl()
    if (url) onCleanup(() => URL.revokeObjectURL(url))
  })

  const fileName = () => path()?.split('/').pop() ?? ''

  return (
    <div class="flex-1 flex flex-col overflow-hidden bg-(--bg-base)">
      <div class="h-9 px-4 flex items-center border-b border-(--border) shrink-0">
        <span class="text-[12px] text-(--text-2) truncate">{fileName()}</span>
      </div>
      <div class="flex-1 flex items-center justify-center overflow-auto p-6">
        <Switch>
          <Match when={objectUrl.error}>
            <div class="text-[12px] text-(--text-4)">无法加载图片</div>
          </Match>
          <Match when={objectUrl.loading}>
            <div class="text-[12px] text-(--text-4)">加载中…</div>
          </Match>
          <Match when={objectUrl()}>
            <img
              src={objectUrl()!}
              alt={fileName()}
              class="max-w-full max-h-full object-contain rounded shadow-sm select-none"
              draggable={false}
            />
          </Match>
        </Switch>
      </div>
    </div>
  )
}
