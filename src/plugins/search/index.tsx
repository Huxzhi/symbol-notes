import { createMemo, For, Show } from 'solid-js'
import { cacheStore } from '../../stores/cacheStore'
import { workspaceActions } from '../../stores/workspaceStore'
import { definePlugin } from '../../lib/pluginRegistry'
import type { ViewComponentProps } from '../../stores/types'

function displayName(path: string): string {
  const name = path.split('/').pop() ?? path
  return name.endsWith('.md') ? name.slice(0, -3) : name
}

function SearchPanel(props: ViewComponentProps) {
  const tag = () => props.viewState.tag as string | undefined

  const results = createMemo(() => {
    const t = tag()
    if (!t) return []
    const paths = new Set<string>()
    for (const [k, files] of Object.entries(cacheStore.tagMap)) {
      if (k === t || k.startsWith(t + '/')) {
        for (const f of files) paths.add(f)
      }
    }
    return [...paths].sort()
  })

  return (
    <div class="flex flex-col h-full overflow-hidden">
      <div class="px-3 py-2 border-b border-(--border) text-[11px] shrink-0 flex items-center gap-1.5">
        <Show
          when={tag()}
          fallback={<span class="text-(--text-4) italic">未选择标签</span>}
        >
          <span class="text-(--text-4)">#</span>
          <span class="text-(--text)">{tag()}</span>
          <span class="ml-auto text-(--text-4)">{results().length}</span>
        </Show>
      </div>
      <div class="flex-1 overflow-y-auto py-1">
        <For each={results()}>
          {(path) => (
            <div
              class="px-3 py-0.5 text-[11px] cursor-pointer hover:bg-(--bg-hover) text-(--text-2) truncate"
              title={path}
              onClick={() => workspaceActions.openFile(path)}
            >
              {displayName(path)}
            </div>
          )}
        </For>
        <Show when={tag() && results().length === 0}>
          <div class="px-3 py-2 text-[11px] text-(--text-4) italic">无匹配文件</div>
        </Show>
      </div>
    </div>
  )
}

export const SearchPlugin = definePlugin({
  id: 'search',
  name: '搜索',
  core: true,
  setup(ctx) {
    ctx.view({
      kind: 'panel',
      position: 'right',
      type: 'search',
      getDisplayText: () => '搜索',
      component: SearchPanel,
    })
  },
})
