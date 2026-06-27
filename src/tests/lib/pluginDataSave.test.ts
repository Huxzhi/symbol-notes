import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileSystemAdapter } from '../../vault/fs/types'

// idb-keyval 需 IndexedDB，node 环境下打桩。
vi.mock('idb-keyval', () => ({
  get: vi.fn(async () => undefined),
  set: vi.fn(async () => {}),
}))

// 用真实 vaultConfig（含 meta 信号）+ 真实 pluginData（含落盘 effect）。
const vaultConfig = await import('../../vault/vaultConfig')
const { getPluginConfig } = await import('../../lib/pluginData')

function mockAdapter(): FileSystemAdapter & { writeText: ReturnType<typeof vi.fn> } {
  return {
    name: 'mock',
    readText: vi.fn(async () => '{}'),
    writeText: vi.fn(async () => {}),
    getMtime: vi.fn(async () => 0),
    getFile: vi.fn(),
    statFiles: vi.fn(async () => new Map()),
    deleteEntry: vi.fn(async () => {}),
    createDirectory: vi.fn(async () => {}),
    scanTree: vi.fn(async () => []),
  } as unknown as FileSystemAdapter & { writeText: ReturnType<typeof vi.fn> }
}

describe('pluginData 落盘 effect 只应依赖 config，不应依赖 vault meta', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vaultConfig.setAdapter(null)
  })

  it('config 未变时，meta 信号变化不得触发（空配置）落盘 —— 防 clobber', async () => {
    const adapter = mockAdapter()
    vaultConfig.setAdapter(adapter)
    await vaultConfig.markActive() // 配置进入 active

    // 模拟：插件 store 在 hydrate 之前被创建（config 仍为空）
    getPluginConfig('clobber-test')
    await vi.runOnlyPendingTimersAsync() // 让创建时的 effect/debounce 落定
    adapter.writeText.mockClear()

    // 启动期 loadMeta/markActive 会改写 meta 信号；此时 config 尚未 hydrate
    await vaultConfig.markActive()
    await vi.runAllTimersAsync()

    // config 没变 → 落盘 effect 不应被 meta 变化牵连而写出空配置
    expect(adapter.writeText).not.toHaveBeenCalled()
  })
})
