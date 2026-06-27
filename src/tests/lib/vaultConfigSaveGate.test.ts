import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEffect, createRoot } from 'solid-js'
import { createStore } from 'solid-js/store'
import type { FileSystemAdapter } from '../../vault/fs/types'
import type { WorkspaceState } from '../../stores/types'

// idb-keyval 需 IndexedDB，node 环境下打桩。
vi.mock('idb-keyval', () => ({
  get: vi.fn(async () => undefined),
  set: vi.fn(async () => {}),
}))

const vaultConfig = await import('../../vault/vaultConfig')

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

const ws = (id: string): WorkspaceState =>
  ({ layouts: {}, activeLayoutId: id }) as unknown as WorkspaceState

describe('vaultConfig 保存门不得把调用方 effect 绑到 meta 信号上', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vaultConfig.setAdapter(null)
  })

  it('workspace 落盘 effect：config 未变时 meta 变化不得触发（默认值）落盘 —— 防 clobber', async () => {
    const adapter = mockAdapter()
    vaultConfig.setAdapter(adapter)
    await vaultConfig.markActive()

    // 模拟 workspaceStore 的落盘 effect：hydrate 前持默认（空）workspace。
    createRoot(() => {
      const [store] = createStore<WorkspaceState>(ws('default'))
      createEffect(() => vaultConfig.saveWorkspace(store))
    })
    await vi.runOnlyPendingTimersAsync() // 让创建时的 effect/debounce 落定
    adapter.writeText.mockClear()

    // 启动期 loadMeta/markActive 改写 meta 信号，此时 workspace 尚未 hydrate
    await vaultConfig.markActive()
    await vi.runAllTimersAsync()

    // workspace 未变 → 不应被 meta 牵连写出默认 workspace
    expect(adapter.writeText).not.toHaveBeenCalled()
  })
})
