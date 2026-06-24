import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import { vaultStore, getStemIndex, getAliasIndex } from '../../vault'
import { readFile } from '../../vault/io'
import { resolveLink } from '../../vault/backlinks'
import { workspaceActions } from '../../stores/workspaceStore'
import type { ViewComponentProps } from '../../stores/types'
import { buildNeighborhood, type Neighborhood } from './selection'
import { deriveEvents, edgesByNote, type TimelineEvent } from './events'
import { assignColumns, type Column, type ColumnFilter } from './columns'
import { extractPreview, type NotePreview } from './preview'

export function TimelineView(props: ViewComponentProps) {
  const focus = createMemo(() => (props.viewState.focus as string) ?? '')

  const [maxFiles, setMaxFiles] = createSignal(20)
  const [columns, setColumns] = createSignal<Column[]>([
    { filter: null, priority: 0, repeat: false },
  ])

  const neighborhood = createMemo<Neighborhood>(() => {
    const f = focus()
    if (!f) return { notes: [], edges: [] }
    const files = vaultStore.files
    const resolve = (target: string) =>
      resolveLink(target, getStemIndex(), files, getAliasIndex())
    return buildNeighborhood(f, files, vaultStore.backlinkMap, resolve, {
      maxFiles: maxFiles(),
    })
  })

  const events = createMemo<TimelineEvent[]>(() =>
    deriveEvents(neighborhood(), vaultStore.files),
  )

  // 按列归类：每个 bucket 是该列内按时间排序的事件
  const cols = createMemo<TimelineEvent[][]>(() => {
    const evs = events()
    const byNote = edgesByNote(neighborhood().edges)
    const buckets = assignColumns(evs.map((e) => e.path), byNote, columns())
    const byPath = new Map(evs.map((e) => [e.path, e]))
    return buckets.map((ids) =>
      ids.map((id) => byPath.get(id)).filter((e): e is TimelineEvent => !!e),
    )
  })

  // 可选过滤值：邻域里出现过的所有标题 / 标签
  const headingOptions = createMemo(() => [
    ...new Set(neighborhood().edges.flatMap((e) => e.headingPath)),
  ])
  const tagOptions = createMemo(() => [
    ...new Set(neighborhood().edges.flatMap((e) => e.lineTags)),
  ])

  // 异步把首图/首段补进 path → preview 映射
  const [previews] = createResource(events, async (evs) => {
    const map: Record<string, NotePreview> = {}
    await Promise.all(
      evs.map(async (e) => {
        try {
          map[e.path] = extractPreview(await readFile(e.path))
        } catch {
          map[e.path] = {}
        }
      }),
    )
    return map
  })

  // ── 列配置编辑 ────────────────────────────────────────────────────────────
  function updateColumn(i: number, patch: Partial<Column>): void {
    setColumns((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  }
  function setBy(i: number, by: string): void {
    let filter: ColumnFilter = null
    if (by === 'heading') filter = { by: 'heading', value: headingOptions()[0] ?? '' }
    else if (by === 'tag') filter = { by: 'tag', value: tagOptions()[0] ?? '' }
    else if (by === 'direction') filter = { by: 'direction', value: 'out' }
    updateColumn(i, { filter })
  }
  function setValue(i: number, value: string): void {
    const f = columns()[i].filter
    if (!f) return
    updateColumn(i, { filter: { ...f, value } as ColumnFilter })
  }
  function addColumn(): void {
    setColumns((cs) => [...cs, { filter: null, priority: cs.length, repeat: false }])
  }
  function removeColumn(i: number): void {
    setColumns((cs) => (cs.length <= 1 ? cs : cs.filter((_, idx) => idx !== i)))
  }

  function openCard(ev: TimelineEvent): void {
    const f = focus()
    if (ev.path === f) { workspaceActions.openFile(ev.path); return }
    const inEdge = neighborhood().edges.find(
      (e) => e.dir === 'in' && e.from === ev.path && e.to === f,
    )
    if (inEdge) {
      workspaceActions.openFileAt(ev.path, {
        kind: 'wikilink',
        targetStem: stemOf(f),
        headingPath: inEdge.headingPath,
      })
    } else {
      workspaceActions.openFile(ev.path)
    }
  }

  return (
    <div class="h-full overflow-auto p-6 bg-(--bg-base)">
      <Show
        when={focus()}
        fallback={<EmptyHint text="未指定焦点笔记。右键某篇笔记 → 在时间线中查看。" />}
      >
        <h2 class="text-[15px] font-medium t-base mb-1">
          时间线：{stemOf(focus())}
        </h2>
        <p class="text-[12px] t-3 mb-3">
          焦点笔记 BFS 邻域，沿创建日排列（共 {events().length} 篇）
        </p>

        {/* 配置栏 */}
        <div class="flex flex-wrap items-center gap-3 mb-4 text-[12px] t-2">
          <label class="flex items-center gap-1">
            最多遍历
            <input
              type="number"
              min={1}
              value={maxFiles()}
              onInput={(e) => setMaxFiles(Math.max(1, +e.currentTarget.value || 1))}
              class="w-16 px-1 py-0.5 rounded border border-(--border) bg-(--bg-base)"
            />
            篇
          </label>
          <For each={columns()}>
            {(col, i) => (
              <div class="flex items-center gap-1 px-2 py-1 rounded border border-(--border)">
                <select
                  class="bg-(--bg-base) border border-(--border) rounded px-1"
                  value={col.filter?.by ?? 'none'}
                  onChange={(e) => setBy(i(), e.currentTarget.value)}
                >
                  <option value="none">全部</option>
                  <option value="heading">标题</option>
                  <option value="tag">标签</option>
                  <option value="direction">方向</option>
                </select>
                <Show when={col.filter && col.filter.by !== 'direction'}>
                  <select
                    class="bg-(--bg-base) border border-(--border) rounded px-1 max-w-28"
                    value={(col.filter as { value: string }).value}
                    onChange={(e) => setValue(i(), e.currentTarget.value)}
                  >
                    <For each={col.filter!.by === 'heading' ? headingOptions() : tagOptions()}>
                      {(v) => <option value={v}>{v}</option>}
                    </For>
                  </select>
                </Show>
                <Show when={col.filter?.by === 'direction'}>
                  <select
                    class="bg-(--bg-base) border border-(--border) rounded px-1"
                    value={(col.filter as { value: string }).value}
                    onChange={(e) => setValue(i(), e.currentTarget.value)}
                  >
                    <option value="out">出链</option>
                    <option value="in">入链</option>
                  </select>
                </Show>
                <label class="flex items-center gap-0.5" title="优先级（小者先抢）">
                  优
                  <input
                    type="number"
                    value={col.priority}
                    onInput={(e) => updateColumn(i(), { priority: +e.currentTarget.value || 0 })}
                    class="w-10 px-1 rounded border border-(--border) bg-(--bg-base)"
                  />
                </label>
                <label class="flex items-center gap-0.5" title="允许在多列重复显示">
                  <input
                    type="checkbox"
                    checked={col.repeat}
                    onChange={(e) => updateColumn(i(), { repeat: e.currentTarget.checked })}
                  />
                  重复
                </label>
                <button
                  class="t-3 hover:t-base px-1"
                  title="删除此列"
                  onClick={() => removeColumn(i())}
                >
                  ✕
                </button>
              </div>
            )}
          </For>
          <button
            class="px-2 py-1 rounded border border-(--border) hover:border-(--accent)"
            onClick={addColumn}
          >
            + 列
          </button>
        </div>

        <Show
          when={events().length > 0}
          fallback={<EmptyHint text="这篇笔记暂无关联笔记。" />}
        >
          <div class="flex gap-6 items-start">
            <For each={cols()}>
              {(col, ci) => (
                <div class="flex-1 min-w-0">
                  <div class="text-[11px] t-3 mb-2 truncate">
                    {filterLabel(columns()[ci()]?.filter)}（{col.length}）
                  </div>
                  <ol class="relative border-l border-(--border) ml-3">
                    <For each={col}>
                      {(ev) => (
                        <li class="mb-5 ml-5">
                          <span class="absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full bg-(--accent)" />
                          <button
                            class="block text-left w-full rounded border border-(--border) bg-(--bg-base) hover:border-(--accent) p-3 transition-colors"
                            onClick={() => openCard(ev)}
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
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  )
}

function filterLabel(f: ColumnFilter | undefined): string {
  if (!f) return '全部'
  if (f.by === 'diary') return '日记'
  if (f.by === 'heading') return `标题：${f.value}`
  if (f.by === 'tag') return `#${f.value}`
  return f.value === 'out' ? '出链' : '入链'
}

function EmptyHint(props: { text: string }) {
  return <div class="text-[12px] t-3 p-4">{props.text}</div>
}

function stemOf(path: string): string {
  return path.split('/').pop()!.replace(/\.md$/, '')
}
