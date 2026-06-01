import { FolderOpen } from 'lucide-solid'
import { createSignal, For, Show } from 'solid-js'

import { appActions, fileActions } from '../../stores/runtimeStore'
import { workspaceActions } from '../../stores/workspaceStore'

import { computeWikiLink, isValidMoveDrop } from '../../lib/dragDropHelpers'
import { vaultStore } from '../../stores/vaultStore'
import { runtimeStore } from '../../stores/runtimeStore'
import { settingsStore } from '../../stores/settingsStore'
import { showError, showToast } from '../../stores/toastStore'
import { getFileViewForPath } from '../../lib/pluginRegistry'
import type { FileMeta, ViewComponentProps } from '../../stores/types'
import { activeFilePath } from '../../stores/workspaceStore'

export function toggleInArray(arr: string[], val: string): string[] {
  return arr.includes(val) ? arr.filter((p) => p !== val) : [...arr, val]
}

const MD_EXT = '.md'

function displayName(name: string): string {
  if (name.endsWith('.excalidraw.md')) return name.slice(0, -14)
  return name.endsWith('.md') ? name.slice(0, -3) : name
}

function isOtherFile(name: string): boolean {
  return !name.endsWith(MD_EXT)
}

function canOpen(path: string): boolean {
  return getFileViewForPath(path) !== undefined
}

function childrenOf(parentPath: string | null): FileMeta[] {
  return Object.values(vaultStore.files)
    .filter((e) => e.parent === parentPath)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

function FileTreeNode(props: {
  entry: FileMeta
  depth: number
  collapsedFolders: string[]
  onToggle: (path: string) => void
  dragSrc: () => string | null
  dragOver: () => string | null
  onDragStart: (e: DragEvent, entry: FileMeta) => void
  onDragEnd: () => void
  onDirDragOver: (e: DragEvent, path: string) => void
  onDirDragLeave: (e: DragEvent, path: string) => void
  onDirDrop: (e: DragEvent, destDirPath: string) => void
}) {
  const isActive = () => activeFilePath() === props.entry.path
  const isOther = () =>
    props.entry.kind === 'file' && isOtherFile(props.entry.name)
  const show = () =>
    props.entry.kind === 'directory' ||
    !isOtherFile(props.entry.name) ||
    settingsStore.showOtherFiles
  const isCollapsed = () =>
    props.entry.kind === 'directory' &&
    props.collapsedFolders.includes(props.entry.path)
  const isRenaming = () =>
    runtimeStore.fileOp?.type === 'rename' &&
    (runtimeStore.fileOp as { path: string }).path === props.entry.path

  const [renameValue, setRenameValue] = createSignal('')

  const confirmRename = async () => {
    const val = renameValue().trim()
    if (!val) {
      fileActions.cancelOp()
      return
    }
    try {
      await fileActions.commitRename(props.entry.path, val)
    } catch (err) {
      showError(err instanceof Error ? err.message : '重命名失败')
    }
  }

  const onRenameKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') void confirmRename()
    else if (e.key === 'Escape') fileActions.cancelOp()
  }

  const isDragTarget = () =>
    props.entry.kind === 'directory' && props.dragOver() === props.entry.path

  return (
    <Show when={show()}>
      <div
        class={
          isDragTarget()
            ? 'outline outline-(--accent-2) -outline-offset-1 bg-(--bg-hover)'
            : ''
        }
        onDragOver={
          props.entry.kind === 'directory'
            ? (e) => props.onDirDragOver(e, props.entry.path)
            : undefined
        }
        onDragLeave={
          props.entry.kind === 'directory'
            ? (e) => props.onDirDragLeave(e, props.entry.path)
            : undefined
        }
        onDrop={
          props.entry.kind === 'directory'
            ? (e) => props.onDirDrop(e, props.entry.path)
            : undefined
        }
      >
        <div
          data-ctx={props.entry.kind === 'directory' ? 'directory' : 'file'}
          data-path={props.entry.path}
          draggable={true}
          class={`flex items-center gap-1 py-0.5 text-[11px] cursor-pointer hover:bg-(--bg-hover) select-none
            ${
              isActive()
                ? 'bg-(--bg-hover) border-l-2 border-(--accent) text-(--text)'
                : isOther()
                  ? 'text-(--text-4) border-l-2 border-transparent'
                  : 'text-(--text-2) border-l-2 border-transparent'
            }
            ${props.dragSrc() === props.entry.path ? 'opacity-50' : ''}
            ${isDragTarget() ? 'border-(--accent-2)!' : ''}
          `}
          style={{ 'padding-left': `${6 + props.depth * 14}px` }}
          onClick={() => {
            if (isRenaming()) return
            if (props.entry.kind === 'directory') {
              props.onToggle(props.entry.path)
              return
            }
            if (!canOpen(props.entry.path)) return
            workspaceActions.openFile(props.entry.path)
          }}
          onDblClick={() => {
            if (isRenaming()) return
            if (props.entry.kind !== 'file') return
            if (!canOpen(props.entry.path)) return
            workspaceActions.openFile(props.entry.path, {
              newTab: true,
              pin: true,
            })
          }}
          onDragStart={(e) => props.onDragStart(e, props.entry)}
          onDragEnd={props.onDragEnd}
        >
          <Show when={props.entry.kind === 'directory'}>
            <span class="text-[9px] text-(--text-3)">
              {isCollapsed() ? '▸' : '▾'}
            </span>
          </Show>
          <Show
            when={isRenaming()}
            fallback={
              <span class={isActive() ? 'text-(--accent)' : ''}>
                {displayName(props.entry.name)}
              </span>
            }
          >
            <input
              class="flex-1 bg-(--bg-hover) border border-(--accent) rounded px-1 py-0 text-[11px] text-(--text) outline-none min-w-0"
              value={renameValue()}
              onInput={(e) => setRenameValue(e.currentTarget.value)}
              onKeyDown={onRenameKeyDown}
              onBlur={() => void confirmRename()}
              ref={(el) => {
                setRenameValue(displayName(props.entry.name))
                setTimeout(() => {
                  el?.focus()
                  el?.select()
                }, 0)
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
                dragSrc={props.dragSrc}
                dragOver={props.dragOver}
                onDragStart={props.onDragStart}
                onDragEnd={props.onDragEnd}
                onDirDragOver={props.onDirDragOver}
                onDirDragLeave={props.onDirDragLeave}
                onDirDrop={props.onDirDrop}
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
      state: {
        ...props.viewState,
        collapsedFolders: toggleInArray(collapsedFolders(), path),
      },
    })
  }

  const [dragSrc, setDragSrc] = createSignal<string | null>(null)
  const [dragOver, setDragOver] = createSignal<string | null>(null)

  const handleDragStart = (e: DragEvent, entry: FileMeta) => {
    setDragSrc(entry.path)
    e.dataTransfer!.setData('application/x-symbol-notes-file', entry.path)
    e.dataTransfer!.setData(
      'text/plain',
      computeWikiLink(entry.name, entry.kind),
    )
    e.dataTransfer!.effectAllowed = 'copyMove'

    const ghost = document.createElement('div')
    ghost.textContent = displayName(entry.name)
    Object.assign(ghost.style, {
      position: 'fixed',
      top: '-100px',
      left: '-100px',
      padding: '2px 8px',
      borderRadius: '4px',
      fontSize: '11px',
      background: 'var(--bg-hover)',
      color: 'var(--text)',
      border: '1px solid var(--accent)',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
    })
    document.body.appendChild(ghost)
    e.dataTransfer!.setDragImage(ghost, ghost.offsetWidth / 2, 12)
    setTimeout(() => ghost.remove(), 0)
  }

  const handleDragEnd = () => {
    setDragSrc(null)
    setDragOver(null)
  }

  const handleDirDragOver = (e: DragEvent, path: string) => {
    e.stopPropagation()
    const src = dragSrc()
    if (!src) return
    const srcEntry = vaultStore.files[src]
    if (!isValidMoveDrop(src, path, srcEntry?.parent ?? null)) return
    e.preventDefault()
    e.dataTransfer!.dropEffect = 'move'
    setDragOver(path)
  }

  const handleDirDragLeave = (e: DragEvent, path: string) => {
    const rel = e.relatedTarget as Node | null
    if (rel && (e.currentTarget as Element).contains(rel)) return
    if (dragOver() === path) setDragOver(null)
  }

  const handleDirDrop = async (e: DragEvent, destDirPath: string) => {
    e.preventDefault()
    e.stopPropagation()
    const src = dragSrc()
    setDragSrc(null)
    setDragOver(null)
    if (!src) return
    const srcEntry = vaultStore.files[src]
    if (!isValidMoveDrop(src, destDirPath, srcEntry?.parent ?? null)) return
    const srcName = displayName(srcEntry?.name ?? src.split('/').pop()!)
    const destName = destDirPath.split('/').pop() ?? destDirPath
    try {
      await fileActions.moveEntry(src, destDirPath)
      showToast(`已移动 ${srcName} → ${destName}`)
    } catch (err) {
      showError(err instanceof Error ? err.message : '移动失败')
    }
  }

  const handleRootDragOver = (e: DragEvent) => {
    const src = dragSrc()
    if (!src) return
    const srcEntry = vaultStore.files[src]
    if (!isValidMoveDrop(src, null, srcEntry?.parent ?? null)) return
    e.preventDefault()
    e.dataTransfer!.dropEffect = 'move'
    setDragOver('__root__')
  }

  const handleRootDragLeave = (e: DragEvent) => {
    const rel = e.relatedTarget as Node | null
    if (rel && (e.currentTarget as Element).contains(rel)) return
    if (dragOver() === '__root__') setDragOver(null)
  }

  const handleRootDrop = async (e: DragEvent) => {
    e.preventDefault()
    const src = dragSrc()
    setDragSrc(null)
    setDragOver(null)
    if (!src) return
    const srcEntry = vaultStore.files[src]
    if (!isValidMoveDrop(src, null, srcEntry?.parent ?? null)) return
    const srcName = displayName(srcEntry?.name ?? src.split('/').pop()!)
    try {
      await fileActions.moveEntry(src, null)
      showToast(`已移动 ${srcName} → 根目录`)
    } catch (err) {
      showError(err instanceof Error ? err.message : '移动失败')
    }
  }

  const fileOp = () => runtimeStore.fileOp
  const isCreating = () =>
    fileOp()?.type === 'create-file' || fileOp()?.type === 'create-folder'

  const [createValue, setCreateValue] = createSignal('')

  const confirmCreate = async () => {
    const val = createValue().trim()
    if (!val) {
      fileActions.cancelOp()
      return
    }
    await fileActions.commitCreate(val)
  }

  const onCreateKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') void confirmCreate()
    else if (e.key === 'Escape') fileActions.cancelOp()
  }

  return (
    <div class="flex flex-col h-full relative">
      <div class="border-b border-(--border) shrink-0 flex items-center gap-0.5 pr-1 min-w-0">
        <button
          class="flex items-center gap-1.5 flex-1 px-2.5 py-2 text-left hover:bg-(--bg-hover) transition-colors min-w-0 group"
          onClick={() => void appActions.openVault()}
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
            onClick={() => {
              setCreateValue('')
              fileActions.beginCreate('folder')
            }}
          >
            ⊞
          </button>
          <button
            class="shrink-0 text-(--text-3) hover:text-(--accent-2) w-5 h-5 flex items-center justify-center rounded hover:bg-(--bg-hover) transition-colors"
            title="新建文件"
            onClick={() => {
              setCreateValue('')
              fileActions.beginCreate('file')
            }}
          >
            +
          </button>
        </Show>
      </div>

      <div
        class={`overflow-y-auto flex-1 py-1 ${dragOver() === '__root__' ? 'outline outline-1 outline-(--accent-2) outline-offset-[-2px]' : ''}`}
        onDragOver={handleRootDragOver}
        onDragLeave={handleRootDragLeave}
        onDrop={handleRootDrop}
      >
        <Show when={isCreating()}>
          <div class="flex items-center gap-1 px-2 py-1">
            <span class="text-[9px] text-(--text-3)">
              {fileOp()?.type === 'create-folder' ? '▸' : ''}
            </span>
            <input
              class="flex-1 bg-(--bg-hover) border border-(--accent) rounded px-1.5 py-0.5 text-[11px] text-(--text) outline-none min-w-0"
              placeholder={
                fileOp()?.type === 'create-folder'
                  ? '文件夹 或 父/子/文件夹'
                  : '文件名 或 目录/文件名'
              }
              value={createValue()}
              onInput={(e) => setCreateValue(e.currentTarget.value)}
              onKeyDown={onCreateKeyDown}
              onBlur={() => void confirmCreate()}
              ref={(el) => {
                const prefix =
                  (fileOp() as { prefix?: string } | null)?.prefix ?? ''
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
              dragSrc={dragSrc}
              dragOver={dragOver}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDirDragOver={handleDirDragOver}
              onDirDragLeave={handleDirDragLeave}
              onDirDrop={handleDirDrop}
            />
          )}
        </For>
      </div>
    </div>
  )
}
