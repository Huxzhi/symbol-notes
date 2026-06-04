import { batch, createMemo, createSignal, For, Show } from 'solid-js'
import { vaultStore } from '../../vault'
import { workspaceActions } from '../../stores/workspaceStore'
import {
  buildCalendarGrid,
  buildDayData,
  toIsoDate,
  WEEKDAYS_SHORT,
} from './calendarUtils'

export function CalendarPanel() {
  const now = new Date()
  const todayStr = toIsoDate(now.getFullYear(), now.getMonth(), now.getDate())

  const [viewYear, setViewYear] = createSignal(now.getFullYear())
  const [viewMonth, setViewMonth] = createSignal(now.getMonth())
  const [selectedDay, setSelectedDay] = createSignal<string | null>(todayStr)

  const dayData = createMemo(() => buildDayData(vaultStore.files))
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
      setSelectedDay(todayStr)
    })

  const selectedFiles = createMemo(() => {
    const day = selectedDay()
    if (!day) return null
    return {
      day,
      dated: dayData().dated[day] ?? [],
      created: dayData().created[day] ?? [],
      updated: dayData().updated[day] ?? [],
    }
  })

  return (
    <div class="flex flex-col h-full">
      <div class="px-2.5 py-2 text-[10px] text-(--accent) font-bold tracking-widest uppercase border-b border-(--border) flex items-center">
        <span class="flex-1">日历</span>
        <button
          class="text-(--text-3) hover:text-(--accent) text-[9px] transition-colors"
          onClick={goToday}
          title="跳转到今天"
        >
          今
        </button>
      </div>

      <div class="flex items-center px-1 py-1 shrink-0">
        <button
          class="w-6 h-6 flex items-center justify-center text-(--text-3) hover:text-(--text) hover:bg-(--bg-hover) rounded text-[10px] transition-colors"
          onClick={prevMonth}
        >
          ◀
        </button>
        <span class="flex-1 text-center text-[11px] text-(--text) font-medium select-none">
          {viewYear()}年{viewMonth() + 1}月
        </span>
        <button
          class="w-6 h-6 flex items-center justify-center text-[var(--text-3)] hover:text-[var(--text)] hover:bg-(--bg-hover) rounded text-[10px] transition-colors"
          onClick={nextMonth}
        >
          ▶
        </button>
      </div>

      <div class="px-1 shrink-0">
        <div class="grid grid-cols-7">
          <For each={WEEKDAYS_SHORT}>
            {(d) => (
              <div class="text-center text-[9px] text-(--text-4) py-0.5 select-none">
                {d}
              </div>
            )}
          </For>
        </div>
        <div class="grid grid-cols-7 gap-y-px">
          <For each={calendarGrid()}>
            {(day) => {
              if (day === null) return <div class="h-7" />
              const dayStr = () => toIsoDate(viewYear(), viewMonth(), day)
              const isToday = () => dayStr() === todayStr
              const isSelected = () => selectedDay() === dayStr()
              const hasCreated = () =>
                (dayData().created[dayStr()]?.length ?? 0) > 0
              const hasUpdated = () =>
                (dayData().updated[dayStr()]?.length ?? 0) > 0
              const hasDated = () =>
                (dayData().dated[dayStr()]?.length ?? 0) > 0
              return (
                <button
                  class={`h-7 flex flex-col items-center justify-center rounded text-[11px] leading-none cursor-pointer transition-colors
                    ${
                      isSelected()
                        ? 'bg-(--accent) text-white'
                        : isToday()
                          ? 'bg-(--accent-bg) text-(--accent) font-semibold'
                          : 'text-[var(--text-2)] hover:bg-(--bg-hover)'
                    }`}
                  onClick={() => setSelectedDay(isSelected() ? null : dayStr())}
                >
                  <span class="leading-none">{day}</span>
                  <div class="flex gap-px mt-0.5 h-1.5 items-center">
                    <Show when={hasDated()}>
                      <span
                        class={`block w-1 h-1 rounded-full ${isSelected() ? 'bg-white' : 'bg-[var(--text-2)]'}`}
                      />
                    </Show>
                    <Show when={hasCreated()}>
                      <span
                        class={`block w-1 h-1 rounded-full ${isSelected() ? 'bg-white/80' : 'bg-(--accent)'}`}
                      />
                    </Show>
                    <Show when={hasUpdated()}>
                      <span
                        class={`block w-1 h-1 rounded-full ${isSelected() ? 'bg-white/60' : 'bg-[var(--link-2)]'}`}
                      />
                    </Show>
                  </div>
                </button>
              )
            }}
          </For>
        </div>
      </div>

      <div class="flex gap-3 px-2 py-1 mt-0.5 border-t border-(--border)] shrink-0">
        <span class="flex items-center gap-1 text-[9px] text-[var(--text-4)]">
          <span class="w-1.5 h-1.5 rounded-full bg-[var(--text-2)] shrink-0" />
          日记
        </span>
        <span class="flex items-center gap-1 text-[9px] text-[var(--text-4)]">
          <span class="w-1.5 h-1.5 rounded-full bg-(--accent) shrink-0" />
          创建
        </span>
        <span class="flex items-center gap-1 text-[9px] text-[var(--text-4)]">
          <span class="w-1.5 h-1.5 rounded-full bg-[var(--link-2)] shrink-0" />
          修改
        </span>
      </div>

      <Show when={selectedFiles()}>
        {(sel) => (
          <div class="flex-1 overflow-y-auto border-t border-(--border)] min-h-0">
            <div class="px-2 pt-1.5 pb-0.5 text-[9px] text-[var(--text-3)] uppercase tracking-widest select-none">
              {sel().day}
            </div>
            <Show when={sel().dated.length > 0}>
              <div class="px-2 py-0.5 text-[9px] text-[var(--text-3)] flex items-center gap-1">
                <span class="w-1 h-1 rounded-full bg-[var(--text-2)] shrink-0" />
                日记
              </div>
              <For each={sel().dated}>
                {(path) => (
                  <button
                    class="w-full text-left px-3 py-1 text-[10px] text-[var(--text-2)] hover:bg-(--bg-hover) hover:text-[var(--text)] transition-colors truncate block cursor-pointer"
                    onClick={() => workspaceActions.openFile(path)}
                    title={path}
                  >
                    {path.split('/').pop()?.replace(/\.md$/, '')}
                  </button>
                )}
              </For>
            </Show>
            <Show when={sel().created.length > 0}>
              <div class="px-2 py-0.5 text-[9px] text-(--accent) flex items-center gap-1">
                <span class="w-1 h-1 rounded-full bg-(--accent) shrink-0" />
                创建
              </div>
              <For each={sel().created}>
                {(path) => (
                  <button
                    class="w-full text-left px-3 py-1 text-[10px] text-[var(--text-2)] hover:bg-(--bg-hover) hover:text-(--accent) transition-colors truncate block cursor-pointer"
                    onClick={() => workspaceActions.openFile(path)}
                    title={path}
                  >
                    {path.split('/').pop()?.replace(/\.md$/, '')}
                  </button>
                )}
              </For>
            </Show>
            <Show when={sel().updated.length > 0}>
              <div class="px-2 py-0.5 text-[9px] text-[var(--link-2)] flex items-center gap-1">
                <span class="w-1 h-1 rounded-full bg-[var(--link-2)] shrink-0" />
                修改
              </div>
              <For each={sel().updated}>
                {(path) => (
                  <button
                    class="w-full text-left px-3 py-1 text-[10px] text-[var(--text-2)] hover:bg-(--bg-hover) hover:text-[var(--link-2)] transition-colors truncate block cursor-pointer"
                    onClick={() => workspaceActions.openFile(path)}
                    title={path}
                  >
                    {path.split('/').pop()?.replace(/\.md$/, '')}
                  </button>
                )}
              </For>
            </Show>
            <Show
              when={
                sel().dated.length === 0 &&
                sel().created.length === 0 &&
                sel().updated.length === 0
              }
            >
              <div class="px-2 py-2 text-[10px] text-[var(--text-4)] italic">
                该日无记录
              </div>
            </Show>
          </div>
        )}
      </Show>

      <Show when={!selectedFiles()}>
        <div class="flex-1" />
      </Show>
    </div>
  )
}
