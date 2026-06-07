import { Show } from 'solid-js'
import { loadProgress } from '../vault/loadProgress'

export function LoadingOverlay() {
  const p = loadProgress
  return (
    <Show when={p().visible}>
      <div
        class="fixed inset-0 z-[10001] flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.6)' }}
      >
        <div
          class="bg-(--bg-elevated) border border-(--border-2) rounded-lg shadow-xl px-6 py-5 flex flex-col gap-3"
          style={{ 'min-width': '300px' }}
        >
          <div class="text-[14px] font-semibold text-(--text)">
            正在加载笔记库…
          </div>
          <div class="text-[12px] text-(--text-3)">
            {p().phase === 'parsing' ? '解析文件中…' : '检测文件中…'}
          </div>
          <div class="relative h-1.5 w-full overflow-hidden rounded-full bg-(--bg-active)">
            <div class="loading-overlay-bar absolute inset-y-0 w-1/3 rounded-full bg-(--accent)" />
          </div>
          <div class="flex flex-col gap-1 text-[12px] text-(--text-2)">
            <span>检测到 {p().detected} 个文件</span>
            <span>已解析 {p().parsed} 个文件</span>
          </div>
        </div>
      </div>
    </Show>
  )
}
