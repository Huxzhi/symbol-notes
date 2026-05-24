import { batch, createMemo, createSignal, For, Show } from 'solid-js'
import { globalStore, findLeafInTree, activeRoot, activeLayout, ROOT_TABS_ID } from '../stores/globalStore'
import { workspaceActions } from '../actions/workspaceActions'
import { getFileViewForExt } from '../lib/viewRegistry'
import { toIsoDate, buildCalendarGrid, buildDayData, WEEKDAYS_LONG } from '../lib/calendarUtils'
import type { ViewComponentProps, ViewState, WorkspaceLeaf, WorkspaceNode } from '../stores/types'

function findLeafWithFile(root: WorkspaceNode, path: string): WorkspaceLeaf | null {
  if (root.type === 'leaf' && root.viewState.state.file === path) return root
  if (root.type === 'tabs') return root.children.find(l => l.viewState.state.file === path) ?? null
  if (root.type === 'split') {
    for (const child of root.children) {
      const found = findLeafWithFile(child, path)
      if (found) return found
    }
  }
  return null
}

function openFileInWorkspace(path: string): void {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  const def = getFileViewForExt(ext)
  if (!def) return
  const viewState: ViewState = { type: def.type, state: { file: path } }
  const existing = findLeafWithFile(activeRoot().main, path)
  if (existing) { workspaceActions.activateLeaf(existing.id); return }
  const { activeLeafId } = activeLayout()
  const activeLeaf = activeLeafId ? findLeafInTree(activeRoot().main, activeLeafId) : null
  if (activeLeaf && !activeLeaf.pinned && activeLeaf.viewState.type !== 'calendar') {
    workspaceActions.setLeafViewState(activeLeafId!, viewState)
    return
  }
  workspaceActions.createLeaf(ROOT_TABS_ID, viewState)
}

export function CalendarPage(_props: ViewComponentProps) {
  const now = new Date()
  const todayStr = toIsoDate(now.getFullYear(), now.getMonth(), now.getDate())

  const [viewYear, setViewYear] = createSignal(now.getFullYear())
  const [viewMonth, setViewMonth] = createSignal(now.getMonth())

  const dayData = createMemo(() => buildDayData(globalStore.knowledge.index))
  const calendarGrid = createMemo(() => buildCalendarGrid(viewYear(), viewMonth()))

  const prevMonth = () => batch(() => {
    if (viewMonth() === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  })
  const nextMonth = () => batch(() => {
    if (viewMonth() === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  })
  const goToday = () => batch(() => {
    setViewYear(now.getFullYear())
    setViewMonth(now.getMonth())
  })

  return (
    <div class="flex-1 flex flex-col overflow-hidden bg-[var(--bg-base)]">

      {/* Toolbar */}
      <div class="flex items-center gap-2 px-4 py-2 border-b border-[var(--border)] shrink-0">
        <button
          class="px-2.5 py-1 text-[11px] text-[var(--text-3)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] rounded transition-colors border border-[var(--border)]"
          onClick={goToday}
        >今天</button>
        <button
          class="w-7 h-7 flex items-center justify-center text-[var(--text-3)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] rounded transition-colors text-[12px]"
          onClick={prevMonth}
        >◀</button>
        <button
          class="w-7 h-7 flex items-center justify-center text-[var(--text-3)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] rounded transition-colors text-[12px]"
          onClick={nextMonth}
        >▶</button>
        <h2 class="text-[15px] font-semibold text-[var(--text)] ml-1 select-none">
          {viewYear()}年{viewMonth() + 1}月
        </h2>
        <div class="flex-1" />
        <div class="flex items-center gap-4 text-[10px] text-[var(--text-4)]">
          <span class="flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-sm bg-[var(--bg-hover)]" />日记
          </span>
          <span class="flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-sm bg-[var(--accent)]" />创建
          </span>
          <span class="flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-sm bg-[var(--link-2)]" />修改
          </span>
        </div>
      </div>

      {/* Weekday header row */}
      <div class="grid grid-cols-7 border-b border-[var(--border)] bg-[var(--bg-surface)] shrink-0">
        <For each={WEEKDAYS_LONG}>
          {(d, i) => (
            <div class={`py-2 text-center text-[11px] select-none
              ${i() < 6 ? 'border-r border-[var(--border)]' : ''}
              ${i() >= 5 ? 'text-[var(--accent)]' : 'text-[var(--text-3)]'}`}
            >{d}</div>
          )}
        </For>
      </div>

      {/* Calendar grid */}
      <div
        class="flex-1 grid grid-cols-7 border-l border-t border-[var(--border)] overflow-hidden"
        style={{ 'grid-auto-rows': '1fr' }}
      >
        <For each={calendarGrid()}>
          {(day, idx) => {
            const isLastCol = () => (idx() + 1) % 7 === 0

            if (day === null) {
              return (
                <div class={`border-r border-b border-[var(--border)] bg-[var(--bg-surface)]
                  ${isLastCol() ? 'border-r-0' : ''}`}
                />
              )
            }

            const dayStr = () => toIsoDate(viewYear(), viewMonth(), day)
            const isToday = () => dayStr() === todayStr
            const dated   = () => dayData().dated[dayStr()]   ?? []
            const created = () => dayData().created[dayStr()] ?? []
            const updated = () => dayData().updated[dayStr()] ?? []

            return (
              <div
                class={`border-b border-[var(--border)] p-1.5 flex flex-col min-h-0 overflow-hidden group
                  ${isLastCol() ? '' : 'border-r border-[var(--border)]'}
                  ${isToday() ? 'bg-[var(--accent-bg)]' : 'bg-[var(--bg-base)]'}`}
              >
                <div class={`shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-[12px] font-semibold mb-1 select-none
                  ${isToday()
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--text-3)] group-hover:text-[var(--text-2)]'}`}
                >
                  {day}
                </div>
                <div class="flex-1 overflow-y-auto min-h-0 flex flex-col gap-0.5">
                  <For each={dated()}>
                    {(path) => (
                      <button
                        class="text-left text-[10px] leading-snug px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-2)] truncate w-full cursor-pointer hover:bg-[var(--text-4)] hover:text-[var(--text)] transition-colors"
                        onClick={() => openFileInWorkspace(path)}
                        title={path}
                      >
                        {path.split('/').pop()?.replace(/\.md$/, '')}
                      </button>
                    )}
                  </For>
                  <For each={created()}>
                    {(path) => (
                      <button
                        class="text-left text-[10px] leading-snug px-1.5 py-0.5 rounded bg-[var(--accent-bg)] text-[var(--accent)] truncate w-full cursor-pointer hover:bg-[var(--accent)] hover:text-white transition-colors"
                        onClick={() => openFileInWorkspace(path)}
                        title={path}
                      >
                        {path.split('/').pop()?.replace(/\.md$/, '')}
                      </button>
                    )}
                  </For>
                  <For each={updated()}>
                    {(path) => (
                      <button
                        class="text-left text-[10px] leading-snug px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--link-2)] truncate w-full cursor-pointer hover:bg-[var(--link-2)] hover:text-white transition-colors"
                        onClick={() => openFileInWorkspace(path)}
                        title={path}
                      >
                        {path.split('/').pop()?.replace(/\.md$/, '')}
                      </button>
                    )}
                  </For>
                  <Show when={dated().length === 0 && created().length === 0 && updated().length === 0}>
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
