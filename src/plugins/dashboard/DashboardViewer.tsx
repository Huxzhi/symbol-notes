import {
  createEffect,
  createMemo,
  createResource,
  For,
  onCleanup,
  Show,
} from 'solid-js'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting } from '@codemirror/language'
import { EditorState, RangeSetBuilder, StateField } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
} from '@codemirror/view'
import { GFM } from '@lezer/markdown'
import { darkHighlightStyle, darkTheme } from '../../lib/cmTheme'
import { livePreviewExtension } from '../../lib/livePreviewExtension'
import { embedPreviewPlugin, embedTheme } from '../../lib/embedExtension'
import { loadFromStorage } from '../../lib/localStorage'
import { readFile, writeFile } from '../../services/fileIO'
import { fileActions } from '../../stores/runtimeStore'
import { vaultStore, vaultActions } from '../../stores/vaultStore'
import { workspaceActions } from '../../stores/workspaceStore'
import type { ViewComponentProps } from '../../stores/types'
import { buildWeekTaskData } from './dashboardUtils'
import type { WeekTask } from './dashboardUtils'
import { todayPath } from '../daily-note/formatDate'
import {
  getISOWeekDates,
  getISOWeekString,
  monthFilePath,
  weekFilePath,
} from './dashboardUtils'

// ── Frontmatter hide decoration ───────────────────────────────────────────────

function buildFrontmatterDeco(docStr: string): DecorationSet {
  if (!docStr.startsWith('---')) return Decoration.none
  const end = docStr.indexOf('\n---', 3)
  if (end === -1) return Decoration.none
  // Hide through the trailing newline after closing ---
  const hideEnd = end + 4 < docStr.length && docStr[end + 4] === '\n' ? end + 5 : end + 4
  const builder = new RangeSetBuilder<Decoration>()
  builder.add(0, hideEnd, Decoration.replace({}))
  return builder.finish()
}

// StateField (not ViewPlugin) is required for decorations that replace line breaks.
const hideFrontmatterExtension = StateField.define<DecorationSet>({
  create(state) {
    return buildFrontmatterDeco(state.doc.toString())
  },
  update(deco, tr) {
    return tr.docChanged ? buildFrontmatterDeco(tr.newDoc.toString()) : deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

// ── PlanEditor ────────────────────────────────────────────────────────────────

function PlanEditor(props: {
  path: string
  label: string
  onOpen: () => void
  onCreate?: () => void
}) {
  let editorHost!: HTMLDivElement
  let cmView: EditorView | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  const fileExists = () => !!vaultStore.files[props.path]

  // Source includes file existence so the resource refetches when vault indexes the file.
  const [content] = createResource(
    () => (vaultStore.files[props.path] ? props.path : null),
    async (path) => {
      try {
        return await readFile(path)
      } catch {
        return null
      }
    },
  )

  function scheduleSave() {
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      saveTimer = null
      if (!cmView) return
      const full = cmView.state.doc.toString()
      await writeFile(props.path, full)
      vaultActions.reindexFile(props.path, full).catch(() => {})
    }, 500)
  }

  createEffect(() => {
    const text = content()
    if (text === undefined) return

    if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
    cmView?.destroy()
    cmView = null

    if (text === null) return

    const state = EditorState.create({
      doc: text,
      extensions: [
        markdown({ codeLanguages: languages, extensions: [GFM] }),
        syntaxHighlighting(darkHighlightStyle),
        darkTheme,
        embedTheme,
        embedPreviewPlugin,
        livePreviewExtension,
        hideFrontmatterExtension,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) scheduleSave()
        }),
      ],
    })
    cmView = new EditorView({ state, parent: editorHost })
  })

  onCleanup(() => {
    if (saveTimer !== null) clearTimeout(saveTimer)
    cmView?.destroy()
    cmView = null
  })

  return (
    <div class="flex flex-col h-full overflow-hidden">
      <div class="flex items-center gap-1 px-3 py-1 border-b border-(--border) shrink-0">
        <span class="flex-1 text-[10px] text-(--accent) font-bold tracking-widest uppercase">
          {props.label}
        </span>
        <Show when={props.onCreate && !fileExists()}>
          <button
            class="text-[10px] px-1.5 py-0.5 rounded text-(--text-3) hover:text-(--text) hover:bg-(--bg-hover) transition-colors"
            onClick={props.onCreate}
          >
            新建
          </button>
        </Show>
        <Show when={fileExists()}>
          <button
            class="text-[10px] px-1.5 py-0.5 rounded text-(--text-3) hover:text-(--accent) hover:bg-(--bg-hover) transition-colors"
            onClick={props.onOpen}
            title="在编辑器中打开"
          >
            ↗
          </button>
        </Show>
      </div>
      <div class="flex-1 overflow-y-auto min-h-0 relative">
        <Show when={content.loading}>
          <div class="px-3 py-3 text-[11px] text-(--text-4) italic">加载中…</div>
        </Show>
        <Show when={!content.loading && !fileExists()}>
          <div class="flex flex-col items-center justify-center py-8 gap-2 text-(--text-4)">
            <span class="text-[11px] italic">文件不存在</span>
            <Show when={props.onCreate}>
              <button
                class="text-[11px] px-2 py-1 rounded border border-(--border) hover:border-(--accent) hover:text-(--accent) transition-colors"
                onClick={props.onCreate}
              >
                新建 {props.path.split('/').pop()}
              </button>
            </Show>
          </div>
        </Show>
        <div ref={editorHost} />
      </div>
    </div>
  )
}

// ── WeekTaskGrid ──────────────────────────────────────────────────────────────

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function WeekTaskGrid(props: {
  weekDates: string[]
  today: string
  onTaskClick: (path: string) => void
}) {
  const taskDayData = () => buildWeekTaskData(vaultStore.taskMap)

  return (
    <div class="grid grid-cols-7 gap-px bg-(--border) rounded overflow-hidden border border-(--border)">
      <For each={props.weekDates}>
        {(date, i) => {
          const isToday = () => date === props.today
          const tasks = () => taskDayData()[date] ?? []
          const dayNum = () => date.slice(8)

          return (
            <div
              class={`flex flex-col min-h-[80px] p-1.5 gap-0.5 ${
                isToday() ? 'bg-(--accent-bg)' : 'bg-(--bg-base)'
              }`}
            >
              <div
                class={`text-[9px] font-medium mb-0.5 select-none ${
                  isToday() ? 'text-(--accent)' : 'text-(--text-4)'
                }`}
              >
                {WEEKDAY_LABELS[i()]}
                <span
                  class={`ml-1 text-[10px] font-bold ${
                    isToday() ? 'text-(--accent)' : 'text-(--text-2)'
                  }`}
                >
                  {dayNum()}
                </span>
              </div>
              <For each={tasks()}>
                {(task: WeekTask) => (
                  <button
                    class={`text-left text-[10px] leading-snug truncate px-0.5 rounded transition-colors hover:bg-(--bg-hover) ${
                      task.checked ? 'line-through text-(--text-4)' : 'text-(--text-2)'
                    }`}
                    onClick={() => props.onTaskClick(task.path)}
                    title={task.cleanText}
                  >
                    <span class="mr-0.5 text-[9px] opacity-60">
                      {task.checked ? '✓' : '○'}
                    </span>
                    {task.cleanText}
                  </button>
                )}
              </For>
            </div>
          )
        }}
      </For>
    </div>
  )
}

// ── DashboardViewer ───────────────────────────────────────────────────────────

const DAILY_DEFAULTS = { folder: 'journal', dateFormat: 'YYYY-MM-DD', autoCreate: false }
const DASHBOARD_DEFAULTS = { weeklyFolder: 'weekly', monthlyFolder: 'monthly' }

export function DashboardViewer(
  props: ViewComponentProps & {
    getConfig: <T extends Record<string, unknown>>(defaults: T) => T
  },
) {
  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)

  const weekDates = createMemo(() => getISOWeekDates(now))
  const weekLabel = createMemo(() => getISOWeekString(now))

  const dailyConfig = () => loadFromStorage('sn-plugin-daily-note', DAILY_DEFAULTS)
  const todayFilePath = createMemo(() =>
    todayPath(dailyConfig().folder as string, dailyConfig().dateFormat as string, now),
  )

  const config = () => props.getConfig(DASHBOARD_DEFAULTS)
  const weeklyPath = createMemo(() => weekFilePath(config().weeklyFolder as string, now))
  const monthlyPath = createMemo(() => monthFilePath(config().monthlyFolder as string, now))

  async function createAndOpen(path: string) {
    const created = await fileActions.createFile(path)
    if (created) workspaceActions.openFile(created)
  }

  return (
    <div class="flex flex-col h-full overflow-hidden bg-(--bg-base)">
      {/* Toolbar */}
      <div class="flex items-center gap-3 px-4 py-2 border-b border-(--border) shrink-0">
        <span class="flex-1 text-[10px] text-(--accent) font-bold tracking-widest uppercase">
          仪表盘
        </span>
        <span class="text-[11px] text-(--text-3) font-medium">{weekLabel()}</span>
        <span class="text-[11px] text-(--text-4)">{todayStr}</span>
      </div>

      {/* Week task grid */}
      <div class="px-4 py-3 border-b border-(--border) shrink-0">
        <div class="text-[9px] text-(--text-4) uppercase tracking-widest mb-2 select-none">
          本周任务
        </div>
        <WeekTaskGrid
          weekDates={weekDates()}
          today={todayStr}
          onTaskClick={(path) => workspaceActions.openFile(path)}
        />
      </div>

      {/* Today + Weekly plans — equal-width columns */}
      <div class="flex flex-1 min-h-0 border-b border-(--border) overflow-hidden">
        <div class="flex-1 border-r border-(--border) min-w-0 overflow-hidden">
          <PlanEditor
            path={todayFilePath()}
            label="今日计划"
            onOpen={() => workspaceActions.openFile(todayFilePath())}
          />
        </div>
        <div class="flex-1 min-w-0 overflow-hidden">
          <PlanEditor
            path={weeklyPath()}
            label="本周计划"
            onOpen={() => workspaceActions.openFile(weeklyPath())}
            onCreate={() => void createAndOpen(weeklyPath())}
          />
        </div>
      </div>

      {/* Monthly plan */}
      <div class="flex-1 min-h-0 overflow-hidden">
        <PlanEditor
          path={monthlyPath()}
          label="月度计划"
          onOpen={() => workspaceActions.openFile(monthlyPath())}
          onCreate={() => void createAndOpen(monthlyPath())}
        />
      </div>
    </div>
  )
}
