import { For, Show, createSignal } from 'solid-js'
import { fileSystemStore } from '../stores/fileSystemStore'
import { openFile, createFile } from '../services/fileSystemService'
import type { FileNode } from '../stores/fileSystemStore'

function FileTreeNode(props: { node: FileNode; depth: number }) {
  const isActive = () => fileSystemStore.activeFilePath === props.node.path

  return (
    <div>
      <div
        class={`flex items-center gap-1 py-0.5 text-[11px] cursor-pointer hover:bg-[var(--bg-hover)] select-none
          ${isActive()
            ? 'bg-[var(--bg-hover)] border-l-2 border-[var(--accent)] text-[var(--text)]'
            : 'text-[var(--text-2)] border-l-2 border-transparent'}`}
        style={{ 'padding-left': `${6 + props.depth * 14}px` }}
        onClick={() => { if (props.node.kind === 'file') openFile(props.node.path) }}
      >
        <span class="text-[9px] text-[var(--text-3)]">
          {props.node.kind === 'directory' ? '▸' : '◻'}
        </span>
        <span class={isActive() ? 'text-[var(--accent)]' : ''}>{props.node.name}</span>
      </div>
      <Show when={props.node.kind === 'directory'}>
        <For each={props.node.children ?? []}>
          {(child) => <FileTreeNode node={child} depth={props.depth + 1} />}
        </For>
      </Show>
    </div>
  )
}

export function Sidebar() {
  const [creating, setCreating] = createSignal(false)
  const [newName, setNewName] = createSignal('')

  const startCreate = () => {
    setNewName('')
    setCreating(true)
  }

  const cancelCreate = () => {
    setCreating(false)
    setNewName('')
  }

  const confirmCreate = async () => {
    const name = newName().trim()
    if (!name) { cancelCreate(); return }
    cancelCreate()
    await createFile(name)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') confirmCreate()
    else if (e.key === 'Escape') cancelCreate()
  }

  return (
    <div class="w-[190px] h-full bg-[var(--bg-surface)] border-r border-[var(--border)] flex flex-col">
      <div class="px-2.5 py-2 text-[10px] text-[var(--accent)] font-bold tracking-widest uppercase border-b border-[var(--border)] flex items-center gap-1 min-w-0">
        <span class="truncate flex-1">{fileSystemStore.rootHandle?.name ?? '未选择文件夹'}</span>
        <Show when={fileSystemStore.rootHandle}>
          <button
            class="shrink-0 text-[var(--text-3)] hover:text-[var(--accent-2)] w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] transition-colors"
            title="新建文件"
            onClick={startCreate}
          >
            +
          </button>
        </Show>
      </div>

      <div class="overflow-y-auto flex-1 py-1">
        <Show when={creating()}>
          <div class="flex items-center gap-1 px-2 py-1">
            <span class="text-[9px] text-[var(--text-3)]">◻</span>
            <input
              class="flex-1 bg-[var(--bg-hover)] border border-[var(--accent)] rounded px-1.5 py-0.5 text-[11px] text-[var(--text)] outline-none min-w-0"
              placeholder="文件名.md"
              value={newName()}
              onInput={e => setNewName(e.currentTarget.value)}
              onKeyDown={onKeyDown}
              onBlur={confirmCreate}
              ref={el => setTimeout(() => el?.focus(), 0)}
            />
          </div>
        </Show>
        <For each={fileSystemStore.tree}>
          {(node) => <FileTreeNode node={node} depth={0} />}
        </For>
      </div>
    </div>
  )
}
