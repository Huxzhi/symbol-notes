import { createMemo, For, Show } from 'solid-js'
import type { OutLink, ViewComponentProps } from '../../lib/pluginRegistry'
import { definePlugin } from '../../lib/pluginRegistry'

export const LinksPlugin = definePlugin({
  id: 'links',
  name: '链接',
  core: true,
  setup(ctx) {
    function resolveOutLink(link: OutLink): string | null {
      if (link.type !== 'wiki') return null
      return ctx.vault.resolveLink(link.target)
    }

    function LinksPanel(_props: ViewComponentProps) {
      const outLinks = createMemo(() => ctx.workspace.activeOutLinks())

      const backlinks = createMemo(() => {
        const path = ctx.workspace.activeFilePath()
        return path ? ctx.vault.backlinks(path) : []
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
                  onClick={() => {
                    const p = resolved()
                    if (p) ctx.workspace.openFile(p)
                  }}
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
            {(path) => (
              <div
                class="text-(--link-2) py-0.5 flex items-center gap-1 cursor-pointer hover:bg-(--bg-2) rounded px-1 -mx-1"
                onClick={() => {
                  const focusPath = ctx.workspace.activeFilePath()
                  if (!focusPath) { ctx.workspace.openFile(path); return }
                  const focusStem = focusPath.split('/').pop()!.replace(/\.md$/, '')
                  const hit = ctx.vault
                    .files()[path]
                    ?.outLinks.find((l) => ctx.vault.resolveLink(l.target) === focusPath)
                  ctx.workspace.openFileAt(path, {
                    kind: 'wikilink',
                    targetStem: focusStem,
                    headingPath: hit?.headingPath,
                  })
                }}
              >
                <span class="text-(--accent) text-[10px]">↙</span>
                <span class="truncate">
                  {path.split('/').pop()?.replace(/\.md$/, '') ?? path}
                </span>
              </div>
            )}
          </For>

          <Show when={outLinks().length === 0 && backlinks().length === 0}>
            <div class="text-(--text-4) italic mt-1">暂无链接</div>
          </Show>
        </div>
      )
    }

    ctx.view({
      kind: 'panel',
      position: 'right',
      type: 'links',
      getDisplayText: () => '链接',
      component: LinksPanel,
    })
  },
})
