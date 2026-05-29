import { Settings as SettingsIcon } from 'lucide-solid'
import { definePlugin } from '../../lib/pluginRegistry'
import { appActions } from '../../stores/runtimeStore'

export const AppPlugin = definePlugin({
  id: 'app',
  name: '应用',
  core: true,
  setup(ctx) {
    ctx.ribbon({
      id: 'settings',
      title: '设置',
      getIcon: () => <SettingsIcon size={18} />,
      onClick: () => appActions.toggleSettings(),
      position: 'bottom',
    })
  },
})
