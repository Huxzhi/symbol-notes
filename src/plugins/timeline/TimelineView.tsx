import { createMemo, createResource, For, Show } from 'solid-js'
import { vaultStore, getStemIndex, getAliasIndex } from '../../vault'
import { readFile } from '../../vault/io'
import { resolveLink } from '../../vault/backlinks'
import { workspaceActions } from '../../stores/workspaceStore'
import type { ViewComponentProps } from '../../stores/types'
import { buildSelection } from './selection'
import { deriveEvents, type TimelineEvent } from './events'
import { extractPreview, type NotePreview } from './preview'

export function TimelineView(props: ViewComponentProps) {
  const focus = createMemo(() => (props.viewState.focus as string) ?? '')

  const events = createMemo<TimelineEvent[]>(() => {
    const f = focus()
    if (!f) return []
    const files = vaultStore.files
    const resolve = (target: string) =>
      resolveLink(target, getStemIndex(), files, getAliasIndex())
    const selection = buildSelection(f, files, vaultStore.backlinkMap, resolve)
    return deriveEvents(selection, files)
  })

  // 异步把首图/首段补进 path → preview 映射
  const [previews] = createResource(events, async (evs) => {
    const map: Record<string, NotePreview> = {}
    await Promise.all(
      evs.map(async (e) => {
        try {
          const content = await readFile(e.path)
          map[e.path] = extractPreview(content)
        } catch {
          map[e.path] = {}
        }
      }),
    )
    return map
  })

  return (
    <div class="h-full overflow-auto p-6 bg-(--bg-base)">
      <Show
        when={focus()}
        fallback={<EmptyHint text="未指定焦点笔记。右键某篇笔记 → 在时间线中查看。" />}
      >
        <h2 class="text-[15px] font-medium t-base mb-1">
          时间线：{stemOf(focus())}
        </h2>
        <p class="text-[12px] t-3 mb-5">
          焦点笔记 1 跳邻域，沿创建日排列（共 {events().length} 篇）
        </p>
        <Show
          when={events().length > 0}
          fallback={<EmptyHint text="这篇笔记暂无关联笔记。" />}
        >
          <ol class="relative border-l border-(--border) ml-3">
            <For each={events()}>
              {(ev) => (
                <li class="mb-5 ml-5">
                  <span class="absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full bg-(--accent)" />
                  <button
                    class="block text-left w-full rounded border border-(--border) bg-(--bg-base) hover:border-(--accent) p-3 transition-colors"
                    onClick={() => workspaceActions.openFile(ev.path)}
                  >
                    <div class="flex items-baseline gap-2">
                      <time class="text-[11px] t-3 shrink-0">{ev.date}</time>
                      <span class="text-[13px] t-base font-medium truncate">
                        {ev.title}
                      </span>
                      <Show when={ev.path === focus()}>
                        <span class="text-[10px] px-1 rounded bg-(--accent) text-white">
                          焦点
                        </span>
                      </Show>
                    </div>
                    <Show when={ev.span}>
                      <div class="text-[10px] t-3 mt-0.5">
                        {ev.span![0]} → {ev.span![1]}
                      </div>
                    </Show>
                    <Show when={previews()?.[ev.path]?.thumbnail}>
                      <img
                        src={previews()![ev.path].thumbnail}
                        alt=""
                        class="mt-2 max-h-28 rounded object-cover"
                        onError={(e) => (e.currentTarget.style.display = 'none')}
                      />
                    </Show>
                    <Show when={previews()?.[ev.path]?.snippet}>
                      <p class="text-[12px] t-2 mt-1.5 line-clamp-2">
                        {previews()![ev.path].snippet}
                      </p>
                    </Show>
                    <div class="flex items-center gap-2 mt-2">
                      <For each={ev.tags}>
                        {(t) => (
                          <span class="text-[10px] px-1.5 rounded bg-(--bg-hover) t-3">
                            #{t}
                          </span>
                        )}
                      </For>
                      <Show when={ev.linkCount > 0}>
                        <span class="text-[10px] t-3 ml-auto">
                          {ev.linkCount} 关联
                        </span>
                      </Show>
                    </div>
                  </button>
                </li>
              )}
            </For>
          </ol>
        </Show>
      </Show>
    </div>
  )
}

function EmptyHint(props: { text: string }) {
  return <div class="text-[12px] t-3 p-4">{props.text}</div>
}

function stemOf(path: string): string {
  return path.split('/').pop()!.replace(/\.md$/, '')
}
