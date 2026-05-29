import { CalendarDays, CalendarRange } from 'lucide-solid'
import { definePlugin } from '../../lib/pluginRegistry'
import { CalendarPanel } from './CalendarPanel'
import { CalendarViewer } from './CalendarViewer'
import type { SettingsTabProps } from '../../lib/pluginRegistry'

function CalendarSettings(props: SettingsTabProps) {
  const config = () => props.getConfig({
    weekStartsMonday: true,
    showLunar: false,
  })

  return (
    <div class="flex flex-col gap-5">
      <ToggleRow
        label="周一作为一周起始"
        description="将周一设为日历每行的第一天"
        checked={config().weekStartsMonday}
        onChange={(v) => props.setConfig({ weekStartsMonday: v })}
      />
      <ToggleRow
        label="显示农历"
        description="在日历格子中叠加显示农历日期"
        checked={config().showLunar}
        onChange={(v) => props.setConfig({ showLunar: v })}
      />
    </div>
  )
}

function ToggleRow(props: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label class="flex items-start gap-3 cursor-pointer select-none">
      <div class="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          class="sr-only"
          checked={props.checked}
          onChange={(e) => props.onChange(e.currentTarget.checked)}
        />
        <div class={`w-9 h-5 rounded-full transition-colors ${props.checked ? 'bg-(--accent)' : 'bg-(--bg-active)'}`} />
        <div class={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${props.checked ? 'translate-x-4' : ''}`} />
      </div>
      <div>
        <div class="text-[13px] t-base font-medium">{props.label}</div>
        {props.description && (
          <div class="text-[11px] t-3 mt-0.5 leading-relaxed">{props.description}</div>
        )}
      </div>
    </label>
  )
}

export const CalendarPlugin = definePlugin({
  id: 'calendar',
  name: '日历',
  description: '日历面板与日历大图视图',
  defaultEnabled: true,
  setup(ctx) {
    ctx.view({
      kind: 'panel',
      position: 'left',
      type: 'calendar-panel',
      getDisplayText: () => '日历',
      component: CalendarPanel,
    })

    ctx.view({
      kind: 'page',
      type: 'calendar',
      getDisplayText: () => '日历',
      getIcon: () => <CalendarRange size={11} />,
      component: CalendarViewer,
    })

    ctx.ribbon({
      id: 'calendar-panel',
      title: '日历',
      getIcon: () => <CalendarDays size={18} />,
      onClick: () => ctx.workspace.switchSidebarPanel('left', 'calendar-panel'),
      isActive: () => ctx.workspace.activeSidebarType('left') === 'calendar-panel',
    })

    ctx.ribbon({
      id: 'calendar-page',
      title: '日历大图',
      getIcon: () => <CalendarRange size={18} />,
      onClick: () => ctx.workspace.openPage('calendar'),
      isActive: () => {
        const id = ctx.workspace.activeLeafId()
        return id ? ctx.workspace.getLeafsByType('calendar').includes(id) : false
      },
    })

    ctx.settings.tab({
      name: '日历',
      component: CalendarSettings,
    })
  },
})
