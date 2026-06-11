import { createDeferred, createMemo, createSignal, For, Show, type JSX } from 'solid-js'
import { createVirtualizer } from '@tanstack/solid-virtual'
import { vaultStore } from '../../vault'
import { workspaceActions } from '../../stores/workspaceStore'
import type { ViewComponentProps } from '../../stores/types'
import {
  buildDayData,
  buildTaskDayData,
  buildEntryDayData,
  buildCellItems,
  buildRangeRows,
  toIsoDate,
  parseISODate,
  weekRowFilePath,
  FILTER_DEFAULTS,
  WEEKDAYS_LONG,
  type CalRow,
  type MonthHeaderRow,
  type WeekRow,
  type Task,
  type FilterKey,
} from './calendarUtils'
import { CellItemButton } from './CalendarCell'
import { WeekView } from './WeekView'
import { PlanPreview } from './PlanPreview'
import { PlanCellEditor } from './PlanCellEditor'

// ── Types ────────────────────────────────────────────────────────────────────

interface CalendarViewerProps extends ViewComponentProps {
  getConfig: <T extends Record<string, unknown>>(defaults: T) => T
  setConfig: (patch: Record<string, unknown>) => void
}

const MAX_CELL_ITEMS = 5

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeYM(year: number, month: number) {
  const total = year * 12 + month
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 }
}

const HEADER_H = 40
const WEEK_ROW_H = { month: 140, week: 420 } as const

function rowHeight(row: CalRow, mode: 'week' | 'month'): number {
  return row.type === 'month-header' ? HEADER_H : WEEK_ROW_H[mode]
}

function estimateRowsHeight(rows: CalRow[], mode: 'week' | 'month'): number {
  return rows.reduce((acc, r) => acc + rowHeight(r, mode), 0)
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FilterChip(props: {
  label: string
  colorClass?: string
  dotStyle?: JSX.CSSProperties
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
      <span class={`w-2 h-2 rounded-sm shrink-0 ${props.colorClass ?? ''}`} style={props.dotStyle} />
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
  mode: () => 'week' | 'month'
  weeklyFolder: () => string
  editingPath: () => string | null
  setEditingPath: (p: string | null) => void
  dayData: () => ReturnType<typeof buildDayData>
  taskDayData: () => Record<string, Task[]>
  entryDayData: () => Record<string, Task[]>
  filter: () => typeof FILTER_DEFAULTS
  todayStr: string
  onOpenFile: (path: string) => void
}) {
  const planPath = () => weekRowFilePath(props.weeklyFolder(), props.row)
  return (
    <div
      class="grid border-b border-(--border)"
      style={{
        'grid-template-columns': 'repeat(7, minmax(0, 1fr)) 1.6fr',
        'min-height': `${WEEK_ROW_H[props.mode()]}px`,
      }}
    >
      <For each={props.row.cells}>
        {(cell) => {
          if (cell === null) {
            return <div class="bg-[var(--bg-surface)] border-r border-(--border)" />
          }
          const { dayStr, day } = cell
          const isToday = dayStr === props.todayStr
          const week = () => props.mode() === 'week'

          const cellData = () => {
            const all = buildCellItems(dayStr, props.filter(), {
              dayData: props.dayData(),
              taskDayData: props.taskDayData(),
              entryDayData: props.entryDayData(),
            })
            if (week() || all.length <= MAX_CELL_ITEMS) return { items: all, more: 0 }
            return { items: all.slice(0, MAX_CELL_ITEMS - 1), more: all.length - (MAX_CELL_ITEMS - 1) }
          }

          return (
            <div
              class={`p-1.5 flex flex-col min-h-0 overflow-hidden border-r border-(--border)${isToday ? ' bg-(--accent-bg)' : ' bg-[var(--bg-base)]'}`}
            >
              <div
                class={`shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-[12px] font-semibold mb-1 select-none${isToday ? ' bg-(--accent) text-white' : ' text-[var(--text-3)]'}`}
              >
                {day}
              </div>
              <div class="flex flex-col gap-0.5 min-h-0 overflow-y-auto">
                <For each={cellData().items}>
                  {(item) => <CellItemButton item={item} onOpenFile={props.onOpenFile} wrap={week()} />}
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

      {/* 8th column: weekly plan */}
      <div class="flex flex-col min-h-0 overflow-hidden bg-[var(--bg-surface)]">
        <Show when={planPath()} fallback={<div class="flex-1" />}>
          {(path) => (
            <Show
              when={props.editingPath() === path()}
              fallback={<PlanPreview path={path()} label="周计划" onEdit={() => props.setEditingPath(path())} />}
            >
              <PlanCellEditor path={path()} label="周计划" onClose={() => props.setEditingPath(null)} />
            </Show>
          )}
        </Show>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function CalendarViewer(props: CalendarViewerProps) {
  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  // View mode & anchored week — persisted via leaf viewState
  const initMode: 'week' | 'month' = props.viewState.mode === 'week' ? 'week' : 'month'
  const initAnchor = typeof props.viewState.weekAnchor === 'string' ? props.viewState.weekAnchor : todayStr
  const [mode, setMode] = createSignal<'week' | 'month'>(initMode)
  const [weekAnchor, setWeekAnchor] = createSignal(initAnchor)
  const [editingPath, setEditingPath] = createSignal<string | null>(null)

  function applyState(nextMode: 'week' | 'month', nextAnchor: string) {
    setMode(nextMode)
    setWeekAnchor(nextAnchor)
    workspaceActions.setLeafViewState(props.leafId, {
      type: 'calendar',
      state: { mode: nextMode, weekAnchor: nextAnchor },
    })
  }

  function shiftWeek(days: number) {
    const d = parseISODate(weekAnchor())
    d.setDate(d.getDate() + days)
    applyState('week', toIsoDate(d.getFullYear(), d.getMonth(), d.getDate()))
  }

  const weeklyFolder = () => String(props.getConfig({ weeklyFolder: 'weekly' }).weeklyFolder)

  // Filter state — persisted via plugin config
  const filter = () => {
    const cfg = props.getConfig({ filter: FILTER_DEFAULTS })
    return { ...FILTER_DEFAULTS, ...(cfg.filter as Partial<typeof FILTER_DEFAULTS>) }
  }
  const toggleFilter = (key: FilterKey) =>
    props.setConfig({ filter: { ...filter(), [key]: !filter()[key] } })

  // Vault data — deferred so rapid per-file vault updates don't cause frame drops
  const dayData = createDeferred(() => buildDayData(vaultStore.files))
  const taskDayData = createDeferred(() => buildTaskDayData(vaultStore.taskMap, vaultStore.files))
  const entryDayData = createDeferred(() => buildEntryDayData(vaultStore.files))

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
    .reduce((acc, r) => acc + rowHeight(r, initMode), 0)

  // Virtual list
  let scrollEl!: HTMLDivElement
  let pendingLoad = false

  const virtualizer = createVirtualizer({
    get count() {
      return rows().length
    },
    getScrollElement: () => scrollEl,
    estimateSize: (i) => {
      const r = rows()[i]
      return r ? rowHeight(r, mode()) : WEEK_ROW_H.month
    },
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
    const estimatedHeight = estimateRowsHeight(newRows, mode())
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
        <div class="flex items-center rounded border border-(--border) overflow-hidden">
          <button
            class={`px-2 py-0.5 text-[11px] transition-colors${mode() === 'month' ? ' bg-(--accent) text-white' : ' text-(--text-3) hover:bg-(--bg-hover)'}`}
            onClick={() => applyState('month', weekAnchor())}
          >月</button>
          <button
            class={`px-2 py-0.5 text-[11px] transition-colors${mode() === 'week' ? ' bg-(--accent) text-white' : ' text-(--text-3) hover:bg-(--bg-hover)'}`}
            onClick={() => applyState('week', weekAnchor())}
          >周</button>
        </div>
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
          <FilterChip
            label="事件"
            dotStyle={{ 'background-color': '#4aa3ff' }}
            active={filter().event}
            onClick={() => toggleFilter('event')}
          />
          <FilterChip
            label="心情"
            dotStyle={{ 'background-color': '#56c596' }}
            active={filter().mood}
            onClick={() => toggleFilter('mood')}
          />
          <FilterChip
            label="想法"
            dotStyle={{ 'background-color': '#9d8dff' }}
            active={filter().idea}
            onClick={() => toggleFilter('idea')}
          />
        </div>
      </div>

      {/* Month view — kept permanently mounted (toggled via display) so the
          virtual list's scroll element never unmounts; the virtualizer binds it
          once and its ResizeObserver repopulates rows when it becomes visible.
          Unmounting it (via <Show>) leaves the virtualizer with a detached,
          zero-height element and the grid renders blank. */}
      <div
        class="flex flex-col flex-1 min-h-0"
        style={{ display: mode() === 'month' ? 'flex' : 'none' }}
      >
      {/* Weekday header — fixed above scroll area */}
      <div
        class="grid border-b border-(--border) bg-[var(--bg-surface)] shrink-0"
        style={{ 'grid-template-columns': 'repeat(7, minmax(0, 1fr)) 1.6fr' }}
      >
        <For each={WEEKDAYS_LONG}>
          {(d, i) => (
            <div
              class={`py-2 text-center text-[11px] select-none border-r border-(--border)${i() >= 5 ? ' text-(--accent)' : ' text-[var(--text-3)]'}`}
            >
              {d}
            </div>
          )}
        </For>
        <div class="py-2 text-center text-[11px] select-none text-(--text-3)">周计划</div>
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
                      mode={mode}
                      weeklyFolder={weeklyFolder}
                      editingPath={editingPath}
                      setEditingPath={setEditingPath}
                      dayData={dayData}
                      taskDayData={taskDayData}
                      entryDayData={entryDayData}
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

      <Show when={mode() === 'week'}>
        <WeekView
          weekAnchor={weekAnchor}
          filter={filter}
          weeklyFolder={weeklyFolder}
          todayStr={todayStr}
          onOpenFile={workspaceActions.openFile}
          onPrevWeek={() => shiftWeek(-7)}
          onNextWeek={() => shiftWeek(7)}
          onToday={() => applyState('week', todayStr)}
        />
      </Show>
    </div>
  )
}
