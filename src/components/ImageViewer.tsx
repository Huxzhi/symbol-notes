import { createResource, Match, Switch } from 'solid-js'
import { fileSystemStore } from '../stores/fileSystemStore'
import { uiStore } from '../stores/uiStore'

async function readImageDataUrl(
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
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function ImageViewer(props: { tabId: string; isActive: boolean }) {
  const path = () => uiStore.tabs[props.tabId]?.path ?? null

  const [dataUrl] = createResource(
    () => {
      const p = path()
      const root = fileSystemStore.rootHandle
      return p && root ? { path: p, root } : null
    },
    ({ path, root }) => readImageDataUrl(path, root),
  )

  const fileName = () => path()?.split('/').pop() ?? ''

  return (
    <div class="flex-1 flex flex-col overflow-hidden bg-[var(--bg-base)]">
      <div class="h-9 px-4 flex items-center border-b border-[var(--border)] shrink-0">
        <span class="text-[12px] text-[var(--text-2)] truncate">{fileName()}</span>
      </div>
      <div class="flex-1 flex items-center justify-center overflow-auto p-6">
        <Switch>
          <Match when={dataUrl.error}>
            <div class="text-[12px] text-[var(--text-4)]">无法加载图片</div>
          </Match>
          <Match when={dataUrl.loading}>
            <div class="text-[12px] text-[var(--text-4)]">加载中…</div>
          </Match>
          <Match when={dataUrl()}>
            <img
              src={dataUrl()!}
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
