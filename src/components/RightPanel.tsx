import { createSignal, createMemo, For, Show } from 'solid-js'
import { EditorView } from '@codemirror/view'
import { activeFilePath } from '../stores/uiStore'
import { knowledgeStore } from '../stores/knowledgeStore'
import { editorStore } from '../stores/editorStore'

type Tab = 'links' | 'outline' | 'tags'

export function RightPanel() {
  const [activeTab, setActiveTab] = createSignal<Tab>('links')

  const currentMeta = createMemo(() => {
    const path = activeFilePath()
    return path ? (knowledgeStore.index[path] ?? null) : null
  })

  const outLinks = createMemo(() => editorStore.outLinks)

  const backlinks = createMemo(() => {
    const path = activeFilePath()
    if (!path) return []
    const aliases = knowledgeStore.index[path]?.aliases ?? []
    const keys = [path, ...aliases, ...aliases.map(a => `${a}.md`)]
    const seen = new Set<string>()
    const result: string[] = []
    for (const key of keys) {
      for (const bl of knowledgeStore.backlinkMap[key] ?? []) {
        if (!seen.has(bl)) { seen.add(bl); result.push(bl) }
      }
    }
    return result
  })

  const tags = createMemo(() => currentMeta()?.tags ?? [])
  const outline = createMemo(() => editorStore.headings)

  const jumpToHeading = (pos: number) => {
    const view = editorStore.cmView
    if (!view) return
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 40 }),
    })
    view.focus()
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'links', label: '链接' },
    { id: 'outline', label: '大纲' },
    { id: 'tags', label: '标签' },
  ]

  return (
    <div class="w-50 h-full bg-[var(--bg-surface)] border-l border-[var(--border)] flex flex-col shrink-0">
      <div class="flex border-b border-[var(--border)] shrink-0">
        <For each={tabs}>
          {(tab) => (
            <button
              class={`flex-1 py-1.5 text-[10px] cursor-pointer transition-colors
                ${activeTab() === tab.id
                  ? 'text-[var(--accent)] border-b-2 border-[var(--accent)] -mb-px'
                  : 'text-[var(--text-3)] hover:text-[var(--text-2)]'}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          )}
        </For>
      </div>

      <div class="flex-1 overflow-y-auto p-2 text-[11px]">
        <Show when={activeTab() === 'links'}>
          <div class="text-[var(--text-3)] text-[10px] uppercase tracking-widest mb-1.5">
            出链 ({outLinks().length})
          </div>
          <For each={outLinks()}>
            {(link) => (
              <div class="py-0.5 min-w-0">
                <div
                  class={`flex items-center gap-1 ${link.type === 'wiki' ? 'text-[var(--link)]' : 'text-[var(--link-2)]'}`}
                >
                  <span class="text-[var(--accent)] text-[10px] shrink-0">↗</span>
                  <span class="truncate">{link.label}</span>
                </div>
                <Show when={link.label !== link.target}>
                  <div class="text-[var(--text-4)] text-[9px] truncate pl-4 mt-0.5">
                    {link.target}
                  </div>
                </Show>
              </div>
            )}
          </For>
          <div class="text-[var(--text-3)] text-[10px] uppercase tracking-widest mt-3 mb-1.5">
            入链 ({backlinks().length})
          </div>
          <For each={backlinks()}>
            {(link) => (
              <div class="text-[var(--link-2)] py-0.5 flex items-center gap-1">
                <span class="text-[var(--accent)] text-[10px]">↙</span> {link}
              </div>
            )}
          </For>
          <Show when={outLinks().length === 0 && backlinks().length === 0}>
            <div class="text-[var(--text-4)] italic mt-1">暂无链接</div>
          </Show>
        </Show>

        <Show when={activeTab() === 'outline'}>
          <For each={outline()}>
            {(h) => (
              <div
                class="py-0.5 text-[var(--text-2)] hover:text-[var(--accent)] cursor-pointer truncate transition-colors leading-snug"
                style={{
                  'padding-left': `${(h.level - 1) * 10 + 2}px`,
                  'font-size': h.level === 1 ? '12px' : '11px',
                  'font-weight': h.level === 1 ? '500' : '400',
                }}
                onClick={() => jumpToHeading(h.from)}
                title={h.text}
              >
                <span class="text-[var(--text-4)] mr-1" style={{ 'font-size': '9px' }}>
                  {'H' + h.level}
                </span>
                {h.text}
              </div>
            )}
          </For>
          <Show when={outline().length === 0}>
            <div class="text-[var(--text-4)] italic">暂无标题</div>
          </Show>
        </Show>

        <Show when={activeTab() === 'tags'}>
          <div class="flex flex-wrap gap-1.5 mt-1">
            <For each={tags()}>
              {(tag) => (
                <span class="bg-[var(--accent-bg)] border border-[var(--accent-bg)] text-[var(--link-2)] text-[10px] px-2 py-0.5 rounded-full">
                  #{tag}
                </span>
              )}
            </For>
          </div>
          <Show when={tags().length === 0}>
            <div class="text-[var(--text-4)] italic mt-1">暂无标签</div>
          </Show>
        </Show>
      </div>
    </div>
  )
}
