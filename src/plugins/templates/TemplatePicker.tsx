import { Show, For, createSignal, createMemo, createEffect } from 'solid-js'
import { listTemplates } from '../../lib/templates'
import { pickerState, resolveTemplatePicker } from './pickerStore'

export function TemplatePicker() {
  const [selected, setSelected] = createSignal<string | null>(null)
  const [name, setName] = createSignal('')
  const templates = createMemo(() => (pickerState() ? listTemplates() : []))

  // Reset selection/name whenever the picker (re)opens.
  createEffect(() => {
    if (pickerState()) {
      const first = templates()[0]
      setSelected(first ? first.path : null)
      setName('')
    }
  })

  const mode = () => pickerState()?.mode ?? 'insert'

  function confirm() {
    const path = selected()
    if (!path) return
    if (mode() === 'create' && !name().trim()) return
    resolveTemplatePicker({
      templatePath: path,
      name: mode() === 'create' ? name().trim() : undefined,
    })
  }

  return (
    <Show when={pickerState()}>
      <div
        class="fixed inset-0 z-[10000] flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.55)' }}
        onClick={() => resolveTemplatePicker(null)}
      >
        <div
          class="bg-(--bg-elevated) border border-(--border-2) rounded-lg shadow-xl p-5 flex flex-col gap-4"
          style={{ 'min-width': '340px', 'max-width': '480px' }}
          onClick={(e) => e.stopPropagation()}
        >
          <h2 class="text-[15px] font-semibold text-(--text)">
            {mode() === 'create' ? '从模板新建' : '插入模板'}
          </h2>

          <Show
            when={templates().length > 0}
            fallback={
              <p class="text-[13px] text-(--text-3) leading-relaxed">
                没有可用模板。请在设置 → 模板 中配置模板文件夹，并在其中放入 .md 模板文件。
              </p>
            }
          >
            <div class="flex flex-col gap-1 max-h-[260px] overflow-auto">
              <For each={templates()}>
                {(t) => (
                  <button
                    class={`text-left px-2 py-1.5 text-[13px] rounded border transition-colors ${
                      selected() === t.path
                        ? 'border-(--accent) text-(--accent) bg-(--accent)/10'
                        : 'border-transparent text-(--text-2) hover:bg-(--bg-active)'
                    }`}
                    onClick={() => setSelected(t.path)}
                    onDblClick={confirm}
                  >
                    {t.name}
                  </button>
                )}
              </For>
            </div>

            <Show when={mode() === 'create'}>
              <input
                type="text"
                placeholder="新笔记名称"
                class="px-2 py-1 text-[13px] rounded border border-(--border) bg-(--bg-base) text-(--text) focus:outline-none focus:border-(--accent)"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                onKeyDown={(e) => e.key === 'Enter' && confirm()}
              />
            </Show>
          </Show>

          <div class="flex justify-end gap-2">
            <button
              class="px-3 py-1.5 text-[13px] rounded border border-(--border-2) text-(--text-3) hover:text-(--text) transition-colors"
              onClick={() => resolveTemplatePicker(null)}
            >
              取消
            </button>
            <Show when={templates().length > 0}>
              <button
                class="px-3 py-1.5 text-[13px] rounded border border-(--accent) text-(--accent) hover:bg-(--accent)/10 transition-colors"
                onClick={confirm}
              >
                {mode() === 'create' ? '创建' : '插入'}
              </button>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  )
}
