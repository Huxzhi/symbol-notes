import { For, createMemo, Show } from 'solid-js'
import { parseFrontmatter, serializeFrontmatter } from '../lib/parseFrontmatter'
import { editorStore, setEditorStore } from '../stores/editorStore'
import { fileSystemStore } from '../stores/fileSystemStore'

export function PropertiesPanel() {
  const parsed = createMemo(() => parseFrontmatter(editorStore.content))
  const fields = createMemo(() => Object.entries(parsed().frontmatter))

  function updateField(key: string, value: string) {
    const { frontmatter, body } = parsed()
    const updated = { ...frontmatter, [key]: value }
    setEditorStore('content', serializeFrontmatter(updated, body))
    setEditorStore('isDirty', true)
  }

  function deleteField(key: string) {
    const { frontmatter, body } = parsed()
    const { [key]: _, ...rest } = frontmatter as Record<string, unknown>
    setEditorStore('content', serializeFrontmatter(rest, body))
    setEditorStore('isDirty', true)
  }

  function addField() {
    const { frontmatter, body } = parsed()
    const newKey = `field${Object.keys(frontmatter).length + 1}`
    const updated = { ...frontmatter, [newKey]: '' }
    setEditorStore('content', serializeFrontmatter(updated, body))
    setEditorStore('isDirty', true)
  }

  return (
    <Show when={fileSystemStore.activeFilePath}>
      <div class="bg-[#16162a] border-b border-[#2d2d4a] px-4 py-2.5 shrink-0">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-[10px] text-[#6c63ff] font-bold tracking-widest uppercase">Properties</span>
          <button
            onClick={addField}
            class="text-[10px] text-[#a09cf7] bg-[#6c63ff22] border border-[#6c63ff44] px-2 py-0.5 rounded hover:bg-[#6c63ff33] cursor-pointer"
          >
            + 添加字段
          </button>
        </div>
        <div class="flex flex-col gap-1.5">
          <For each={fields()}>
            {([key, value]) => (
              <div class="flex items-center gap-1.5">
                <span class="text-[11px] text-[#6c63ff] font-semibold w-16 text-right shrink-0">{key}</span>
                <span class="text-[#3a3a5c] shrink-0">:</span>
                <input
                  class="flex-1 bg-[#1e1e35] border border-[#3a3a5c] rounded px-2 py-0.5 text-[12px] text-[#e0e0ff] font-mono focus:outline-none focus:border-[#6c63ff] min-w-0"
                  value={String(value ?? '')}
                  onInput={(e) => updateField(key, e.currentTarget.value)}
                />
                <button
                  onClick={() => deleteField(key)}
                  class="text-[#3a3a5c] hover:text-[#888] text-[12px] cursor-pointer px-1 shrink-0"
                >
                  ✕
                </button>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}
