import { Show } from 'solid-js'
import { loadProgress } from '../vault/loadProgress'

export function LoadingOverlay() {
  const p = loadProgress
  const cls = (active: boolean) => (active ? 'text-(--text)' : 'text-(--text-3)')
  const phaseText = () => {
    switch (p().phase) {
      case 'building':
        return '第三阶段 · 构建知识图谱…'
      case 'parsing':
        return '第二阶段 · 解析文件内容…'
      default:
        return '第一阶段 · 读取本地文件夹信息…'
    }
  }
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
          <div class="text-[12px] text-(--text-3)">{phaseText()}</div>
          <div class="relative h-1.5 w-full overflow-hidden rounded-full bg-(--bg-active)">
            <div class="loading-overlay-bar absolute inset-y-0 left-0 w-1/3 rounded-full bg-(--accent)" />
          </div>
          <div class="flex flex-col gap-1 text-[12px] text-(--text-2)">
            <span class={cls(p().phase === 'scanning')}>
              第一阶段：检测到 {p().detected} 个文件
            </span>
            <span class={cls(p().phase === 'parsing')}>
              第二阶段：已解析 {p().parsed}
              {p().parsedTotal > 0 ? ` / ${p().parsedTotal}` : ''} 个 Markdown
              文件
            </span>
            <span class={cls(p().phase === 'building')}>
              第三阶段：构建反向链接 / 标签 / 任务
            </span>
          </div>
        </div>
      </div>
    </Show>
  )
}
