import { Show } from 'solid-js'
import { loadProgress } from '../loader/loadProgress'
import { maskColors } from '../lib/themeCache'

export function LoadingOverlay() {
  const p = loadProgress
  // 取缓存遮罩颜色；缺失回退到 CSS 变量。与 applyTheme 解耦，互不干扰。
  const c = (name: string) => maskColors()[name] || `var(${name})`
  return (
    <Show when={p().visible}>
      <div
        class="fixed inset-0 z-[10001] flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.6)' }}
      >
        <div
          class="rounded-lg shadow-xl px-6 py-5 flex flex-col gap-3 border"
          style={{
            'min-width': '300px',
            background: c('--bg-elevated'),
            'border-color': c('--border-2'),
          }}
        >
          <div class="text-[14px] font-semibold" style={{ color: c('--text') }}>
            正在读取本地文件夹…
          </div>
          <div
            class="relative h-1.5 w-full overflow-hidden rounded-full"
            style={{ background: c('--bg-active') }}
          >
            <div
              class="loading-overlay-bar absolute inset-y-0 left-0 w-1/3 rounded-full"
              style={{ background: c('--accent') }}
            />
          </div>
          <div class="text-[12px]" style={{ color: c('--text-2') }}>
            检测到 {p().detected} 个文件
          </div>
        </div>
      </div>
    </Show>
  )
}
