import { LayoutDashboard } from 'lucide-solid'
import { definePlugin } from '../../lib/pluginRegistry'
import type { SettingsTabProps } from '../../lib/pluginRegistry'
import type { ViewComponentProps } from '../../stores/types'
import { DashboardViewer } from './DashboardViewer'

const DEFAULTS = { weeklyFolder: 'weekly', monthlyFolder: 'monthly' }

function TextRow(props: {
  label: string
  description?: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div class="flex flex-col gap-1">
      <div class="text-[13px] t-base font-medium">{props.label}</div>
      {props.description && (
        <div class="text-[11px] t-3 leading-relaxed">{props.description}</div>
      )}
      <input
        type="text"
        class="mt-1 px-2 py-1 text-[13px] rounded border border-(--border) bg-(--bg-base) text-(--text) focus:outline-none focus:border-(--accent)"
        value={props.value}
        onInput={(e) => props.onChange(e.currentTarget.value)}
      />
    </div>
  )
}

function DashboardSettings(props: SettingsTabProps) {
  const config = () => props.getConfig(DEFAULTS)
  return (
    <div class="flex flex-col gap-5">
      <TextRow
        label="周计划文件夹"
        description="存放 YYYY-Www.md 周计划文件的文件夹，留空则存于根目录"
        value={config().weeklyFolder as string}
        onChange={(v) => props.setConfig({ weeklyFolder: v })}
      />
      <TextRow
        label="月计划文件夹"
        description="存放 YYYY-MM.md 月计划文件的文件夹，留空则存于根目录"
        value={config().monthlyFolder as string}
        onChange={(v) => props.setConfig({ monthlyFolder: v })}
      />
    </div>
  )
}

export const DashboardPlugin = definePlugin({
  id: 'dashboard',
  name: '仪表盘',
  description: '周任务概览 + 今日/本周/月度计划预览',
  defaultEnabled: true,
  setup(ctx) {
    ctx.view({
      kind: 'page',
      type: 'dashboard',
      getDisplayText: () => '仪表盘',
      getIcon: () => <LayoutDashboard size={11} />,
      component: (viewProps: ViewComponentProps) => (
        <DashboardViewer
          {...viewProps}
          getConfig={(defaults) => ctx.settings.getConfig(defaults)}
        />
      ),
    })

    ctx.ribbon({
      id: 'dashboard',
      title: '仪表盘',
      getIcon: () => <LayoutDashboard size={18} />,
      onClick: () => ctx.workspace.openPage('dashboard'),
      isActive: () => {
        const id = ctx.workspace.activeLeafId()
        return id ? ctx.workspace.getLeafsByType('dashboard').includes(id) : false
      },
    })

    ctx.settings.tab({
      name: '仪表盘',
      component: DashboardSettings,
    })
  },
})
