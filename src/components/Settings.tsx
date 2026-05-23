import { createSignal, For } from 'solid-js'
import { uiStore, setUIStore } from '../stores/uiStore'
import type { ThemeId } from '../stores/uiStore'

const THEMES: { id: ThemeId; label: string; sub: string; swatch: string[] }[] = [
  { id: 'dark',  label: '深空', sub: 'Dark',  swatch: ['#0f0f1c', '#6c63ff', '#7ec8e3', '#cccccc'] },
  { id: 'light', label: '晴日', sub: 'Light', swatch: ['#f8f8fc', '#5a52e8', '#2980b9', '#2a2a3c'] },
  { id: 'nord',  label: '极光', sub: 'Nord',  swatch: ['#2e3440', '#88c0d0', '#81a1c1', '#eceff4'] },
]

function persistTheme(theme: ThemeId) {
  try { localStorage.setItem('sn-theme', JSON.stringify(theme)) } catch {}
}
function persistCSS(css: string) {
  try { localStorage.setItem('sn-customCSS', JSON.stringify(css)) } catch {}
}

export function Settings() {
  const [draftTheme, setDraftTheme] = createSignal<ThemeId>(uiStore.theme)
  const [draftCSS, setDraftCSS] = createSignal(uiStore.customCSS)

  const close = () => setUIStore('showSettings', false)

  const apply = () => {
    const theme = draftTheme()
    const css = draftCSS()
    setUIStore('theme', theme)
    setUIStore('customCSS', css)
    persistTheme(theme)
    persistCSS(css)
    close()
  }

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div class="bg-elevated border b-theme rounded-lg w-[480px] max-w-[90vw] flex flex-col p-5 gap-5 shadow-2xl">

        <div class="flex items-center justify-between">
          <h2 class="text-[14px] font-semibold t-base">设置</h2>
          <button
            class="interactive w-6 h-6 flex items-center justify-center rounded text-[13px]"
            onClick={close}
          >
            ✕
          </button>
        </div>

        <div>
          <div class="text-[10px] t-3 mb-2.5 uppercase tracking-widest">主题</div>
          <div class="flex gap-2">
            <For each={THEMES}>
              {(t) => (
                <button
                  class={`flex-1 rounded-lg border-2 p-3 cursor-pointer transition-colors text-center ${
                    draftTheme() === t.id
                      ? 'border-[var(--accent)] bg-[var(--accent-bg)]'
                      : 'border-[var(--border)] hover:border-[var(--border-2)]'
                  }`}
                  onClick={() => setDraftTheme(t.id)}
                >
                  <div class="flex gap-1 mb-2 justify-center">
                    <For each={t.swatch}>
                      {(c) => <div class="w-4 h-4 rounded-full border border-white/10" style={{ background: c }} />}
                    </For>
                  </div>
                  <div class={`text-[12px] font-medium ${draftTheme() === t.id ? 'text-[var(--accent)]' : 't-base'}`}>
                    {t.label}
                  </div>
                  <div class="text-[10px] t-3">{t.sub}</div>
                </button>
              )}
            </For>
          </div>
        </div>

        <div>
          <div class="text-[10px] t-3 mb-2 uppercase tracking-widest">自定义 CSS</div>
          <textarea
            class="w-full h-36 bg-[var(--bg-base)] border border-[var(--border)] rounded p-2.5 text-[12px] t-base font-mono resize-none outline-none transition-colors focus:border-[var(--accent)]"
            placeholder="/* 在此输入自定义 CSS */"
            value={draftCSS()}
            onInput={(e) => setDraftCSS(e.currentTarget.value)}
            spellcheck={false}
          />
        </div>

        <div class="flex justify-end gap-2">
          <button
            class="interactive px-4 py-1.5 text-[12px] rounded border border-[var(--border)]"
            onClick={close}
          >
            取消
          </button>
          <button
            class="px-4 py-1.5 text-[12px] rounded bg-[var(--accent)] text-white cursor-pointer hover:bg-[var(--accent-2)] transition-colors"
            onClick={apply}
          >
            应用
          </button>
        </div>

      </div>
    </div>
  )
}
