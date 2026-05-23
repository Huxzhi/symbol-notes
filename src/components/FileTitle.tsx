import { createMemo, createSignal, Show } from 'solid-js'
import { fileSystemStore } from '../stores/fileSystemStore'
import { renameFile } from '../services/fileSystemService'

export function FileTitle() {
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal('')
  // Guard against onBlur firing after keyboard-handled cancel/confirm
  let handled = false

  const stem = createMemo(() => {
    const path = fileSystemStore.activeFilePath
    if (!path) return ''
    return (path.split('/').pop() ?? path).replace(/\.md$/, '')
  })

  const startEdit = () => {
    handled = false
    setDraft(stem())
    setEditing(true)
  }

  const cancel = () => {
    handled = true
    setEditing(false)
  }

  const confirm = async () => {
    if (handled) return
    handled = true
    setEditing(false)
    const name = draft().trim()
    const path = fileSystemStore.activeFilePath
    if (!name || name === stem() || !path) return
    await renameFile(path, name)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); void confirm() }
    else if (e.key === 'Escape') { e.preventDefault(); cancel() }
  }

  return (
    <Show when={fileSystemStore.activeFilePath}>
      <div class="px-8 pt-6 pb-1 shrink-0 min-w-0">
        <Show
          when={editing()}
          fallback={
            <h1
              class="text-[22px] font-bold text-[var(--text)] cursor-text hover:text-[var(--accent)] transition-colors truncate leading-tight"
              onClick={startEdit}
              title="点击修改文件名"
            >
              {stem() || '未命名'}
            </h1>
          }
        >
          <input
            class="w-full bg-transparent border-b-2 border-[var(--accent)] outline-none text-[22px] font-bold text-[var(--text)] pb-0.5 leading-tight"
            value={draft()}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={onKeyDown}
            onBlur={() => void confirm()}
            ref={(el) => setTimeout(() => { el.focus(); el.select() }, 0)}
            spellcheck={false}
          />
        </Show>
      </div>
    </Show>
  )
}
