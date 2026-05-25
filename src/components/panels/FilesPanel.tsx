import { FolderOpen } from 'lucide-solid'
import { createSignal, For, Show } from 'solid-js'
import { fsActions } from '../../actions/fsActions'
import { workspaceActions } from '../../actions/workspaceActions'
import { getFileViewForExt } from '../../lib/viewRegistry'
import {
  activeFilePath,
  activeLayout,
  activeRoot,
  findLeafInTree,
  globalStore,
  ROOT_TABS_ID,
} from '../../stores/globalStore'
import { runtimeStore } from '../../stores/runtimeStore'
import type {
  FileNode,
  ViewState,
  WorkspaceLeaf,
  WorkspaceNode,
} from '../../stores/types'

const IMAGE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.bmp',
  '.avif',
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

function findLeafWithFile(
  root: WorkspaceNode,
  path: string,
): WorkspaceLeaf | null {
  if (root.type === 'leaf' && root.viewState.state.file === path) return root
  if (root.type === 'tabs')
    return root.children.find((l) => l.viewState.state.file === path) ?? null
  if (root.type === 'split') {
    for (const child of root.children) {
      const found = findLeafWithFile(child, path)
      if (found) return found
    }
  }
  return null
}

function openFileInWorkspace(
  path: string,
  options?: { newTab?: boolean; pin?: boolean },
): void {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  const def = getFileViewForExt(ext)
  if (!def) return
  const viewState: ViewState = { type: def.type, state: { file: path } }

  const existing = findLeafWithFile(activeRoot().main, path)
  if (existing) {
    workspaceActions.activateLeaf(existing.id)
    return
  }

  if (!options?.newTab) {
    const { activeLeafId } = activeLayout()
    const activeLeaf = activeLeafId
      ? findLeafInTree(activeRoot().main, activeLeafId)
      : null
    if (activeLeaf && !activeLeaf.pinned) {
      workspaceActions.setLeafViewState(activeLeafId!, viewState)
      return
    }
  }

  const leafId = workspaceActions.createLeaf(ROOT_TABS_ID, viewState)
  if (options?.pin) {
    workspaceActions.setLeafPinned(leafId, true)
  }
}

function FileTreeNode(props: { node: FileNode; depth: number }) {
  const isActive = () => activeFilePath() === props.node.path
  const isOther = () =>
    props.node.kind === 'file' && isOtherFile(props.node.name)
  const show = () =>
    props.node.kind === 'directory' ||
    !isOtherFile(props.node.name) ||
    globalStore.workspace.showOtherFiles

  return (
    <Show when={show()}>
      <div>
        <div
          class={`flex items-center gap-1 py-0.5 text-[11px] cursor-pointer hover:bg-(--bg-hover) select-none
            ${
              isActive()
                ? 'bg-(--bg-hover) border-l-2 border-(--accent) text-(--text)'
                : isOther()
                  ? 'text-(--text-4) border-l-2 border-transparent'
                  : 'text-(--text-2) border-l-2 border-transparent'
            }`}
          style={{ 'padding-left': `${6 + props.depth * 14}px` }}
          onClick={() => {
            if (props.node.kind !== 'file') return
            if (!canOpen(props.node.name)) return
            openFileInWorkspace(props.node.path)
          }}
          onDblClick={() => {
            if (props.node.kind !== 'file') return
            if (!canOpen(props.node.name)) return
            openFileInWorkspace(props.node.path, { newTab: true, pin: true })
          }}
        >
          <span class="text-[9px] text-(--text-3)">
            {props.node.kind === 'directory' ? '▸' : fileIcon(props.node.name)}
          </span>
          <span class={isActive() ? 'text-(--accent)' : ''}>
            {displayName(props.node.name)}
          </span>
        </div>
        <Show when={props.node.kind === 'directory'}>
          <For each={props.node.children ?? []}>
            {(child) => (
              <FileTreeNode
                node={child}
                depth={props.depth + 1}
              />
            )}
          </For>
        </Show>
      </div>
    </Show>
  )
}

type CreateMode = 'file' | 'folder' | null

export function FilesPanel() {
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
    if (!name) {
      cancel()
      return
    }
    const mode = createMode()
    cancel()
    if (mode === 'file') {
      const path = await fsActions.createFile(name)
      if (path) openFileInWorkspace(path, { newTab: true, pin: true })
    } else if (mode === 'folder') {
      await fsActions.createDirectory(name)
    }
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') void confirm()
    else if (e.key === 'Escape') cancel()
  }

  return (
    <div class="flex flex-col h-full">
      <div class="border-b border-(--border) shrink-0 flex items-center gap-0.5 pr-1 min-w-0">
        <button
          class="flex items-center gap-1.5 flex-1 px-2.5 py-2 text-left hover:bg-(--bg-hover) transition-colors min-w-0 group"
          onClick={fsActions.openDirectory}
          title={runtimeStore.rootHandle ? '切换文件夹' : '打开文件夹'}
        >
          <FolderOpen
            size={12}
            class="shrink-0 text-(--accent) group-hover:text-(--accent-2)"
          />
          <span class="truncate text-[10px] text-(--accent) font-bold tracking-widest uppercase group-hover:text-(--accent-2)">
            {runtimeStore.rootHandle?.name ?? '打开文件夹'}
          </span>
        </button>
        <Show when={runtimeStore.rootHandle}>
          <button
            class="shrink-0 text-(--text-3) hover:text-(--accent-2) w-5 h-5 flex items-center justify-center rounded hover:bg-(--bg-hover) transition-colors text-[13px]"
            title="新建文件夹"
            onClick={() => startCreate('folder')}
          >
            ⊞
          </button>
          <button
            class="shrink-0 text-(--text-3) hover:text-(--accent-2) w-5 h-5 flex items-center justify-center rounded hover:bg-(--bg-hover) transition-colors"
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
            <span class="text-[9px] text-(--text-3)">
              {createMode() === 'folder' ? '▸' : '◻'}
            </span>
            <input
              class="flex-1 bg-(--bg-hover) border border-(--accent) rounded px-1.5 py-0.5 text-[11px] text-(--text) outline-none min-w-0"
              placeholder={
                createMode() === 'folder'
                  ? '文件夹 或 父/子/文件夹'
                  : '文件名 或 目录/文件名'
              }
              value={newName()}
              onInput={(e) => setNewName(e.currentTarget.value)}
              onKeyDown={onKeyDown}
              onBlur={() => void confirm()}
              ref={(el) => setTimeout(() => el?.focus(), 0)}
            />
          </div>
        </Show>
        <For each={globalStore.fs.tree}>
          {(node) => (
            <FileTreeNode
              node={node}
              depth={0}
            />
          )}
        </For>
      </div>
    </div>
  )
}
