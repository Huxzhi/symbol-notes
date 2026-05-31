import { createMemo, For, Show } from 'solid-js'
import { activeFilePath, activeLayout, workspaceActions } from '../../stores/workspaceStore'
import { vaultStore } from '../../stores/vaultStore'
import { runtimeStore } from '../../stores/runtimeStore'
import { definePlugin } from '../../lib/pluginRegistry'
import { buildStemIndex, resolveLink } from '../../lib/knowledgeUtils'

function LinksPanel() {
  const activeLeafRuntime = () => {
    const { activeLeafId } = activeLayout()
    return activeLeafId ? runtimeStore.leafInstances[activeLeafId] : null
  }

  const outLinks = createMemo(() => activeLeafRuntime()?.outLinks ?? [])

  const stemIndex = createMemo(() => buildStemIndex(vaultStore.files))

  const resolveOutLink = (link: { type: 'wiki' | 'md'; target: string }) => {
    if (link.type !== 'wiki') return null
    const target = link.target.endsWith('.md') ? link.target : `${link.target}.md`
    return resolveLink(target, stemIndex(), vaultStore.files)
  }

  const backlinks = createMemo(() => {
    const path = activeFilePath()
    if (!path) return []
    const aliases = vaultStore.files[path]?.aliases ?? []
    // backlinkMap[path] covers stem-resolved links; alias keys cover [[Alias Name]] links
    const keys = [path, ...aliases.map((a) => `${a}.md`)]
    const seen = new Set<string>()
    const result: string[] = []
    for (const key of keys) {
      for (const bl of vaultStore.backlinkMap[key] ?? []) {
        if (!seen.has(bl)) { seen.add(bl); result.push(bl) }
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
        {(link) => {
          const resolved = () => resolveOutLink(link)
          return (
            <div
              class={`py-0.5 min-w-0 ${resolved() ? 'cursor-pointer hover:bg-(--bg-2) rounded px-1 -mx-1' : 'opacity-50'}`}
              onClick={() => { const p = resolved(); if (p) workspaceActions.openFile(p) }}
            >
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
          )
        }}
      </For>
      <div class="text-(--text-3) text-[10px] uppercase tracking-widest mt-3 mb-1.5">
        入链 ({backlinks().length})
      </div>
      <For each={backlinks()}>
        {(link) => (
          <div
            class="text-(--link-2) py-0.5 flex items-center gap-1 cursor-pointer hover:bg-(--bg-2) rounded px-1 -mx-1"
            onClick={() => workspaceActions.openFile(link)}
          >
            <span class="text-(--accent) text-[10px]">↙</span>
            <span class="truncate">{link.split('/').pop()?.replace(/\.md$/, '') ?? link}</span>
          </div>
        )}
      </For>
      <Show when={outLinks().length === 0 && backlinks().length === 0}>
        <div class="text-(--text-4) italic mt-1">暂无链接</div>
      </Show>
    </div>
  )
}

export const LinksPlugin = definePlugin({
  id: 'links',
  name: '链接',
  core: true,
  setup(ctx) {
    ctx.view({
      kind: 'panel',
      position: 'right',
      type: 'links',
      getDisplayText: () => '链接',
      component: LinksPanel,
    })
  },
})
