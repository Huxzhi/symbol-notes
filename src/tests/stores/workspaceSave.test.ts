import { describe, expect, it, vi } from 'vitest'

// 只替换三个 save* 为 spy，其余 vaultConfig 走真实实现。
const saveWorkspace = vi.fn()
const saveSettings = vi.fn()
const saveTheme = vi.fn()
vi.mock('../../vault/vaultConfig', async (orig) => ({
  ...(await orig<typeof import('../../vault/vaultConfig')>()),
  saveWorkspace,
  saveSettings,
  saveTheme,
  isConfigActive: () => true,
}))

const { workspaceActions, DEFAULT_LAYOUT_ID } = await import(
  '../../stores/workspaceStore'
)
const { settingsActions } = await import('../../stores/settingsStore')

describe('workspace 落盘 effect 应追踪深层变更', () => {
  it('重命名布局（深层 set layouts[id].name）应触发 saveWorkspace', () => {
    saveWorkspace.mockClear() // 清掉模块加载时 effect 的首跑
    workspaceActions.renameLayout(DEFAULT_LAYOUT_ID, '改了名字')
    expect(saveWorkspace).toHaveBeenCalled()
  })
})

describe('settings/theme 落盘 effect 应追踪深层变更', () => {
  it('再次切换已存在的 pluginState（深层 set）应触发 saveSettings', () => {
    settingsActions.setPluginState('demo-plugin', true) // 首次：新增 key
    saveSettings.mockClear()
    settingsActions.setPluginState('demo-plugin', false) // 再次：深层值变更
    expect(saveSettings).toHaveBeenCalled()
  })

  it('改自定义主题变量（深层 set customThemes[i].vars）应触发 saveTheme', () => {
    const id = settingsActions.addCustomTheme('dark', 'dark', { '--accent': '#000' })
    saveTheme.mockClear()
    settingsActions.updateCustomThemeVar(id, '--accent', '#fff')
    expect(saveTheme).toHaveBeenCalled()
  })
})
