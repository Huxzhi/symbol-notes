import { createMemo, Show } from 'solid-js'
import { editorStore } from '../stores/editorStore'
import { knowledgeStore } from '../stores/knowledgeStore'
import { parseFrontmatter } from '../lib/parseFrontmatter'

export function StatusBar() {
  const stats = createMemo(() => {
    const { body } = parseFrontmatter(editorStore.content)
    const words = body.trim() ? body.trim().split(/\s+/).length : 0
    const lines = editorStore.cmView?.state.doc.lines ?? 0
    return { words, lines }
  })

  return (
    <div class="h-6 bg-[var(--bg-base)] border-t border-[var(--border)] px-3 flex items-center gap-4 text-[10px] text-[var(--text-4)] shrink-0">
      <span>{stats().words} 字</span>
      <span>{stats().lines} 行</span>
      <div class="flex-1" />
      <Show when={knowledgeStore.isIndexing}>
        <span class="flex items-center gap-1 text-[var(--text-3)]">
          <span class="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
          后台检测中
        </span>
      </Show>
      <span class={editorStore.isDirty ? 'text-[var(--accent)]' : ''}>
        {editorStore.isDirty ? '未保存' : '已保存'}
      </span>
    </div>
  )
}
