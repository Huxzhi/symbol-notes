import { createDeferred, createMemo, createSignal, For, Show } from 'solid-js'
import { createVirtualizer } from '@tanstack/solid-virtual'
import { vaultStore } from '../../vault'
import { workspaceActions } from '../../stores/workspaceStore'
import type { ViewComponentProps } from '../../stores/types'
import {
  buildDayData,
  buildTaskDayData,
  buildRangeRows,
  WEEKDAYS_LONG,
  type CalRow,
  type MonthHeaderRow,
  type WeekRow,
  type Task,
} from './calendarUtils'

// ── Types ────────────────────────────────────────────────────────────────────

interface CalendarViewerProps extends ViewComponentProps {
  getConfig: <T extends Record<string, unknown>>(defaults: T) => T
  setConfig: (patch: Record<string, unknown>) => void
}

const FILTER_DEFAULTS = {
  dated: true,
  created: true,
  updated: true,
  pending: true,
  done: true,
}
type FilterKey = keyof typeof FILTER_DEFAULTS

type CellItem =
  | { kind: 'dated' | 'created' | 'updated'; path: string }
  | { kind: 'pending' | 'done'; task: Task }

const MAX_CELL_ITEMS = 5

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeYM(year: number, month: number) {
  const total = year * 12 + month
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 }
}

function estimateRowsHeight(rows: CalRow[]): number {
  return rows.reduce((acc, r) => acc + (r.type === 'month-header' ? 32 : 140), 0)
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FilterChip(props: {
  label: string
  colorClass: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      class="flex items-center gap-1.5 text-[10px] select-none cursor-pointer transition-opacity"
      style={{ opacity: props.active ? '1' : '0.35' }}
      onClick={props.onClick}
      title={`${props.active ? '隐藏' : '显示'}${props.label}`}
    >
      <span class={`w-2 h-2 rounded-sm shrink-0 ${props.colorClass}`} />
      <span class="text-[var(--text-3)]">{props.label}</span>
    </button>
  )
}

function MonthHeader(props: { year: number; month: number }) {
  return (
    <div class="px-4 py-1.5 text-[13px] font-semibold text-[var(--text)] bg-[var(--bg-surface)] border-b border-(--border)">
      {props.year}年{props.month + 1}月
    </div>
  )
}

function WeekRowComp(props: {
  row: WeekRow
  dayData: () => ReturnType<typeof buildDayData>
  taskDayData: () => Record<string, Task[]>
  filter: () => typeof FILTER_DEFAULTS
  todayStr: string
  onOpenFile: (path: string) => void
}) {
  return (
    <div class="grid grid-cols-7 border-b border-(--border)">
      <For each={props.row.cells}>
        {(cell, i) => {
          if (cell === null) {
            return (
              <div
                class={`h-[140px] bg-[var(--bg-surface)]${i() < 6 ? ' border-r border-(--border)' : ''}`}
              />
            )
          }
          const { dayStr, day } = cell
          const isToday = dayStr === props.todayStr

          const cellData = () => {
            const f = props.filter()
            const d = props.dayData()
            const td = props.taskDayData()
            const all: CellItem[] = [
              ...(f.dated ? (d.dated[dayStr] ?? []).map((path): CellItem => ({ kind: 'dated', path })) : []),
              ...(f.created ? (d.created[dayStr] ?? []).map((path): CellItem => ({ kind: 'created', path })) : []),
              ...(f.updated ? (d.updated[dayStr] ?? []).map((path): CellItem => ({ kind: 'updated', path })) : []),
              ...(f.pending ? (td[dayStr] ?? []).filter(t => !t.checked).map((task): CellItem => ({ kind: 'pending', task })) : []),
              ...(f.done ? (td[dayStr] ?? []).filter(t => t.checked).map((task): CellItem => ({ kind: 'done', task })) : []),
            ]
            if (all.length <= MAX_CELL_ITEMS) return { items: all, more: 0 }
            return { items: all.slice(0, MAX_CELL_ITEMS - 1), more: all.length - (MAX_CELL_ITEMS - 1) }
          }

          return (
            <div
              class={`p-1.5 flex flex-col h-[140px] overflow-hidden${i() < 6 ? ' border-r border-(--border)' : ''}${isToday ? ' bg-(--accent-bg)' : ' bg-[var(--bg-base)]'}`}
            >
              <div
                class={`shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-[12px] font-semibold mb-1 select-none${isToday ? ' bg-(--accent) text-white' : ' text-[var(--text-3)]'}`}
              >
                {day}
              </div>
              <div class="flex flex-col gap-0.5 overflow-hidden">
                <For each={cellData().items}>
                  {(item) => {
                    if (item.kind === 'dated') return (
                      <button
                        class="shrink-0 text-left text-[10px] leading-snug px-1.5 py-0.5 rounded bg-(--bg-hover) text-[var(--text-2)] truncate w-full cursor-pointer hover:bg-[var(--text-4)] hover:text-[var(--text)] transition-colors"
                        onClick={() => props.onOpenFile(item.path)}
                        title={item.path}
                      >
                        {item.path.split('/').pop()?.replace(/\.md$/, '')}
                      </button>
                    )
                    if (item.kind === 'created') return (
                      <button
                        class="shrink-0 text-left text-[10px] leading-snug px-1.5 py-0.5 rounded bg-(--accent-bg) text-(--accent) truncate w-full cursor-pointer hover:bg-(--accent) hover:text-white transition-colors"
                        onClick={() => props.onOpenFile(item.path)}
                        title={item.path}
                      >
                        {item.path.split('/').pop()?.replace(/\.md$/, '')}
                      </button>
                    )
                    if (item.kind === 'updated') return (
                      <button
                        class="shrink-0 text-left text-[10px] leading-snug px-1.5 py-0.5 rounded bg-(--bg-hover) text-[var(--link-2)] truncate w-full cursor-pointer hover:bg-[var(--link-2)] hover:text-white transition-colors"
                        onClick={() => props.onOpenFile(item.path)}
                        title={item.path}
                      >
                        {item.path.split('/').pop()?.replace(/\.md$/, '')}
                      </button>
                    )
                    if (item.kind === 'pending') return (
                      <button
                        class="shrink-0 text-left text-[10px] leading-snug px-1.5 py-0.5 rounded w-full cursor-pointer transition-colors truncate text-[var(--tag)] hover:opacity-80"
                        style={{ 'background-color': 'color-mix(in srgb, var(--tag) 18%, transparent)' }}
                        onClick={() => props.onOpenFile(item.task.path)}
                        title={item.task.path}
                      >
                        ☐ {item.task.cleanText}
                      </button>
                    )
                    if (item.kind === 'done') return (
                      <button
                        class="shrink-0 text-left text-[10px] leading-snug px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-3)] hover:text-[var(--text-2)] line-through w-full cursor-pointer transition-colors truncate"
                        onClick={() => props.onOpenFile(item.task.path)}
                        title={item.task.path}
                      >
                        ☑ {item.task.cleanText}
                      </button>
                    )
                    return null
                  }}
                </For>
                <Show when={cellData().more > 0}>
                  <div class="shrink-0 text-[10px] text-[var(--text-4)] px-1.5 py-0.5 select-none">
                    +{cellData().more} more
                  </div>
                </Show>
              </div>
            </div>
          )
        }}
      </For>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function CalendarViewer(props: CalendarViewerProps) {
  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  // Filter state — persisted via plugin config
  const filter = () => {
    const cfg = props.getConfig({ filter: FILTER_DEFAULTS })
    return { ...FILTER_DEFAULTS, ...(cfg.filter as Partial<typeof FILTER_DEFAULTS>) }
  }
  const toggleFilter = (key: FilterKey) =>
    props.setConfig({ filter: { ...filter(), [key]: !filter()[key] } })

  // Vault data — deferred so rapid per-file vault updates don't cause frame drops
  const dayData = createDeferred(() => buildDayData(vaultStore.files))
  const taskDayData = createDeferred(() => buildTaskDayData(vaultStore.taskMap))

  // Row list — mutable head/tail month tracking (not reactive, just boundary markers)
  let head = normalizeYM(now.getFullYear(), now.getMonth() - 3)
  let tail = normalizeYM(now.getFullYear(), now.getMonth() + 3)

  const initialRows = buildRangeRows(head.year, head.month, 7)
  const [rows, setRows] = createSignal<CalRow[]>(initialRows)

  // Pre-compute scroll offset to today's month header using known fixed row heights
  const todayMonthIdx = initialRows.findIndex(
    (r) => r.type === 'month-header' && r.year === now.getFullYear() && r.month === now.getMonth(),
  )
  const initialScrollOffset = initialRows
    .slice(0, Math.max(0, todayMonthIdx))
    .reduce((acc, r) => acc + (r.type === 'month-header' ? 32 : 140), 0)

  // Virtual list
  let scrollEl!: HTMLDivElement
  let pendingLoad = false

  const virtualizer = createVirtualizer({
    get count() {
      return rows().length
    },
    getScrollElement: () => scrollEl,
    estimateSize: (i) => (rows()[i]?.type === 'month-header' ? 32 : 140),
    overscan: 3,
    initialOffset: initialScrollOffset,
  })

  // Infinite scroll actions
  const appendMonths = (n: number) => {
    const start = normalizeYM(tail.year, tail.month + 1)
    const newRows = buildRangeRows(start.year, start.month, n)
    tail = normalizeYM(tail.year, tail.month + n)
    setRows((prev) => [...prev, ...newRows])
  }

  const prependMonths = (n: number) => {
    const start = normalizeYM(head.year, head.month - n)
    const newRows = buildRangeRows(start.year, start.month, n)
    head = normalizeYM(head.year, head.month - n)
    const estimatedHeight = estimateRowsHeight(newRows)
    setRows((prev) => [...newRows, ...prev])
    // Compensate scroll after reactive updates flush to prevent viewport jump
    queueMicrotask(() => {
      scrollEl.scrollTop += estimatedHeight
    })
  }

  const handleScroll = () => {
    if (pendingLoad) return
    const items = virtualizer.getVirtualItems()
    if (items.length === 0) return
    if (items[0].index < 5) {
      pendingLoad = true
      prependMonths(3)
      requestAnimationFrame(() => {
        pendingLoad = false
      })
    } else if (items[items.length - 1].index > rows().length - 5) {
      pendingLoad = true
      appendMonths(3)
      requestAnimationFrame(() => {
        pendingLoad = false
      })
    }
  }

  // Scroll to today's month on mount and on button click
  const scrollToToday = () => {
    const idx = rows().findIndex(
      (r) =>
        r.type === 'month-header' &&
        r.year === now.getFullYear() &&
        r.month === now.getMonth(),
    )
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'start' })
  }

  return (
    <div class="flex-1 flex flex-col overflow-hidden bg-[var(--bg-base)]">
      {/* Toolbar */}
      <div class="flex items-center gap-3 px-4 py-2 border-b border-(--border) shrink-0 flex-wrap">
        <button
          class="px-2.5 py-1 text-[11px] text-[var(--text-3)] hover:text-[var(--text)] hover:bg-(--bg-hover) rounded transition-colors border border-(--border)"
          onClick={scrollToToday}
        >
          今天
        </button>
        <div class="flex items-center gap-3 flex-wrap">
          <FilterChip
            label="日记"
            colorClass="bg-(--bg-active)"
            active={filter().dated}
            onClick={() => toggleFilter('dated')}
          />
          <FilterChip
            label="新建"
            colorClass="bg-(--accent)"
            active={filter().created}
            onClick={() => toggleFilter('created')}
          />
          <FilterChip
            label="修改"
            colorClass="bg-[var(--link-2)]"
            active={filter().updated}
            onClick={() => toggleFilter('updated')}
          />
          <FilterChip
            label="待办"
            colorClass="bg-[var(--tag)]"
            active={filter().pending}
            onClick={() => toggleFilter('pending')}
          />
          <FilterChip
            label="已完成"
            colorClass="bg-[var(--text-4)]"
            active={filter().done}
            onClick={() => toggleFilter('done')}
          />
        </div>
      </div>

      {/* Weekday header — fixed above scroll area */}
      <div class="grid grid-cols-7 border-b border-(--border) bg-[var(--bg-surface)] shrink-0">
        <For each={WEEKDAYS_LONG}>
          {(d, i) => (
            <div
              class={`py-2 text-center text-[11px] select-none${i() < 6 ? ' border-r border-(--border)' : ''}${i() >= 5 ? ' text-(--accent)' : ' text-[var(--text-3)]'}`}
            >
              {d}
            </div>
          )}
        </For>
      </div>

      {/* Virtual scroll container */}
      <div
        ref={scrollEl}
        class="flex-1 min-h-0 overflow-y-auto"
        onScroll={handleScroll}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: 'relative',
          }}
        >
          <For each={virtualizer.getVirtualItems()}>
            {(vItem) => {
              const row = () => rows()[vItem.index]
              return (
                <div
                  style={{
                    position: 'absolute',
                    top: '0',
                    transform: `translateY(${vItem.start}px)`,
                    width: '100%',
                  }}
                  ref={(el) => virtualizer.measureElement(el)}
                  data-index={vItem.index}
                >
                  {row().type === 'month-header' ? (
                    <MonthHeader
                      year={(row() as MonthHeaderRow).year}
                      month={(row() as MonthHeaderRow).month}
                    />
                  ) : (
                    <WeekRowComp
                      row={row() as WeekRow}
                      dayData={dayData}
                      taskDayData={taskDayData}
                      filter={filter}
                      todayStr={todayStr}
                      onOpenFile={workspaceActions.openFile}
                    />
                  )}
                </div>
              )
            }}
          </For>
        </div>
      </div>
    </div>
  )
}
