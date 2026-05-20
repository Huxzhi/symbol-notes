import { createMemo } from 'solid-js'
import { editorStore } from '../stores/editorStore'
import { parseFrontmatter } from '../lib/parseFrontmatter'

export function StatusBar() {
  const stats = createMemo(() => {
    const { body } = parseFrontmatter(editorStore.content)
    const words = body.trim() ? body.trim().split(/\s+/).length : 0
    const lines = editorStore.cmView?.state.doc.lines ?? 0
    return { words, lines }
  })

  return (
    <div class="h-6 bg-[#0d0d1a] border-t border-[#1e1e35] px-3 flex items-center gap-4 text-[10px] text-[#444] shrink-0">
      <span>{stats().words} 字</span>
      <span>{stats().lines} 行</span>
      <div class="flex-1" />
      <span class={editorStore.isDirty ? 'text-[#6c63ff]' : ''}>
        {editorStore.isDirty ? '未保存' : '已保存'}
      </span>
    </div>
  )
}
