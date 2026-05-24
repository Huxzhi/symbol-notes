import { createMemo, For, Show } from 'solid-js'
import { EditorView } from '@codemirror/view'
import { globalStore } from '../../stores/globalStore'
import { runtimeStore } from '../../stores/runtimeStore'

export function OutlinePanel() {
  const activeLeafRuntime = () => {
    const { activeLeafId } = globalStore.workspace
    return activeLeafId ? runtimeStore.leafInstances[activeLeafId] : null
  }

  const outline = createMemo(() => activeLeafRuntime()?.headings ?? [])

  const jumpToHeading = (pos: number) => {
    const view = activeLeafRuntime()?.cmView
    if (!view) return
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 40 }),
    })
    view.focus()
  }

  return (
    <div class="p-2 text-[11px]">
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
    </div>
  )
}
