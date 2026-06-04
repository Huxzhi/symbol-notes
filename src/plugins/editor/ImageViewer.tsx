import {
  createEffect,
  createResource,
  Match,
  onCleanup,
  Switch,
} from 'solid-js'
import { vaultFs, getFile } from '../../vault'
import type { ViewComponentProps } from '../../stores/types'

export function ImageViewer(props: ViewComponentProps) {
  const path = () => props.viewState.file as string | undefined

  const [objectUrl] = createResource(
    () => {
      const p = path()
      return p && vaultFs() ? p : null
    },
    async (p) => {
      const file = await getFile(p)
      return URL.createObjectURL(file)
    },
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
