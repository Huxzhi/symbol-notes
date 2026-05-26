import { createMemo, For, Show } from 'solid-js'
import { activeFilePath } from '../../stores/workspaceStore'
import { cacheStore } from '../../stores/cacheStore'

export function TagsPanel() {
  const tags = createMemo(() => {
    const path = activeFilePath()
    return path ? (cacheStore.files[path]?.tags ?? []) : []
  })

  return (
    <div class="p-2 text-[11px]">
      <div class="flex flex-wrap gap-1.5 mt-1">
        <For each={tags()}>
          {(tag) => (
            <span class="bg-(--accent-bg) border border-(--accent-bg) text-(--link-2) text-[10px] px-2 py-0.5 rounded-full">
              #{tag}
            </span>
          )}
        </For>
      </div>
      <Show when={tags().length === 0}>
        <div class="text-(--text-4) italic mt-1">暂无标签</div>
      </Show>
    </div>
  )
}
