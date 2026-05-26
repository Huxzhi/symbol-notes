import { createMemo, createSignal, For, Show } from 'solid-js'
import { workspaceActions } from '../actions/workspaceActions'
import { parseFrontmatter } from '../lib/parseFrontmatter'
import { activeLayout, globalStore } from '../stores/globalStore'
import { runtimeStore } from '../stores/runtimeStore'

export function StatusBar() {
  const [showSwitcher, setShowSwitcher] = createSignal(false)
  const [renamingId, setRenamingId] = createSignal<string | null>(null)

  const activeRuntime = () => {
    const { activeLeafId } = activeLayout()
    return activeLeafId ? runtimeStore.leafInstances[activeLeafId] : null
  }

  const stats = createMemo(() => {
    const text = activeRuntime()?.cmView?.state.doc.toString() ?? ''
    const { body } = parseFrontmatter(text)
    const words = body.trim() ? body.trim().split(/\s+/).length : 0
    const lines = activeRuntime()?.cmView?.state.doc.lines ?? 0
    return { words, lines }
  })

  const layouts = () => globalStore.workspace.layouts
  const activeId = () => globalStore.workspace.activeLayoutId

  return (
    <div class="relative">
      {/* Workspace switcher popover */}
      <Show when={showSwitcher()}>
        <div
          class="absolute bottom-full left-0 mb-1 bg-(--bg-surface) border border-(--border)] rounded shadow-lg z-50 min-w-45 py-1"
          onMouseLeave={() => setShowSwitcher(false)}
        >
          <For each={layouts()}>
            {(layout) => (
              <div class="flex items-center gap-1 px-2 py-1 hover:bg-(--bg-hover) group">
                <span class="w-3 text-(--accent) text-[10px]">
                  {layout.id === activeId() ? '✓' : ''}
                </span>
                <Show
                  when={renamingId() === layout.id}
                  fallback={
                    <span
                      class="flex-1 text-[11px] text-(--text-2) cursor-pointer"
                      onClick={() => workspaceActions.switchLayout(layout.id)}
                    >
                      {layout.name}
                    </span>
                  }
                >
                  <input
                    class="flex-1 text-[11px] bg-(--bg-input) text-(--text) px-1 rounded outline-none"
                    value={layout.name}
                    autofocus
                    onBlur={(e) => {
                      workspaceActions.renameLayout(
                        layout.id,
                        e.currentTarget.value.trim() || layout.name,
                      )
                      setRenamingId(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                  />
                </Show>
                <button
                  class="text-[10px] text-(--text-4) hover:text-(--text-2) opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => setRenamingId(layout.id)}
                  title="重命名"
                >
                  ✏
                </button>
                <Show when={layouts().length > 1}>
                  <button
                    class="text-[10px] text-(--text-4) hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => workspaceActions.deleteLayout(layout.id)}
                    title="删除"
                  >
                    ×
                  </button>
                </Show>
              </div>
            )}
          </For>
          <div class="border-t border-(--border)] mt-1 pt-1">
            <button
              class="w-full text-left px-4 py-1 text-[11px] text-(--text-3) hover:bg-(--bg-hover) hover:text-(--text)"
              onClick={() => {
                const n = layouts().length + 1
                workspaceActions.createLayout(`工作区 ${n}`)
              }}
            >
              + 新建工作区
            </button>
          </div>
        </div>
      </Show>

      {/* Status bar */}
      <div class="h-6 bg-(--bg-base) border-t border-(--border)] px-3 flex items-center gap-4 text-[10px] text-(--text-4) shrink-0">
        <button
          class="hover:text-(--text-2) transition-colors"
          onClick={() => setShowSwitcher((v) => !v)}
          title="切换工作区"
        >
          {activeLayout().name}
        </button>
        <span>{stats().words} 字</span>
        <span>{stats().lines} 行</span>
        <div class="flex-1" />
        <Show when={runtimeStore.isIndexing}>
          <span class="flex items-center gap-1 text-(--text-3)">
            <span class="inline-block w-1.5 h-1.5 rounded-full bg-(--accent) animate-pulse" />
            后台检测中
          </span>
        </Show>
        <span class={activeRuntime()?.isDirty ? 'text-(--accent)' : ''}>
          {activeRuntime()?.isDirty ? '未保存' : '已保存'}
        </span>
      </div>
    </div>
  )
}
