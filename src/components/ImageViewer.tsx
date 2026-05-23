import { createEffect, createSignal, onCleanup, Show } from 'solid-js'
import { fileSystemStore } from '../stores/fileSystemStore'

async function resolveFileHandle(path: string, root: FileSystemDirectoryHandle): Promise<FileSystemFileHandle> {
  const parts = path.split('/')
  let dir: FileSystemDirectoryHandle = root
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i])
  }
  return dir.getFileHandle(parts[parts.length - 1])
}

export function ImageViewer(props: { path: string }) {
  const [url, setUrl] = createSignal<string | null>(null)
  const [error, setError] = createSignal(false)

  createEffect(() => {
    const path = props.path
    const root = fileSystemStore.rootHandle
    if (!root) return

    let objectUrl: string | null = null
    setError(false)
    setUrl(null)

    resolveFileHandle(path, root)
      .then(handle => handle.getFile())
      .then(file => {
        objectUrl = URL.createObjectURL(file)
        setUrl(objectUrl)
      })
      .catch(() => setError(true))

    onCleanup(() => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    })
  })

  const fileName = () => props.path.split('/').pop() ?? props.path

  return (
    <div class="flex-1 flex flex-col overflow-hidden bg-[var(--bg-base)]">
      {/* Title bar */}
      <div class="h-9 px-4 flex items-center border-b border-[var(--border)] shrink-0">
        <span class="text-[12px] text-[var(--text-2)] truncate">{fileName()}</span>
      </div>

      {/* Image area */}
      <div class="flex-1 flex items-center justify-center overflow-auto p-6">
        <Show when={!error()} fallback={
          <div class="text-[12px] text-[var(--text-4)]">无法加载图片</div>
        }>
          <Show when={url()} fallback={
            <div class="text-[12px] text-[var(--text-4)]">加载中…</div>
          }>
            <img
              src={url()!}
              alt={fileName()}
              class="max-w-full max-h-full object-contain rounded shadow-sm select-none"
              draggable={false}
            />
          </Show>
        </Show>
      </div>
    </div>
  )
}
