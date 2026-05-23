import { For, Show, createSignal } from 'solid-js'
import { fileSystemStore } from '../stores/fileSystemStore'
import { openFile, createFile, createDirectory } from '../services/fileSystemService'
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

type CreateMode = 'file' | 'folder' | null

export function Sidebar() {
  const [createMode, setCreateMode] = createSignal<CreateMode>(null)
  const [newName, setNewName] = createSignal('')

  const startCreate = (mode: CreateMode) => {
    setNewName('')
    setCreateMode(mode)
  }

  const cancel = () => {
    setCreateMode(null)
    setNewName('')
  }

  const confirm = async () => {
    const name = newName().trim()
    if (!name) { cancel(); return }
    const mode = createMode()
    cancel()
    if (mode === 'file') await createFile(name)
    else if (mode === 'folder') await createDirectory(name)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') confirm()
    else if (e.key === 'Escape') cancel()
  }

  return (
    <div class="w-[190px] h-full bg-[var(--bg-surface)] border-r border-[var(--border)] flex flex-col">
      <div class="px-2.5 py-2 text-[10px] text-[var(--accent)] font-bold tracking-widest uppercase border-b border-[var(--border)] flex items-center gap-1 min-w-0">
        <span class="truncate flex-1">{fileSystemStore.rootHandle?.name ?? '未选择文件夹'}</span>
        <Show when={fileSystemStore.rootHandle}>
          <button
            class="shrink-0 text-[var(--text-3)] hover:text-[var(--accent-2)] w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] transition-colors text-[13px]"
            title="新建文件夹"
            onClick={() => startCreate('folder')}
          >
            ⊞
          </button>
          <button
            class="shrink-0 text-[var(--text-3)] hover:text-[var(--accent-2)] w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] transition-colors"
            title="新建文件"
            onClick={() => startCreate('file')}
          >
            +
          </button>
        </Show>
      </div>

      <div class="overflow-y-auto flex-1 py-1">
        <Show when={createMode() !== null}>
          <div class="flex items-center gap-1 px-2 py-1">
            <span class="text-[9px] text-[var(--text-3)]">
              {createMode() === 'folder' ? '▸' : '◻'}
            </span>
            <input
              class="flex-1 bg-[var(--bg-hover)] border border-[var(--accent)] rounded px-1.5 py-0.5 text-[11px] text-[var(--text)] outline-none min-w-0"
              placeholder={createMode() === 'folder' ? '文件夹 或 父/子/文件夹' : '文件名 或 目录/文件名'}
              value={newName()}
              onInput={e => setNewName(e.currentTarget.value)}
              onKeyDown={onKeyDown}
              onBlur={confirm}
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
