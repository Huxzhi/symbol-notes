import { batch, createMemo, createSignal, For, Show } from 'solid-js'
import { vaultStore } from '../../vault'
import type { ViewComponentProps } from '../../stores/types'
import { workspaceActions } from '../../stores/workspaceStore'
import {
  buildCalendarGrid,
  buildDayData,
  buildTaskDayData,
  toIsoDate,
  WEEKDAYS_LONG,
} from './calendarUtils'

export function CalendarViewer(_props: ViewComponentProps) {
  const now = new Date()
  const todayStr = toIsoDate(now.getFullYear(), now.getMonth(), now.getDate())

  const [viewYear, setViewYear] = createSignal(now.getFullYear())
  const [viewMonth, setViewMonth] = createSignal(now.getMonth())

  const dayData = createMemo(() => buildDayData(vaultStore.files))
  const taskDayData = createMemo(() => buildTaskDayData(vaultStore.taskMap))
  const calendarGrid = createMemo(() =>
    buildCalendarGrid(viewYear(), viewMonth()),
  )

  const prevMonth = () =>
    batch(() => {
      if (viewMonth() === 0) {
        setViewYear((y) => y - 1)
        setViewMonth(11)
      } else setViewMonth((m) => m - 1)
    })
  const nextMonth = () =>
    batch(() => {
      if (viewMonth() === 11) {
        setViewYear((y) => y + 1)
        setViewMonth(0)
      } else setViewMonth((m) => m + 1)
    })
  const goToday = () =>
    batch(() => {
      setViewYear(now.getFullYear())
      setViewMonth(now.getMonth())
    })

  return (
    <div class="flex-1 flex flex-col overflow-hidden bg-[var(--bg-base)]">
      {/* Toolbar */}
      <div class="flex items-center gap-2 px-4 py-2 border-b border-(--border)] shrink-0">
        <button
          class="px-2.5 py-1 text-[11px] text-[var(--text-3)] hover:text-[var(--text)] hover:bg-(--bg-hover) rounded transition-colors border border-(--border)]"
          onClick={goToday}
        >
          今天
        </button>
        <button
          class="w-7 h-7 flex items-center justify-center text-[var(--text-3)] hover:text-[var(--text)] hover:bg-(--bg-hover) rounded transition-colors text-[12px]"
          onClick={prevMonth}
        >
          ◀
        </button>
        <button
          class="w-7 h-7 flex items-center justify-center text-[var(--text-3)] hover:text-[var(--text)] hover:bg-(--bg-hover) rounded transition-colors text-[12px]"
          onClick={nextMonth}
        >
          ▶
        </button>
        <h2 class="text-[15px] font-semibold text-[var(--text)] ml-1 select-none">
          {viewYear()}年{viewMonth() + 1}月
        </h2>
        <div class="flex-1" />
        <div class="flex items-center gap-4 text-[10px] text-[var(--text-4)]">
          <span class="flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-sm bg-(--bg-hover)" />
            日记
          </span>
          <span class="flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-sm bg-(--accent)" />
            创建
          </span>
          <span class="flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-sm bg-[var(--link-2)]" />
            修改
          </span>
          <span class="flex items-center gap-1.5">
            <span
              class="w-2 h-2 rounded-sm bg-[var(--tag)]"
              style="opacity:0.25"
            />
            待办
          </span>
          <span class="flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-sm bg-[var(--text-4)]" />
            已完成
          </span>
        </div>
      </div>

      {/* Weekday header row */}
      <div class="grid grid-cols-7 border-b border-(--border)] bg-[var(--bg-surface)] shrink-0">
        <For each={WEEKDAYS_LONG}>
          {(d, i) => (
            <div
              class={`py-2 text-center text-[11px] select-none
              ${i() < 6 ? 'border-r border-(--border)]' : ''}
              ${i() >= 5 ? 'text-(--accent)' : 'text-[var(--text-3)]'}`}
            >
              {d}
            </div>
          )}
        </For>
      </div>

      {/* Calendar grid */}
      <div
        class="flex-1 min-h-0 grid grid-cols-7 border-l border-t border-(--border)] overflow-hidden"
        style={{ 'grid-auto-rows': '1fr' }}
      >
        <For each={calendarGrid()}>
          {(day, idx) => {
            const isLastCol = () => (idx() + 1) % 7 === 0

            if (day === null) {
              return (
                <div
                  class={`border-r border-b border-(--border)] bg-[var(--bg-surface)]
                  ${isLastCol() ? 'border-r-0' : ''}`}
                />
              )
            }

            const dayStr = () => toIsoDate(viewYear(), viewMonth(), day)
            const isToday = () => dayStr() === todayStr
            const dated = () => dayData().dated[dayStr()] ?? []
            const created = () => dayData().created[dayStr()] ?? []
            const updated = () => dayData().updated[dayStr()] ?? []
            const tasks = () => taskDayData()[dayStr()] ?? []

            return (
              <div
                class={`border-b border-(--border)] p-1.5 flex flex-col min-h-0 overflow-hidden group
                  ${isLastCol() ? '' : 'border-r border-(--border)]'}
                  ${isToday() ? 'bg-(--accent-bg)' : 'bg-[var(--bg-base)]'}`}
              >
                <div
                  class={`shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-[12px] font-semibold mb-1 select-none
                  ${
                    isToday()
                      ? 'bg-(--accent) text-white'
                      : 'text-[var(--text-3)] group-hover:text-[var(--text-2)]'
                  }`}
                >
                  {day}
                </div>
                <div class="flex-1 overflow-y-auto min-h-0 flex flex-col gap-0.5">
                  <For each={dated()}>
                    {(path) => (
                      <button
                        class="shrink-0 text-left text-[10px] leading-snug px-1.5 py-0.5 rounded bg-(--bg-hover) text-[var(--text-2)] truncate w-full cursor-pointer hover:bg-[var(--text-4)] hover:text-[var(--text)] transition-colors"
                        onClick={() => workspaceActions.openFile(path)}
                        title={path}
                      >
                        {path.split('/').pop()?.replace(/\.md$/, '')}
                      </button>
                    )}
                  </For>
                  <For each={created()}>
                    {(path) => (
                      <button
                        class="shrink-0 text-left text-[10px] leading-snug px-1.5 py-0.5 rounded bg-(--accent-bg) text-(--accent) truncate w-full cursor-pointer hover:bg-(--accent) hover:text-white transition-colors"
                        onClick={() => workspaceActions.openFile(path)}
                        title={path}
                      >
                        {path.split('/').pop()?.replace(/\.md$/, '')}
                      </button>
                    )}
                  </For>
                  <For each={updated()}>
                    {(path) => (
                      <button
                        class="shrink-0 text-left text-[10px] leading-snug px-1.5 py-0.5 rounded bg-(--bg-hover) text-[var(--link-2)] truncate w-full cursor-pointer hover:bg-[var(--link-2)] hover:text-white transition-colors"
                        onClick={() => workspaceActions.openFile(path)}
                        title={path}
                      >
                        {path.split('/').pop()?.replace(/\.md$/, '')}
                      </button>
                    )}
                  </For>
                  <For each={tasks()}>
                    {(task) => (
                      <button
                        class={`shrink-0 text-left text-[10px] leading-snug px-1.5 py-0.5 rounded w-full cursor-pointer transition-colors truncate
                          ${
                            task.checked
                              ? 'bg-[var(--bg-hover)] text-[var(--text-3)] hover:text-[var(--text-2)] line-through'
                              : 'bg-[var(--tag)] text-[var(--tag)] hover:opacity-80'
                          }`}
                        style={
                          task.checked
                            ? {}
                            : {
                                'background-color':
                                  'color-mix(in srgb, var(--tag) 18%, transparent)',
                              }
                        }
                        onClick={() => workspaceActions.openFile(task.path)}
                        title={`${task.path}`}
                      >
                        {task.checked ? '☑ ' : '☐ '}
                        {task.cleanText}
                      </button>
                    )}
                  </For>
                  <Show
                    when={
                      dated().length === 0 &&
                      created().length === 0 &&
                      updated().length === 0 &&
                      tasks().length === 0
                    }
                  >
                    <div class="flex-1" />
                  </Show>
                </div>
              </div>
            )
          }}
        </For>
      </div>
    </div>
  )
}
