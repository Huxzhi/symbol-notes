import { createDeferred, For } from 'solid-js'
import { vaultStore } from '../../vault'
import {
  buildDayData,
  buildTaskDayData,
  buildEntryDayData,
  buildCellItems,
  getISOWeekDates,
  getISOWeekString,
  weekFilePath,
  parseISODate,
  WEEKDAYS_LONG,
  type FilterState,
} from './calendarUtils'
import { CellItemButton } from './CalendarCell'
import { WeeklyNoteEditor } from './WeeklyNoteEditor'

export function WeekView(props: {
  weekAnchor: () => string
  filter: () => FilterState
  weeklyFolder: () => string
  todayStr: string
  onOpenFile: (p: string) => void
  onPrevWeek: () => void
  onNextWeek: () => void
  onToday: () => void
}) {
  const anchorDate = () => parseISODate(props.weekAnchor())
  const weekDates = () => getISOWeekDates(anchorDate())
  const weekLabel = () => getISOWeekString(anchorDate())
  const notePath = () => weekFilePath(props.weeklyFolder(), anchorDate())

  const dayData = createDeferred(() => buildDayData(vaultStore.files))
  const taskDayData = createDeferred(() => buildTaskDayData(vaultStore.taskMap, vaultStore.files))
  const entryDayData = createDeferred(() => buildEntryDayData(vaultStore.files))

  return (
    <div class="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Week nav */}
      <div class="flex items-center gap-2 px-4 py-1.5 border-b border-(--border) shrink-0">
        <button class="px-2 py-0.5 text-[12px] text-(--text-3) hover:text-(--text) hover:bg-(--bg-hover) rounded" onClick={props.onPrevWeek}>‹</button>
        <span class="text-[12px] font-medium text-(--text-2) min-w-[88px] text-center">{weekLabel()}</span>
        <button class="px-2 py-0.5 text-[12px] text-(--text-3) hover:text-(--text) hover:bg-(--bg-hover) rounded" onClick={props.onNextWeek}>›</button>
        <button class="ml-1 px-2 py-0.5 text-[11px] text-(--text-3) hover:text-(--text) hover:bg-(--bg-hover) rounded border border-(--border)" onClick={props.onToday}>今天</button>
      </div>

      {/* 8-column grid */}
      <div
        class="flex-1 min-h-0 grid"
        style={{ 'grid-template-columns': 'repeat(7, minmax(0, 1fr)) 1.6fr' }}
      >
        <For each={weekDates()}>
          {(day, i) => {
            const isToday = day === props.todayStr
            const items = () => buildCellItems(day, props.filter(), {
              dayData: dayData(),
              taskDayData: taskDayData(),
              entryDayData: entryDayData(),
            })
            return (
              <div class={`flex flex-col min-h-0 border-r border-(--border)${isToday ? ' bg-(--accent-bg)' : ''}`}>
                <div class={`shrink-0 px-1.5 py-1 text-center select-none border-b border-(--border)${i() >= 5 ? ' text-(--accent)' : ' text-(--text-3)'}`}>
                  <div class="text-[10px]">{WEEKDAYS_LONG[i()]}</div>
                  <div class={`text-[13px] font-semibold${isToday ? ' text-(--accent)' : ' text-(--text-2)'}`}>{day.slice(8)}</div>
                </div>
                <div class="flex-1 min-h-0 overflow-y-auto p-1 flex flex-col gap-0.5">
                  <For each={items()}>
                    {(item) => <CellItemButton item={item} onOpenFile={props.onOpenFile} wrap />}
                  </For>
                </div>
              </div>
            )
          }}
        </For>

        {/* 8th column: weekly summary & reflection */}
        <div class="min-h-0 overflow-hidden">
          <WeeklyNoteEditor path={notePath()} label="本周总结与反思" />
        </div>
      </div>
    </div>
  )
}
