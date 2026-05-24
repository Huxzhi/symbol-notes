import { For, Show, createSignal } from 'solid-js'
import { FolderOpen } from 'lucide-solid'
import { fileSystemStore } from '../stores/fileSystemStore'
import { uiStore, activeFilePath } from '../stores/uiStore'
import { openDirectory, createFile, createDirectory } from '../services/fileSystemService'
import { openFile } from '../services/workspaceService'
import type { FileNode } from '../stores/fileSystemStore'

const IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif',
])
const MD_EXT = '.md'

function fileIcon(name: string): string {
  if (name.endsWith(MD_EXT)) return '◻'
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return IMAGE_EXTS.has(ext) ? '⊡' : '◫'
}

function displayName(name: string): string {
  return name.endsWith(MD_EXT) ? name.slice(0, -3) : name
}

function isOtherFile(name: string): boolean {
  return !name.endsWith(MD_EXT)
}

function canOpen(name: string): boolean {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return name.endsWith(MD_EXT) || IMAGE_EXTS.has(ext)
}

function FileTreeNode(props: { node: FileNode; depth: number }) {
  const isActive = () => activeFilePath() === props.node.path
  const isOther = () => props.node.kind === 'file' && isOtherFile(props.node.name)
  const show = () =>
    props.node.kind === 'directory' ||
    !isOtherFile(props.node.name) ||
    uiStore.showOtherFiles

  return (
    <Show when={show()}>
      <div>
        <div
          class={`flex items-center gap-1 py-0.5 text-[11px] cursor-pointer hover:bg-[var(--bg-hover)] select-none
            ${
              isActive()
                ? 'bg-[var(--bg-hover)] border-l-2 border-[var(--accent)] text-[var(--text)]'
                : isOther()
                  ? 'text-[var(--text-4)] border-l-2 border-transparent'
                  : 'text-[var(--text-2)] border-l-2 border-transparent'
            }`}
          style={{ 'padding-left': `${6 + props.depth * 14}px` }}
          onClick={() => {
            if (props.node.kind !== 'file') return
            if (!canOpen(props.node.name)) return
            void openFile(props.node.path)
          }}
          onDblClick={() => {
            if (props.node.kind !== 'file') return
            if (!canOpen(props.node.name)) return
            void openFile(props.node.path, { newTab: true, pin: true })
          }}
        >
          <span class="text-[9px] text-[var(--text-3)]">
            {props.node.kind === 'directory' ? '▸' : fileIcon(props.node.name)}
          </span>
          <span class={isActive() ? 'text-[var(--accent)]' : ''}>
            {displayName(props.node.name)}
          </span>
        </div>
        <Show when={props.node.kind === 'directory'}>
          <For each={props.node.children ?? []}>
            {child => <FileTreeNode node={child} depth={props.depth + 1} />}
          </For>
        </Show>
      </div>
    </Show>
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
    if (mode === 'file') {
      const path = await createFile(name)
      if (path) await openFile(path, { newTab: true, pin: true })
    } else if (mode === 'folder') {
      await createDirectory(name)
    }
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') void confirm()
    else if (e.key === 'Escape') cancel()
  }

  return (
    <div class="w-[190px] h-full bg-[var(--bg-surface)] border-r border-[var(--border)] flex flex-col">
      <div class="border-b border-[var(--border)] shrink-0 flex items-center gap-0.5 pr-1 min-w-0">
        <button
          class="flex items-center gap-1.5 flex-1 px-2.5 py-2 text-left hover:bg-[var(--bg-hover)] transition-colors min-w-0 group"
          onClick={openDirectory}
          title={fileSystemStore.rootHandle ? '切换文件夹' : '打开文件夹'}
        >
          <FolderOpen size={12} class="shrink-0 text-[var(--accent)] group-hover:text-[var(--accent-2)]" />
          <span class="truncate text-[10px] text-[var(--accent)] font-bold tracking-widest uppercase group-hover:text-[var(--accent-2)]">
            {fileSystemStore.rootHandle?.name ?? '打开文件夹'}
          </span>
        </button>
        <Show when={fileSystemStore.rootHandle}>
          <button
            class="shrink-0 text-[var(--text-3)] hover:text-[var(--accent-2)] w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] transition-colors text-[13px]"
            title="新建文件夹"
            onClick={() => startCreate('folder')}
          >⊞</button>
          <button
            class="shrink-0 text-[var(--text-3)] hover:text-[var(--accent-2)] w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] transition-colors"
            title="新建文件"
            onClick={() => startCreate('file')}
          >+</button>
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
              onBlur={() => void confirm()}
              ref={el => setTimeout(() => el?.focus(), 0)}
            />
          </div>
        </Show>
        <For each={fileSystemStore.tree}>
          {node => <FileTreeNode node={node} depth={0} />}
        </For>
      </div>
    </div>
  )
}
