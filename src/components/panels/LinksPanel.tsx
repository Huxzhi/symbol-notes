import { createMemo, For, Show } from 'solid-js'
import { activeFilePath, activeLayout } from '../../stores/workspaceStore'
import { cacheStore } from '../../stores/cacheStore'
import { runtimeStore } from '../../stores/runtimeStore'

export function LinksPanel() {
  const activeLeafRuntime = () => {
    const { activeLeafId } = activeLayout()
    return activeLeafId ? runtimeStore.leafInstances[activeLeafId] : null
  }

  const outLinks = createMemo(() => activeLeafRuntime()?.outLinks ?? [])

  const backlinks = createMemo(() => {
    const path = activeFilePath()
    if (!path) return []
    const aliases = cacheStore.files[path]?.aliases ?? []
    const keys = [path, ...aliases, ...aliases.map((a) => `${a}.md`)]
    const seen = new Set<string>()
    const result: string[] = []
    for (const key of keys) {
      for (const bl of cacheStore.backlinkMap[key] ?? []) {
        if (!seen.has(bl)) {
          seen.add(bl)
          result.push(bl)
        }
      }
    }
    return result
  })

  return (
    <div class="p-2 text-[11px]">
      <div class="text-(--text-3) text-[10px] uppercase tracking-widest mb-1.5">
        出链 ({outLinks().length})
      </div>
      <For each={outLinks()}>
        {(link) => (
          <div class="py-0.5 min-w-0">
            <div
              class={`flex items-center gap-1 ${link.type === 'wiki' ? 'text-(--link)' : 'text-(--link-2)'}`}
            >
              <span class="text-(--accent) text-[10px] shrink-0">↗</span>
              <span class="truncate">{link.label}</span>
            </div>
            <Show when={link.label !== link.target}>
              <div class="text-(--text-4) text-[9px] truncate pl-4 mt-0.5">
                {link.target}
              </div>
            </Show>
          </div>
        )}
      </For>
      <div class="text-(--text-3) text-[10px] uppercase tracking-widest mt-3 mb-1.5">
        入链 ({backlinks().length})
      </div>
      <For each={backlinks()}>
        {(link) => (
          <div class="text-(--link-2) py-0.5 flex items-center gap-1">
            <span class="text-(--accent) text-[10px]">↙</span> {link}
          </div>
        )}
      </For>
      <Show when={outLinks().length === 0 && backlinks().length === 0}>
        <div class="text-(--text-4) italic mt-1">暂无链接</div>
      </Show>
    </div>
  )
}
