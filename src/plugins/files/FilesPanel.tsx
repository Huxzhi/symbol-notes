import { FolderOpen } from 'lucide-solid'
import { createEffect, createMemo, createSignal, untrack, For, JSX, Show } from 'solid-js'
import { createVirtualizer } from '@tanstack/solid-virtual'

import { openVault, fileActions, vaultFs, vaultStore } from '../../vault'
import { workspaceActions } from '../../stores/workspaceStore'
import { fileOp, beginCreate, cancelOp } from './fileOpStore'
import { computeWikiLink, isValidMoveDrop } from '../../lib/dragDropHelpers'
import { settingsStore } from '../../stores/settingsStore'
import { showError, showToast } from '../../stores/toastStore'
import { getFileViewForPath } from '../../lib/pluginRegistry'
import type { FileMeta, ViewComponentProps } from '../../stores/types'
import { activeFilePath } from '../../stores/workspaceStore'
import { flattenTree, resolveDropTarget, isOtherFile, folderChain, type FlatRow } from './treeUtils'
import { revealTarget } from '../../stores/revealStore'

export function toggleInArray(arr: string[], val: string): string[] {
  return arr.includes(val) ? arr.filter((p) => p !== val) : [...arr, val]
}

const ROW_HEIGHT = 22

function displayName(name: string): string {
  if (name.endsWith('.excalidraw.md')) return name.slice(0, -14)
  return name.endsWith('.md') ? name.slice(0, -3) : name
}

function canOpen(path: string): boolean {
  return getFileViewForPath(path) !== undefined
}

function FileRow(props: {
  row: FlatRow
  style: JSX.CSSProperties
  expandedFolders: string[]
  highlight: string | null
  onToggle: (path: string) => void
  dragSrc: () => string | null
  dragOver: () => string | null
  onDragStart: (e: DragEvent, entry: FileMeta) => void
  onDragEnd: () => void
  onRowDragOver: (e: DragEvent, entry: FileMeta) => void
  onRowDragLeave: (e: DragEvent) => void
  onRowDrop: (e: DragEvent, entry: FileMeta) => void
}) {
  const entry = () => props.row.entry
  const isActive = () => activeFilePath() === entry().path
  const isOther = () => entry().kind === 'file' && isOtherFile(entry().name)
  const isCollapsed = () =>
    entry().kind === 'directory' && !props.expandedFolders.includes(entry().path)
  const isRenaming = () =>
    fileOp()?.type === 'rename' &&
    (fileOp() as { path: string }).path === entry().path
  const isDragTarget = () =>
    entry().kind === 'directory' && props.dragOver() === entry().path

  const [renameValue, setRenameValue] = createSignal('')

  const confirmRename = async () => {
    const val = renameValue().trim()
    if (!val) { cancelOp(); return }
    cancelOp()
    try {
      await fileActions.renameFile(entry().path, val)
    } catch (err) {
      showError(err instanceof Error ? err.message : '重命名失败')
    }
  }

  const onRenameKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') void confirmRename()
    else if (e.key === 'Escape') cancelOp()
  }

  return (
    <div
      data-ctx={entry().kind === 'directory' ? 'directory' : 'file'}
      data-path={entry().path}
      draggable={true}
      style={{
        ...props.style,
        'padding-left': `${6 + props.row.depth * 14}px`,
      }}
      class={`flex items-center gap-1 text-[11px] cursor-pointer hover:bg-(--bg-hover) select-none overflow-hidden
        ${
          isActive()
            ? 'bg-(--bg-hover) border-l-2 border-(--accent) text-(--text)'
            : isOther()
              ? 'text-(--text-4) border-l-2 border-transparent'
              : 'text-(--text-2) border-l-2 border-transparent'
        }
        ${props.dragSrc() === entry().path ? 'opacity-50' : ''}
        ${isDragTarget() ? 'outline outline-(--accent-2) -outline-offset-1 bg-(--bg-hover) border-(--accent-2)!' : ''}
        ${props.highlight === entry().path ? 'bg-(--accent-bg)! ring-1 ring-(--accent) ring-inset transition-colors' : ''}
      `}
      onClick={() => {
        if (isRenaming()) return
        if (entry().kind === 'directory') {
          props.onToggle(entry().path)
          return
        }
        if (!canOpen(entry().path)) return
        workspaceActions.openFile(entry().path)
      }}
      onDblClick={() => {
        if (isRenaming()) return
        if (entry().kind !== 'file') return
        if (!canOpen(entry().path)) return
        workspaceActions.openFile(entry().path, { newTab: true, pin: true })
      }}
      onDragStart={(e) => props.onDragStart(e, entry())}
      onDragEnd={props.onDragEnd}
      onDragOver={(e) => props.onRowDragOver(e, entry())}
      onDragLeave={props.onRowDragLeave}
      onDrop={(e) => props.onRowDrop(e, entry())}
    >
      <Show when={entry().kind === 'directory'}>
        <span class="text-[9px] text-(--text-3)">
          {isCollapsed() ? '▸' : '▾'}
        </span>
      </Show>
      <Show
        when={isRenaming()}
        fallback={
          <span class={`truncate min-w-0 ${isActive() ? 'text-(--accent)' : ''}`}>
            {displayName(entry().name)}
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
            setRenameValue(displayName(entry().name))
            setTimeout(() => {
              el?.focus()
              el?.select()
            }, 0)
          }}
          onClick={(e) => e.stopPropagation()}
        />
      </Show>
    </div>
  )
}

export function FilesPanel(props: ViewComponentProps) {
  const expandedFolders = () =>
    (props.viewState.expandedFolders as string[] | undefined) ?? []

  const handleToggle = (path: string) => {
    workspaceActions.setLeafViewState(props.leafId, {
      type: 'files',
      state: {
        ...props.viewState,
        expandedFolders: toggleInArray(expandedFolders(), path),
      },
    })
  }

  const flatRows = createMemo(() =>
    flattenTree(null, 0, expandedFolders(), vaultStore.files, settingsStore.showOtherFiles)
  )

  let scrollEl!: HTMLDivElement

  const virtualizer = createVirtualizer({
    get count() { return flatRows().length },
    getScrollElement: () => scrollEl,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })

  const [dragSrc, setDragSrc] = createSignal<string | null>(null)
  const [dragOver, setDragOver] = createSignal<string | null>(null)

  createEffect(() => {
    const op = fileOp()
    if (op?.type === 'rename') {
      const path = (op as { path: string }).path
      const idx = flatRows().findIndex(r => r.entry.path === path)
      if (idx !== -1) virtualizer.scrollToIndex(idx, { align: 'auto' })
    }
  })

  // Reveal a folder requested from elsewhere (e.g. the nav-bar breadcrumb):
  // expand the folder + ancestors, then scroll to it and briefly highlight.
  const [highlight, setHighlight] = createSignal<string | null>(null)
  const [pendingReveal, setPendingReveal] = createSignal<string | null>(null)

  createEffect(() => {
    const t = revealTarget()
    if (!t) return
    // Only re-run when a new reveal is requested — not when the user toggles folders.
    untrack(() => {
      const chain = folderChain(t.path)
      const cur = expandedFolders()
      const next = [...new Set([...cur, ...chain])]
      if (next.length !== cur.length) {
        workspaceActions.setLeafViewState(props.leafId, {
          type: 'files',
          state: { ...props.viewState, expandedFolders: next },
        })
      }
      setPendingReveal(t.path)
      setHighlight(t.path)
    })
    setTimeout(() => setHighlight((h) => (h === t.path ? null : h)), 1000)
  })

  // Scroll once the (possibly newly-expanded) target row exists in the tree.
  createEffect(() => {
    const path = pendingReveal()
    if (!path) return
    const idx = flatRows().findIndex((r) => r.entry.path === path)
    if (idx !== -1) {
      virtualizer.scrollToIndex(idx, { align: 'center' })
      setPendingReveal(null)
    }
  })

  const handleDragStart = (e: DragEvent, entry: FileMeta) => {
    setDragSrc(entry.path)
    e.dataTransfer!.setData('application/x-symbol-notes-file', entry.path)
    e.dataTransfer!.setData('text/plain', computeWikiLink(entry.name, entry.kind))
    e.dataTransfer!.effectAllowed = 'copyMove'

    const ghost = document.createElement('div')
    ghost.textContent = displayName(entry.name)
    Object.assign(ghost.style, {
      position: 'fixed', top: '-100px', left: '-100px',
      padding: '2px 8px', borderRadius: '4px', fontSize: '11px',
      background: 'var(--bg-hover)', color: 'var(--text)',
      border: '1px solid var(--accent)', whiteSpace: 'nowrap', pointerEvents: 'none',
    })
    document.body.appendChild(ghost)
    e.dataTransfer!.setDragImage(ghost, ghost.offsetWidth / 2, 12)
    setTimeout(() => ghost.remove(), 0)
  }

  const handleDragEnd = () => {
    setDragSrc(null)
    setDragOver(null)
  }

  let dragLeaveTimer: ReturnType<typeof setTimeout> | null = null

  const handleRowDragOver = (e: DragEvent, entry: FileMeta) => {
    e.stopPropagation()
    const src = dragSrc()
    if (!src) return
    const target = resolveDropTarget(entry)
    const srcEntry = vaultStore.files[src]
    if (!isValidMoveDrop(src, target, srcEntry?.parent ?? null)) return
    e.preventDefault()
    e.dataTransfer!.dropEffect = 'move'
    if (dragLeaveTimer) { clearTimeout(dragLeaveTimer); dragLeaveTimer = null }
    setDragOver(target)
  }

  const handleRowDragLeave = (_e: DragEvent) => {
    dragLeaveTimer = setTimeout(() => setDragOver(null), 0)
  }

  const handleRowDrop = async (e: DragEvent, entry: FileMeta) => {
    e.preventDefault()
    e.stopPropagation()
    const src = dragSrc()
    const target = resolveDropTarget(entry)
    setDragSrc(null)
    setDragOver(null)
    if (dragLeaveTimer) { clearTimeout(dragLeaveTimer); dragLeaveTimer = null }
    if (!src) return
    const srcEntry = vaultStore.files[src]
    if (!isValidMoveDrop(src, target, srcEntry?.parent ?? null)) return
    const srcName = displayName(srcEntry?.name ?? src.split('/').pop()!)
    const destName = target ? (target.split('/').pop() ?? target) : '根目录'
    try {
      await fileActions.moveEntry(src, target)
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
    if (dragLeaveTimer) { clearTimeout(dragLeaveTimer); dragLeaveTimer = null }
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

  const isCreating = () =>
    fileOp()?.type === 'create-file' || fileOp()?.type === 'create-folder'

  const [createValue, setCreateValue] = createSignal('')

  const confirmCreate = async () => {
    const val = createValue().trim()
    if (!val) { cancelOp(); return }
    const op = fileOp()
    if (!op || (op.type !== 'create-file' && op.type !== 'create-folder')) return
    cancelOp()
    if (op.type === 'create-file') {
      const path = await fileActions.createFile(val)
      if (path) workspaceActions.openFile(path, { newTab: true, pin: true })
    } else {
      await fileActions.createFolder(val)
    }
  }

  const onCreateKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') void confirmCreate()
    else if (e.key === 'Escape') cancelOp()
  }

  return (
    <div class="flex flex-col h-full relative">
      <div class="border-b border-(--border) shrink-0 flex items-center gap-0.5 pr-1 min-w-0">
        <button
          class="flex items-center gap-1.5 flex-1 px-2.5 py-2 text-left hover:bg-(--bg-hover) transition-colors min-w-0 group"
          onClick={() => void openVault()}
          title={vaultFs() ? '切换文件夹' : '打开文件夹'}
        >
          <FolderOpen size={12} class="shrink-0 text-(--accent) group-hover:text-(--accent-2)" />
          <span class="truncate text-[10px] text-(--accent) font-bold tracking-widest uppercase group-hover:text-(--accent-2)">
            {vaultFs()?.name ?? '打开文件夹'}
          </span>
        </button>
        <Show when={vaultFs()}>
          <button
            class="shrink-0 text-(--text-3) hover:text-(--accent-2) w-5 h-5 flex items-center justify-center rounded hover:bg-(--bg-hover) transition-colors text-[13px]"
            title="新建文件夹"
            onClick={() => { setCreateValue(''); beginCreate('folder') }}
          >⊞</button>
          <button
            class="shrink-0 text-(--text-3) hover:text-(--accent-2) w-5 h-5 flex items-center justify-center rounded hover:bg-(--bg-hover) transition-colors"
            title="新建文件"
            onClick={() => { setCreateValue(''); beginCreate('file') }}
          >+</button>
        </Show>
      </div>

      <div
        ref={scrollEl}
        class={`overflow-y-auto flex-1 ${dragOver() === '__root__' ? 'outline outline-1 outline-(--accent-2) outline-offset-[-2px]' : ''}`}
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
                const prefix = (fileOp() as { prefix?: string } | null)?.prefix ?? ''
                setCreateValue(prefix)
                setTimeout(() => el?.focus(), 0)
              }}
            />
          </div>
        </Show>

        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: 'relative',
            'margin-top': '4px',
          }}
        >
          <For each={virtualizer.getVirtualItems().filter(v => v.index < flatRows().length)}>
            {(vItem) => (
              <FileRow
                row={flatRows()[vItem.index]}
                style={{
                  position: 'absolute',
                  top: `${vItem.start}px`,
                  height: `${ROW_HEIGHT}px`,
                  width: '100%',
                }}
                expandedFolders={expandedFolders()}
                highlight={highlight()}
                onToggle={handleToggle}
                dragSrc={dragSrc}
                dragOver={dragOver}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onRowDragOver={handleRowDragOver}
                onRowDragLeave={handleRowDragLeave}
                onRowDrop={handleRowDrop}
              />
            )}
          </For>
        </div>
      </div>
    </div>
  )
}
