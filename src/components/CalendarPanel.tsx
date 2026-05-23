import { createMemo, createSignal, For, Show } from 'solid-js'
import { knowledgeStore } from '../stores/knowledgeStore'
import { openFile } from '../services/fileSystemService'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function CalendarPanel() {
  const now = new Date()
  const todayStr = toIsoDate(now.getFullYear(), now.getMonth(), now.getDate())

  const [viewYear, setViewYear] = createSignal(now.getFullYear())
  const [viewMonth, setViewMonth] = createSignal(now.getMonth())
  const [selectedDay, setSelectedDay] = createSignal<string | null>(null)

  // Map day string → file paths, split by created vs updated-only
  const dayData = createMemo(() => {
    const created: Record<string, string[]> = {}
    const updated: Record<string, string[]> = {}
    for (const [path, meta] of Object.entries(knowledgeStore.index)) {
      const fm = meta.frontmatter
      const c = typeof fm.created === 'string' && fm.created.length >= 10
        ? fm.created.slice(0, 10) : null
      const u = typeof fm.updated === 'string' && fm.updated.length >= 10
        ? fm.updated.slice(0, 10) : null
      if (c) (created[c] ??= []).push(path)
      // Only count as "updated" if the update happened on a different day than creation
      if (u && u !== c) (updated[u] ??= []).push(path)
    }
    return { created, updated }
  })

  // Grid cells for the current view month (null = empty leading/trailing cell)
  const calendarGrid = createMemo(() => {
    const year = viewYear()
    const month = viewMonth()
    const firstDow = new Date(year, month, 1).getDay()          // 0=Sun
    const startOffset = (firstDow + 6) % 7                      // Mon=0 … Sun=6
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const cells: (number | null)[] = []
    for (let i = 0; i < startOffset; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(d)
    while (cells.length % 7 !== 0) cells.push(null)
    return cells
  })

  const prevMonth = () => {
    if (viewMonth() === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (viewMonth() === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }
  const goToday = () => {
    setViewYear(now.getFullYear())
    setViewMonth(now.getMonth())
    setSelectedDay(todayStr)
  }

  const selectedFiles = createMemo(() => {
    const day = selectedDay()
    if (!day) return null
    return {
      day,
      created: dayData().created[day] ?? [],
      updated: dayData().updated[day] ?? [],
    }
  })

  return (
    <div class="w-[190px] h-full bg-[var(--bg-surface)] border-r border-[var(--border)] flex flex-col">

      {/* Panel header */}
      <div class="px-2.5 py-2 text-[10px] text-[var(--accent)] font-bold tracking-widest uppercase border-b border-[var(--border)] flex items-center">
        <span class="flex-1">日历</span>
        <button
          class="text-[var(--text-3)] hover:text-[var(--accent)] text-[9px] transition-colors"
          onClick={goToday}
          title="跳转到今天"
        >今</button>
      </div>

      {/* Month navigation */}
      <div class="flex items-center px-1 py-1 shrink-0">
        <button
          class="w-6 h-6 flex items-center justify-center text-[var(--text-3)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] rounded text-[10px] transition-colors"
          onClick={prevMonth}
        >◀</button>
        <span class="flex-1 text-center text-[11px] text-[var(--text)] font-medium select-none">
          {viewYear()}年{viewMonth() + 1}月
        </span>
        <button
          class="w-6 h-6 flex items-center justify-center text-[var(--text-3)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] rounded text-[10px] transition-colors"
          onClick={nextMonth}
        >▶</button>
      </div>

      {/* Calendar grid */}
      <div class="px-1 shrink-0">
        {/* Weekday headers */}
        <div class="grid grid-cols-7">
          <For each={WEEKDAYS}>
            {(d) => (
              <div class="text-center text-[9px] text-[var(--text-4)] py-0.5 select-none">{d}</div>
            )}
          </For>
        </div>

        {/* Day cells */}
        <div class="grid grid-cols-7 gap-y-px">
          <For each={calendarGrid()}>
            {(day) => {
              if (day === null) return <div class="h-7" />
              const dayStr = toIsoDate(viewYear(), viewMonth(), day)
              const isToday = dayStr === todayStr
              const isSelected = () => selectedDay() === dayStr
              const hasCreated = () => (dayData().created[dayStr]?.length ?? 0) > 0
              const hasUpdated = () => (dayData().updated[dayStr]?.length ?? 0) > 0

              return (
                <button
                  class={`h-7 flex flex-col items-center justify-center rounded text-[11px] leading-none cursor-pointer transition-colors
                    ${isSelected()
                      ? 'bg-[var(--accent)] text-white'
                      : isToday
                        ? 'bg-[var(--accent-bg)] text-[var(--accent)] font-semibold'
                        : 'text-[var(--text-2)] hover:bg-[var(--bg-hover)]'
                    }`}
                  onClick={() => setSelectedDay(isSelected() ? null : dayStr)}
                >
                  <span class="leading-none">{day}</span>
                  <div class="flex gap-px mt-0.5 h-1.5 items-center">
                    <Show when={hasCreated()}>
                      <span class={`block w-1 h-1 rounded-full ${isSelected() ? 'bg-white/80' : 'bg-[var(--accent)]'}`} />
                    </Show>
                    <Show when={hasUpdated()}>
                      <span class={`block w-1 h-1 rounded-full ${isSelected() ? 'bg-white/60' : 'bg-[var(--link-2)]'}`} />
                    </Show>
                  </div>
                </button>
              )
            }}
          </For>
        </div>
      </div>

      {/* Legend */}
      <div class="flex gap-3 px-2 py-1 mt-0.5 border-t border-[var(--border)] shrink-0">
        <span class="flex items-center gap-1 text-[9px] text-[var(--text-4)]">
          <span class="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shrink-0" />创建
        </span>
        <span class="flex items-center gap-1 text-[9px] text-[var(--text-4)]">
          <span class="w-1.5 h-1.5 rounded-full bg-[var(--link-2)] shrink-0" />修改
        </span>
      </div>

      {/* File list for selected day */}
      <Show when={selectedFiles()}>
        {(sel) => (
          <div class="flex-1 overflow-y-auto border-t border-[var(--border)] min-h-0">
            <div class="px-2 pt-1.5 pb-0.5 text-[9px] text-[var(--text-3)] uppercase tracking-widest select-none">
              {sel().day}
            </div>

            <Show when={sel().created.length > 0}>
              <div class="px-2 py-0.5 text-[9px] text-[var(--accent)] flex items-center gap-1">
                <span class="w-1 h-1 rounded-full bg-[var(--accent)] shrink-0" />创建
              </div>
              <For each={sel().created}>
                {(path) => (
                  <button
                    class="w-full text-left px-3 py-1 text-[10px] text-[var(--text-2)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent)] transition-colors truncate block cursor-pointer"
                    onClick={() => openFile(path)}
                    title={path}
                  >
                    {path.split('/').pop()?.replace(/\.md$/, '')}
                  </button>
                )}
              </For>
            </Show>

            <Show when={sel().updated.length > 0}>
              <div class="px-2 py-0.5 text-[9px] text-[var(--link-2)] flex items-center gap-1">
                <span class="w-1 h-1 rounded-full bg-[var(--link-2)] shrink-0" />修改
              </div>
              <For each={sel().updated}>
                {(path) => (
                  <button
                    class="w-full text-left px-3 py-1 text-[10px] text-[var(--text-2)] hover:bg-[var(--bg-hover)] hover:text-[var(--link-2)] transition-colors truncate block cursor-pointer"
                    onClick={() => openFile(path)}
                    title={path}
                  >
                    {path.split('/').pop()?.replace(/\.md$/, '')}
                  </button>
                )}
              </For>
            </Show>

            <Show when={sel().created.length === 0 && sel().updated.length === 0}>
              <div class="px-2 py-2 text-[10px] text-[var(--text-4)] italic">该日无记录</div>
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
