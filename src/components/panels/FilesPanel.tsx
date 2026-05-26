import { FolderOpen } from 'lucide-solid'
import { createSignal, For, Show } from 'solid-js'
import { appActions } from '../../actions/appActions'
import { fileOpActions } from '../../actions/fileOpActions'
import { workspaceActions } from '../../actions/workspaceActions'
import { toggleInArray } from '../../lib/arrayUtils'
import { activeFilePath, globalStore } from '../../stores/globalStore'
import { runtimeStore } from '../../stores/runtimeStore'
import type { FileMapEntry, ViewComponentProps } from '../../stores/types'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif'])
const MD_EXT = '.md'

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

function childrenOf(parentPath: string | null): FileMapEntry[] {
  return Object.values(globalStore.fs.fileMap)
    .filter((e) => e.parent === parentPath)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

function FileTreeNode(props: {
  entry: FileMapEntry
  depth: number
  collapsedFolders: string[]
  onToggle: (path: string) => void
}) {
  const isActive = () => activeFilePath() === props.entry.path
  const isOther = () => props.entry.kind === 'file' && isOtherFile(props.entry.name)
  const show = () =>
    props.entry.kind === 'directory' ||
    !isOtherFile(props.entry.name) ||
    globalStore.workspace.showOtherFiles
  const isCollapsed = () =>
    props.entry.kind === 'directory' && props.collapsedFolders.includes(props.entry.path)
  const isRenaming = () =>
    runtimeStore.fileOp?.type === 'rename' &&
    (runtimeStore.fileOp as { path: string }).path === props.entry.path

  const [renameValue, setRenameValue] = createSignal('')

  const confirmRename = async () => {
    const val = renameValue().trim()
    if (!val) { fileOpActions.cancel(); return }
    await fileOpActions.confirmRename(props.entry.path, val)
  }

  const onRenameKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') void confirmRename()
    else if (e.key === 'Escape') fileOpActions.cancel()
  }

  return (
    <Show when={show()}>
      <div>
        <div
          data-ctx={props.entry.kind === 'directory' ? 'directory' : 'file'}
          data-path={props.entry.path}
          class={`flex items-center gap-1 py-0.5 text-[11px] cursor-pointer hover:bg-(--bg-hover) select-none
            ${isActive()
              ? 'bg-(--bg-hover) border-l-2 border-(--accent) text-(--text)'
              : isOther()
                ? 'text-(--text-4) border-l-2 border-transparent'
                : 'text-(--text-2) border-l-2 border-transparent'
            }`}
          style={{ 'padding-left': `${6 + props.depth * 14}px` }}
          onClick={() => {
            if (isRenaming()) return
            if (props.entry.kind === 'directory') { props.onToggle(props.entry.path); return }
            if (!canOpen(props.entry.name)) return
            workspaceActions.openFile(props.entry.path)
          }}
          onDblClick={() => {
            if (isRenaming()) return
            if (props.entry.kind !== 'file') return
            if (!canOpen(props.entry.name)) return
            workspaceActions.openFile(props.entry.path, { newTab: true, pin: true })
          }}
        >
          <Show when={props.entry.kind === 'directory'}>
            <span class="text-[9px] text-(--text-3)">{isCollapsed() ? '▸' : '▾'}</span>
          </Show>
          <Show
            when={isRenaming()}
            fallback={<span class={isActive() ? 'text-(--accent)' : ''}>{displayName(props.entry.name)}</span>}
          >
            <input
              class="flex-1 bg-(--bg-hover) border border-(--accent) rounded px-1 py-0 text-[11px] text-(--text) outline-none min-w-0"
              value={renameValue()}
              onInput={(e) => setRenameValue(e.currentTarget.value)}
              onKeyDown={onRenameKeyDown}
              onBlur={() => void confirmRename()}
              ref={(el) => {
                setRenameValue(displayName(props.entry.name))
                setTimeout(() => { el?.focus(); el?.select() }, 0)
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </Show>
        </div>
        <Show when={props.entry.kind === 'directory' && !isCollapsed()}>
          <For each={childrenOf(props.entry.path)}>
            {(child) => (
              <FileTreeNode
                entry={child}
                depth={props.depth + 1}
                collapsedFolders={props.collapsedFolders}
                onToggle={props.onToggle}
              />
            )}
          </For>
        </Show>
      </div>
    </Show>
  )
}

export function FilesPanel(props: ViewComponentProps) {
  const collapsedFolders = () =>
    (props.viewState.collapsedFolders as string[] | undefined) ?? []

  const handleToggle = (path: string) => {
    workspaceActions.setLeafViewState(props.leafId, {
      type: 'files',
      state: { ...props.viewState, collapsedFolders: toggleInArray(collapsedFolders(), path) },
    })
  }

  const fileOp = () => runtimeStore.fileOp
  const isCreating = () => fileOp()?.type === 'create-file' || fileOp()?.type === 'create-folder'

  const [createValue, setCreateValue] = createSignal('')

  const confirmCreate = async () => {
    const val = createValue().trim()
    if (!val) { fileOpActions.cancel(); return }
    await fileOpActions.confirmCreate(val)
  }

  const onCreateKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') void confirmCreate()
    else if (e.key === 'Escape') fileOpActions.cancel()
  }

  return (
    <div class="flex flex-col h-full">
      <div class="border-b border-(--border) shrink-0 flex items-center gap-0.5 pr-1 min-w-0">
        <button
          class="flex items-center gap-1.5 flex-1 px-2.5 py-2 text-left hover:bg-(--bg-hover) transition-colors min-w-0 group"
          onClick={() => void appActions.openVault()}
          title={runtimeStore.rootHandle ? '切换文件夹' : '打开文件夹'}
        >
          <FolderOpen size={12} class="shrink-0 text-(--accent) group-hover:text-(--accent-2)" />
          <span class="truncate text-[10px] text-(--accent) font-bold tracking-widest uppercase group-hover:text-(--accent-2)">
            {runtimeStore.rootHandle?.name ?? '打开文件夹'}
          </span>
        </button>
        <Show when={runtimeStore.rootHandle}>
          <button
            class="shrink-0 text-(--text-3) hover:text-(--accent-2) w-5 h-5 flex items-center justify-center rounded hover:bg-(--bg-hover) transition-colors text-[13px]"
            title="新建文件夹"
            onClick={() => { setCreateValue(''); fileOpActions.startCreate('folder') }}
          >⊞</button>
          <button
            class="shrink-0 text-(--text-3) hover:text-(--accent-2) w-5 h-5 flex items-center justify-center rounded hover:bg-(--bg-hover) transition-colors"
            title="新建文件"
            onClick={() => { setCreateValue(''); fileOpActions.startCreate('file') }}
          >+</button>
        </Show>
      </div>

      <div class="overflow-y-auto flex-1 py-1">
        <Show when={isCreating()}>
          <div class="flex items-center gap-1 px-2 py-1">
            <span class="text-[9px] text-(--text-3)">
              {fileOp()?.type === 'create-folder' ? '▸' : ''}
            </span>
            <input
              class="flex-1 bg-(--bg-hover) border border-(--accent) rounded px-1.5 py-0.5 text-[11px] text-(--text) outline-none min-w-0"
              placeholder={fileOp()?.type === 'create-folder' ? '文件夹 或 父/子/文件夹' : '文件名 或 目录/文件名'}
              value={createValue()}
              onInput={(e) => setCreateValue(e.currentTarget.value)}
              onKeyDown={onCreateKeyDown}
              onBlur={() => void confirmCreate()}
              ref={(el) => {
                const prefix = (fileOp() as { prefix?: string } | null)?.prefix ?? ''
                setCreateValue(prefix)
                setTimeout(() => el?.focus(), 0)
              }}
            />
          </div>
        </Show>
        <For each={childrenOf(null)}>
          {(entry) => (
            <FileTreeNode
              entry={entry}
              depth={0}
              collapsedFolders={collapsedFolders()}
              onToggle={handleToggle}
            />
          )}
        </For>
      </div>
    </div>
  )
}
