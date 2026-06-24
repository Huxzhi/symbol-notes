import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { vaultStore, getStemIndex, getAliasIndex, extractDateFromName } from '../../vault'
import { readFile } from '../../vault/fs/io'
import { resolveLink } from '../../vault/indexes/backlinks'
import { workspaceActions } from '../../stores/workspaceStore'
import type { ViewComponentProps } from '../../stores/types'
import { buildNeighborhood, type Neighborhood } from './selection'
import { deriveEvents, type TimelineEvent } from './events'
import { buildGrid } from './grid'
import { type Column, type ColumnFilter } from './columns'
import { extractPreview, type NotePreview } from './preview'

export function TimelineView(props: ViewComponentProps) {
  const focus = createMemo(() => (props.viewState.focus as string) ?? '')

  const isDiary = (p: string) => extractDateFromName(p) != null

  const [maxFiles, setMaxFiles] = createSignal(20)
  const [columns, setColumns] = createSignal<Column[]>([
    { filter: { by: 'diary' }, priority: 0, repeat: false },
  ])

  const neighborhood = createMemo<Neighborhood>(() => {
    const f = focus()
    if (!f) return { notes: [], edges: [] }
    const files = vaultStore.files
    const resolve = (target: string) =>
      resolveLink(target, getStemIndex(), files, getAliasIndex())
    return buildNeighborhood(f, files, vaultStore.backlinkMap, resolve, {
      maxFiles: maxFiles(),
      isDiary,
    })
  })

  const events = createMemo<TimelineEvent[]>(() =>
    deriveEvents(neighborhood(), vaultStore.files),
  )

  const grid = createMemo(() =>
    buildGrid(events(), columns(), neighborhood().edges, isDiary),
  )

  // ── 箭头叠层 ──────────────────────────────────────────────────────────────
  type ArrowStyle = { shape: 'straight' | 'elbow' | 'curve'; color: string }
  const [arrowStyle, setArrowStyle] = createSignal<ArrowStyle>({ shape: 'elbow', color: '#6aa0ff' })
  // 同一 path 可在多列重复显示 → 用「列:path」做实例 key，连每张真实渲染的卡片。
  const cardRefs = new Map<string, HTMLElement>()
  const [arrowPaths, setArrowPaths] = createSignal<string[]>([])
  let gridContainer: HTMLDivElement | undefined

  const GUTTER = 24 // 列间空隙的一半（gap-x-12 = 48px）

  // 经列/行空隙绕行：水平 stub 进空隙 → 竖直走空隙 → 水平进目标，不穿过任何卡片。
  // 跨栏：左卡走右边、右卡走左边（朝向中间空隙）。
  // 同列：源在上→两端走左侧、左侧空隙下行；源在下→两端走右侧、右侧空隙上行。
  function routeD(shape: ArrowStyle['shape'], a: DOMRect, b: DOMRect, base: DOMRect): string {
    const sy = a.top + a.height / 2 - base.top
    const ey = b.top + b.height / 2 - base.top
    let sx: number, ex: number, gx: number
    if (b.left >= a.right - 1) {            // 目标在右栏
      sx = a.right - base.left
      ex = b.left - base.left
      gx = (sx + ex) / 2
    } else if (b.right <= a.left + 1) {     // 目标在左栏
      sx = a.left - base.left
      ex = b.right - base.left
      gx = (sx + ex) / 2
    } else if (a.top <= b.top) {            // 同列、源在上 → 走左侧
      sx = a.left - base.left
      ex = b.left - base.left
      gx = Math.min(sx, ex) - GUTTER
    } else {                                 // 同列、源在下 → 走右侧
      sx = a.right - base.left
      ex = b.right - base.left
      gx = Math.max(sx, ex) + GUTTER
    }
    if (shape === 'straight') return `M ${sx} ${sy} L ${ex} ${ey}`
    if (shape === 'curve') return `M ${sx} ${sy} C ${gx} ${sy} ${gx} ${ey} ${ex} ${ey}`
    return `M ${sx} ${sy} L ${gx} ${sy} L ${gx} ${ey} L ${ex} ${ey}` // elbow
  }

  function computeArrows(): void {
    const base = gridContainer?.getBoundingClientRect()
    if (!base) { setArrowPaths([]); return }
    // 收集存活实例：path → 当前渲染的所有卡片矩形（含重复列）
    const instances = new Map<string, DOMRect[]>()
    for (const [key, el] of cardRefs) {
      if (!el.isConnected) { cardRefs.delete(key); continue }
      const path = key.slice(key.indexOf(':') + 1)
      const arr = instances.get(path) ?? []
      arr.push(el.getBoundingClientRect())
      instances.set(path, arr)
    }
    const shape = arrowStyle().shape
    const ds: string[] = []
    for (const { from, to } of grid().arrows) {
      const fromRects = instances.get(from) ?? []
      const toRects = instances.get(to) ?? []
      if (!fromRects.length || !toRects.length) continue
      for (const a of fromRects) {
        // 每张源卡连最近的一张目标卡
        const ax = a.left + a.width / 2, ay = a.top + a.height / 2
        let best: DOMRect | null = null, bestD = Infinity
        for (const b of toRects) {
          const d = Math.hypot(b.left + b.width / 2 - ax, b.top + b.height / 2 - ay)
          if (d < bestD) { bestD = d; best = b }
        }
        if (best) ds.push(routeD(shape, a, best, base))
      }
    }
    setArrowPaths(ds)
  }

  createEffect(() => {
    grid(); arrowStyle(); columns(); maxFiles()   // 依赖触发重算
    queueMicrotask(computeArrows)                 // 等 DOM 落定后量取
  })

  onMount(() => {
    const ro = new ResizeObserver(() => computeArrows())
    if (gridContainer) ro.observe(gridContainer)
    const onScroll = () => computeArrows()
    const scroller: Element | Window = gridContainer?.closest('.overflow-auto') ?? window
    scroller.addEventListener('scroll', onScroll, { passive: true })
    onCleanup(() => {
      ro.disconnect()
      scroller.removeEventListener('scroll', onScroll)
    })
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
    if (by === 'diary') filter = { by: 'diary' }
    else if (by === 'heading') filter = { by: 'heading', value: headingOptions()[0] ?? '' }
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
  function moveColumn(i: number, dir: -1 | 1): void {
    setColumns((cs) => {
      const j = i + dir
      if (j < 0 || j >= cs.length) return cs
      const next = [...cs]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
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

  function renderCard(ev: TimelineEvent, colIdx: number) {
    return (
      <button
        ref={(el) => cardRefs.set(`${colIdx}:${ev.path}`, el)}
        class="block text-left w-full rounded border border-(--border) bg-(--bg-base) hover:border-(--accent) p-3 transition-colors mb-2"
        onClick={() => openCard(ev)}
      >
        <div class="flex items-baseline gap-2">
          <time class="text-[11px] t-3 shrink-0">{ev.date}</time>
          <span class="text-[13px] t-base font-medium truncate">{ev.title}</span>
          <Show when={ev.path === focus()}>
            <span class="text-[10px] px-1 rounded bg-(--accent) text-white">焦点</span>
          </Show>
          <For each={ev.dirs}>
            {(d) => (
              <span
                class="text-[10px] t-3 shrink-0"
                title={d === 'out' ? '出链找到（被链接的目标）' : '反链找到（链接来源）'}
              >
                {d === 'out' ? '↗' : '↙'}
              </span>
            )}
          </For>
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
          <p class="text-[12px] t-2 mt-1.5 line-clamp-2">{previews()![ev.path].snippet}</p>
        </Show>
        <div class="flex items-center gap-2 mt-2">
          <For each={ev.tags}>
            {(t) => (
              <span class="text-[10px] px-1.5 rounded bg-(--bg-hover) t-3">#{t}</span>
            )}
          </For>
          <Show when={ev.linkCount > 0}>
            <span class="text-[10px] t-3 ml-auto">{ev.linkCount} 关联</span>
          </Show>
        </div>
      </button>
    )
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
          焦点笔记 BFS 邻域，按日期对齐成网格（共 {events().length} 篇）
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
          <label class="flex items-center gap-1">
            箭头
            <select
              class="bg-(--bg-base) border border-(--border) rounded px-1"
              value={arrowStyle().shape}
              onChange={(e) =>
                setArrowStyle((s) => ({ ...s, shape: e.currentTarget.value as ArrowStyle['shape'] }))
              }
            >
              <option value="straight">直线</option>
              <option value="elbow">折线</option>
              <option value="curve">曲线</option>
            </select>
            <input
              type="color"
              value={arrowStyle().color}
              onInput={(e) => setArrowStyle((s) => ({ ...s, color: e.currentTarget.value }))}
              class="w-7 h-6 p-0 border border-(--border) rounded"
            />
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
                  <option value="diary">日记</option>
                  <option value="heading">标题</option>
                  <option value="tag">标签</option>
                  <option value="direction">方向</option>
                </select>
                <Show when={col.filter?.by === 'heading' || col.filter?.by === 'tag'}>
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
                <button class="t-3 hover:t-base px-1" title="左移" onClick={() => moveColumn(i(), -1)}>←</button>
                <button class="t-3 hover:t-base px-1" title="右移" onClick={() => moveColumn(i(), 1)}>→</button>
                <button class="t-3 hover:t-base px-1" title="删除此列" onClick={() => removeColumn(i())}>✕</button>
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
          <div
            ref={(el) => (gridContainer = el)}
            class="relative grid gap-x-12 gap-y-2 items-start"
            style={{ 'grid-template-columns': `72px repeat(${columns().length}, minmax(0, 1fr))` }}
          >
            {/* 表头行（row 1）：列标题 */}
            <div style={{ 'grid-row': '1', 'grid-column': '1' }} />
            <For each={columns()}>
              {(col, ci) => (
                <div
                  class="text-[11px] t-3 pb-1 border-b border-(--border) truncate"
                  style={{ 'grid-row': '1', 'grid-column': `${ci() + 2}` }}
                >
                  {filterLabel(col.filter)}
                </div>
              )}
            </For>

            {/* 数据行：每个日期一行（row 从 2 起） */}
            <For each={grid().rows}>
              {(date, r) => (
                <>
                  <time
                    class="text-[11px] t-3 mt-1.5"
                    style={{ 'grid-row': `${r() + 2}`, 'grid-column': '1' }}
                  >
                    {date}
                  </time>
                  <For each={columns()}>
                    {(_col, ci) => (
                      <div style={{ 'grid-row': `${r() + 2}`, 'grid-column': `${ci() + 2}` }}>
                        <For each={grid().cells.get(date)?.get(ci()) ?? []}>
                          {(ev) => renderCard(ev, ci())}
                        </For>
                      </div>
                    )}
                  </For>
                </>
              )}
            </For>

            <svg class="absolute inset-0 pointer-events-none" style={{ overflow: 'visible' }}>
              <defs>
                <marker id="tl-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 Z" fill={arrowStyle().color} />
                </marker>
              </defs>
              <For each={arrowPaths()}>
                {(d) => (
                  <path
                    d={d}
                    fill="none"
                    stroke={arrowStyle().color}
                    stroke-width="1.5"
                    marker-end="url(#tl-arrow)"
                  />
                )}
              </For>
            </svg>
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
