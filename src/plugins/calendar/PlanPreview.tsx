import { For, Show } from 'solid-js'
import { vaultStore } from '../../vault'
import { fileActions } from '../../fileManager'

const MAX_PREVIEW_ITEMS = 6

export function PlanPreview(props: {
  path: string
  /** optional caption; omit when an external column header already names the cell */
  label?: string
  /** compact: single-line label+excerpt for the month header; default = column card */
  compact?: boolean
  onEdit: () => void
}) {
  const meta = () => vaultStore.files[props.path]
  const exists = () => !!meta()
  const items = () => (meta()?.lists ?? []).map((l) => l.visual).filter((v) => v.trim().length > 0)

  return (
    <div
      class={`flex min-h-0 cursor-text${props.compact ? ' items-center gap-2 overflow-hidden' : ' flex-col h-full overflow-hidden'}`}
      onClick={() => exists() && props.onEdit()}
    >
      <Show when={props.label}>
        <div
          class={`shrink-0 text-[10px] text-(--accent) font-bold tracking-widest uppercase select-none${props.compact ? '' : ' px-3 py-1.5 border-b border-(--border)'}`}
        >
          {props.label}
        </div>
      </Show>

      <Show
        when={exists()}
        fallback={
          <button
            class={`text-[11px] text-(--text-4) italic hover:text-(--accent) transition-colors text-left${props.compact ? '' : ' px-3 py-2'}`}
            onClick={(e) => { e.stopPropagation(); void fileActions.createFile(props.path) }}
          >
            新建 {props.path.split('/').pop()}
          </button>
        }
      >
        <Show
          when={items().length > 0}
          fallback={
            <div class={`text-[11px] text-(--text-4) italic${props.compact ? ' truncate' : ' px-3 py-2'}`}>
              有内容，点击编辑
            </div>
          }
        >
          <div
            class={props.compact
              ? 'flex-1 min-w-0 truncate text-[11px] text-(--text-3)'
              : 'flex-1 min-h-0 overflow-y-auto px-3 py-2 flex flex-col gap-0.5'}
          >
            <Show
              when={!props.compact}
              fallback={<span>{items().join('  ·  ')}</span>}
            >
              <For each={items().slice(0, MAX_PREVIEW_ITEMS)}>
                {(t) => <div class="text-[11px] text-(--text-2) leading-snug truncate">· {t}</div>}
              </For>
              <Show when={items().length > MAX_PREVIEW_ITEMS}>
                <div class="text-[10px] text-(--text-4)">+{items().length - MAX_PREVIEW_ITEMS} more</div>
              </Show>
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  )
}
