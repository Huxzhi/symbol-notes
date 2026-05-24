import { For, createMemo, Show } from 'solid-js'
import { Transaction } from '@codemirror/state'
import { parseFrontmatter, serializeFrontmatter } from '../lib/parseFrontmatter'
import { editorStore, setEditorStore } from '../stores/editorStore'
import { activeFilePath } from '../stores/uiStore'

export function PropertiesPanel() {
  const text = () => editorStore.cmView?.state.doc.toString() ?? ''
  const parsed = createMemo(() => parseFrontmatter(text()))
  const fields = createMemo(() => Object.entries(parsed().frontmatter))

  function applyText(newText: string) {
    const view = editorStore.cmView
    if (!view) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: newText },
      annotations: Transaction.remote.of(true),
    })
    setEditorStore('isDirty', true)
  }

  function updateField(key: string, value: string) {
    const { frontmatter, body } = parsed()
    applyText(serializeFrontmatter({ ...frontmatter, [key]: value }, body))
  }

  function deleteField(key: string) {
    const { frontmatter, body } = parsed()
    const { [key]: _, ...rest } = frontmatter as Record<string, unknown>
    applyText(serializeFrontmatter(rest, body))
  }

  function addField() {
    const { frontmatter, body } = parsed()
    const newKey = `field${Object.keys(frontmatter).length + 1}`
    applyText(serializeFrontmatter({ ...frontmatter, [newKey]: '' }, body))
  }

  return (
    <Show when={activeFilePath()}>
      <div class="bg-[#16162a] border-b border-[#2d2d4a] px-4 py-2.5 shrink-0">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-[10px] text-[#6c63ff] font-bold tracking-widest uppercase">
            Properties
          </span>
          <button
            onClick={addField}
            class="text-[10px] text-[#a09cf7] bg-[#6c63ff22] border border-[#6c63ff44] px-2 py-0.5 rounded hover:bg-[#6c63ff33] cursor-pointer"
          >
            +
          </button>
        </div>
        <For each={fields()}>
          {([key, value]) => (
            <div class="flex items-center gap-1 mb-1 group">
              <span class="text-[10px] text-[#a09cf7] w-20 shrink-0 truncate">
                {key}
              </span>
              <input
                class="flex-1 bg-[#1e1e3a] border border-[#2d2d4a] rounded px-1.5 py-0.5 text-[10px] text-[var(--text-2)] outline-none focus:border-[#6c63ff] min-w-0"
                value={String(value)}
                onInput={e => updateField(key, e.currentTarget.value)}
              />
              <button
                class="opacity-0 group-hover:opacity-100 text-[#6c63ff88] hover:text-[#ff6c9d] text-[11px] shrink-0 cursor-pointer"
                onClick={() => deleteField(key)}
              >
                ×
              </button>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}
