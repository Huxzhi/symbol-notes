import { createSignal, For, Match, Show, Switch } from 'solid-js'
import { settingsActions, settingsStore } from '../stores/settingsStore'
import { setRuntimeStore } from '../stores/runtimeStore'
import type { ThemeId } from '../stores/types'

type Section = 'appearance' | 'files' | 'shortcuts'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'appearance', label: '外观' },
  { id: 'files', label: '文件' },
  { id: 'shortcuts', label: '快捷键' },
]

const THEMES: { id: ThemeId; label: string; sub: string; swatch: string[] }[] =
  [
    {
      id: 'dark',
      label: '深空',
      sub: 'Dark',
      swatch: ['#0f0f1c', '#6c63ff', '#7ec8e3', '#cccccc'],
    },
    {
      id: 'light',
      label: '晴日',
      sub: 'Light',
      swatch: ['#f8f8fc', '#5a52e8', '#2980b9', '#2a2a3c'],
    },
    {
      id: 'nord',
      label: '极光',
      sub: 'Nord',
      swatch: ['#2e3440', '#88c0d0', '#81a1c1', '#eceff4'],
    },
  ]

const SHORTCUTS = [
  { keys: 'Ctrl / ⌘  S', desc: '保存文件' },
  { keys: 'Ctrl / ⌘  Z', desc: '撤销' },
  { keys: 'Ctrl / ⌘  Shift Z', desc: '重做' },
  { keys: 'Ctrl / ⌘  B', desc: '加粗' },
  { keys: 'Ctrl / ⌘  I', desc: '斜体' },
]

export function Settings() {
  const [section, setSection] = createSignal<Section>('appearance')
  const [draftTheme, setDraftTheme] = createSignal<ThemeId>(
    settingsStore.theme,
  )
  const [draftCSS, setDraftCSS] = createSignal(settingsStore.customCSS)
  const [draftAutoTs, setDraftAutoTs] = createSignal(
    settingsStore.autoTimestamps,
  )
  const [draftShowOtherFiles, setDraftShowOtherFiles] = createSignal(
    settingsStore.showOtherFiles,
  )

  const close = () => setRuntimeStore('showSettings', false)

  const apply = () => {
    settingsActions.setTheme(draftTheme())
    settingsActions.setCustomCSS(draftCSS())
    settingsActions.setAutoTimestamps(draftAutoTs())
    settingsActions.setShowOtherFiles(draftShowOtherFiles())
    close()
  }

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div class="bg-elevated border b-theme rounded-lg w-145 max-w-[92vw] max-h-[82vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div class="flex items-center justify-between px-5 py-3.5 border-b border-(--border)] shrink-0">
          <h2 class="text-[14px] font-semibold t-base">设置</h2>
          <button
            class="interactive w-6 h-6 flex items-center justify-center rounded text-[13px]"
            onClick={close}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div class="flex flex-1 overflow-hidden min-h-0">
          {/* Left nav */}
          <div class="w-28 shrink-0 border-r border-(--border) py-2">
            <For each={SECTIONS}>
              {(s) => (
                <button
                  class={`w-full text-left px-4 py-2 text-[12px] cursor-pointer transition-colors ${
                    section() === s.id
                      ? 'text-(--accent) bg-(--accent-bg) font-medium'
                      : 't-2 hover:bg-(--bg-hover)'
                  }`}
                  onClick={() => setSection(s.id)}
                >
                  {s.label}
                </button>
              )}
            </For>
          </div>

          {/* Content */}
          <div class="flex-1 overflow-y-auto p-5 min-w-0">
            <Switch>
              <Match when={section() === 'appearance'}>
                <div class="text-[10px] t-3 mb-2.5 uppercase tracking-widest">
                  主题
                </div>
                <div class="flex gap-2 mb-5">
                  <For each={THEMES}>
                    {(t) => (
                      <button
                        class={`flex-1 rounded-lg border-2 p-3 cursor-pointer transition-colors text-center ${
                          draftTheme() === t.id
                            ? 'border-(--accent) bg-(--accent-bg)'
                            : 'border-(--border)] hover:border-(--border-2)'
                        }`}
                        onClick={() => setDraftTheme(t.id)}
                      >
                        <div class="flex gap-1 mb-2 justify-center">
                          <For each={t.swatch}>
                            {(c) => (
                              <div
                                class="w-4 h-4 rounded-full border border-white/10"
                                style={{ background: c }}
                              />
                            )}
                          </For>
                        </div>
                        <div
                          class={`text-[12px] font-medium ${draftTheme() === t.id ? 'text-(--accent)' : 't-base'}`}
                        >
                          {t.label}
                        </div>
                        <div class="text-[10px] t-3">{t.sub}</div>
                      </button>
                    )}
                  </For>
                </div>

                <div class="text-[10px] t-3 mb-2 uppercase tracking-widest">
                  自定义 CSS
                </div>
                <textarea
                  class="w-full h-36 bg-(--bg-base) border border-(--border)] rounded p-2.5 text-[12px] t-base font-mono resize-none outline-none transition-colors focus:border-(--accent)"
                  placeholder="/* 在此输入自定义 CSS */"
                  value={draftCSS()}
                  onInput={(e) => setDraftCSS(e.currentTarget.value)}
                  spellcheck={false}
                />
              </Match>

              <Match when={section() === 'files'}>
                <div class="text-[10px] t-3 mb-3 uppercase tracking-widest">
                  自动时间戳
                </div>
                <label class="flex items-start gap-3 cursor-pointer select-none">
                  {/* Toggle switch */}
                  <div class="relative mt-0.5 shrink-0">
                    <input
                      type="checkbox"
                      class="sr-only"
                      checked={draftAutoTs()}
                      onChange={(e) => setDraftAutoTs(e.currentTarget.checked)}
                    />
                    <div
                      class={`w-9 h-5 rounded-full transition-colors ${draftAutoTs() ? 'bg-(--accent)' : 'bg-(--bg-active)'}`}
                    />
                    <div
                      class={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${draftAutoTs() ? 'translate-x-4' : ''}`}
                    />
                  </div>
                  <div>
                    <div class="text-[13px] t-base font-medium">
                      启用自动时间戳
                    </div>
                    <div class="text-[11px] t-3 mt-1 leading-relaxed">
                      打开文件时若缺少
                      <code class="bg-(--bg-hover) px-1 mx-0.5 rounded text-[10px]">
                        created
                      </code>
                      或
                      <code class="bg-(--bg-hover) px-1 mx-0.5 rounded text-[10px]">
                        updated
                      </code>
                      字段则自动写入；每次保存时更新
                      <code class="bg-(--bg-hover) px-1 mx-0.5 rounded text-[10px]">
                        updated
                      </code>
                      为当前时间。
                    </div>
                    <div class="text-[11px] t-3 mt-1">
                      格式：
                      <code class="bg-(--bg-hover) px-1 rounded text-[10px]">
                        YYYY-MM-DD HH:mm
                      </code>
                    </div>
                    <Show when={draftAutoTs()}>
                      <div class="text-[10px] t-3 mt-2 leading-relaxed border-l-2 border-(--border-2) pl-2">
                        注：浏览器 API 仅暴露文件的修改时间，
                        <code class="text-(--text-3)">created</code>{' '}
                        字段将以文件的最后修改时间作为初始值。
                      </div>
                    </Show>
                  </div>
                </label>

                <div class="mt-5 mb-3 text-[10px] t-3 uppercase tracking-widest">
                  文件树
                </div>
                <label class="flex items-start gap-3 cursor-pointer select-none">
                  <div class="relative mt-0.5 shrink-0">
                    <input
                      type="checkbox"
                      class="sr-only"
                      checked={draftShowOtherFiles()}
                      onChange={(e) =>
                        setDraftShowOtherFiles(e.currentTarget.checked)
                      }
                    />
                    <div
                      class={`w-9 h-5 rounded-full transition-colors ${draftShowOtherFiles() ? 'bg-(--accent)' : 'bg-(--bg-active)'}`}
                    />
                    <div
                      class={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${draftShowOtherFiles() ? 'translate-x-4' : ''}`}
                    />
                  </div>
                  <div>
                    <div class="text-[13px] t-base font-medium">
                      显示附件文件
                    </div>
                    <div class="text-[11px] t-3 mt-1 leading-relaxed">
                      在文件树中显示图片、PDF 等非 Markdown 文件。关闭后仅显示{' '}
                      <code class="bg-(--bg-hover) px-1 mx-0.5 rounded text-[10px]">
                        .md
                      </code>{' '}
                      文件。
                    </div>
                  </div>
                </label>
              </Match>

              <Match when={section() === 'shortcuts'}>
                <div class="text-[10px] t-3 mb-3 uppercase tracking-widest">
                  键盘快捷键
                </div>
                <div>
                  <For each={SHORTCUTS}>
                    {(s) => (
                      <div class="flex items-center justify-between py-2 border-b border-(--border)]">
                        <span class="text-[12px] t-base">{s.desc}</span>
                        <kbd class="text-[11px] t-2 bg-(--bg-hover) border border-(--border)] px-2 py-0.5 rounded font-mono">
                          {s.keys}
                        </kbd>
                      </div>
                    )}
                  </For>
                </div>
                <div class="text-[10px] t-3 mt-4">
                  自定义快捷键功能即将支持。
                </div>
              </Match>
            </Switch>
          </div>
        </div>

        {/* Footer */}
        <div class="flex justify-end gap-2 px-5 py-3 border-t border-(--border)] shrink-0">
          <button
            class="interactive px-4 py-1.5 text-[12px] rounded border border-(--border)]"
            onClick={close}
          >
            取消
          </button>
          <button
            class="px-4 py-1.5 text-[12px] rounded bg-(--accent) text-white cursor-pointer hover:bg-(--accent-2) transition-colors"
            onClick={apply}
          >
            应用
          </button>
        </div>
      </div>
    </div>
  )
}
