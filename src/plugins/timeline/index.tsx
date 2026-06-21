import { GitBranch } from 'lucide-solid'
import { definePlugin } from '../../lib/pluginRegistry'
import { TimelineView } from './TimelineView'

export const TimelinePlugin = definePlugin({
  id: 'timeline',
  name: '主题时间线',
  description: '以一篇笔记为焦点，沿时间轴铺开其双链邻域',
  setup(ctx) {
    ctx.view({
      kind: 'page',
      type: 'timeline',
      getDisplayText: () => '时间线',
      getIcon: () => <GitBranch size={11} />,
      component: TimelineView,
    })

    // 右键笔记 → 在时间线中查看（以该篇为焦点）
    ctx.contextMenu('file', (d) => {
      const path = d.path
      if (!path || !path.endsWith('.md')) return []
      return [
        {
          label: '在时间线中查看',
          action: () =>
            ctx.workspace.openLeaf(
              { type: 'timeline', state: { focus: path } },
              { area: 'main', newTab: true },
            ),
        },
      ]
    })

    // Ribbon：用当前活动笔记作焦点打开时间线
    ctx.ribbon({
      id: 'timeline-page',
      title: '主题时间线',
      getIcon: () => <GitBranch size={18} />,
      onClick: () => {
        const focus = ctx.workspace.activeFilePath()
        ctx.workspace.openLeaf(
          { type: 'timeline', state: { focus: focus ?? '' } },
          { area: 'main', newTab: true },
        )
      },
      isActive: () => {
        const id = ctx.workspace.activeLeafId()
        return id ? ctx.workspace.getLeafsByType('timeline').includes(id) : false
      },
    })
  },
})
