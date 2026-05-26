import { get, set } from 'idb-keyval'
import { createStore, produce } from 'solid-js/store'
import { cacheActions, cacheStore, setCacheStore } from './cacheStore'
import {
  clearContentCache,
  deleteFileStatEntry,
  invalidateFile,
  readFile,
  writeFile,
} from '../services/fileCacheService'
import { clearEmbedUrlCache } from '../lib/embedExtension'
import type { FileMeta, RuntimeState } from './types'

declare global {
  interface Window {
    showDirectoryPicker: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
  }
  interface FileSystemDirectoryHandle {
    requestPermission: (options?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>
  }
}

const [runtimeStore, setRuntimeStore] = createStore<RuntimeState>({
  rootHandle: null,
  leafInstances: {},
  fileOp: null,
  isIndexing: false,
  showSettings: false,
})

// ── App actions ───────────────────────────────────────────────────────────────

export const appActions = {
  async openVault(): Promise<void> {
    clearEmbedUrlCache()
    clearContentCache()
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
    await set('rootHandle', handle)
    setRuntimeStore('rootHandle', handle)
    const { workspaceActions } = await import('./workspaceStore')
    workspaceActions.clearAllLeaves()
    const { scanAndIndex } = await import('../services/indexService')
    await scanAndIndex()
  },

  async restoreVault(): Promise<void> {
    const handle = await get<FileSystemDirectoryHandle>('rootHandle')
    if (!handle) return
    try {
      const perm = await handle.requestPermission({ mode: 'readwrite' })
      if (perm !== 'granted') return
      clearContentCache()
      setRuntimeStore('rootHandle', handle)
      const { scanAndIndex } = await import('../services/indexService')
      await scanAndIndex()
    } catch { /* handle invalidated */ }
  },

  toggleSettings(): void {
    setRuntimeStore('showSettings', v => !v)
  },

  isSettingsOpen(): boolean {
    return runtimeStore.showSettings
  },
}

// ── Internal helpers for fileActions ─────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceWikiLinks(content: string, oldPath: string, newPath: string): string {
  const oldBase = oldPath.replace(/\.md$/, '')
  const newBase = newPath.replace(/\.md$/, '')
  const oldStem = oldBase.split('/').pop()!
  const newStem = newBase.split('/').pop()!
  const pairs: [string, string][] = []
  if (oldBase !== oldStem) {
    pairs.push([`${oldBase}.md`, `${newBase}.md`])
    pairs.push([oldBase, newBase])
  }
  pairs.push([`${oldStem}.md`, `${newStem}.md`])
  pairs.push([oldStem, newStem])
  let result = content
  for (const [old, next] of pairs) {
    result = result.replace(
      new RegExp(`\\[\\[${escapeRegex(old)}(\\|[^\\]]*)?\\]\\]`, 'g'),
      (_, alias) => `[[${next}${alias ?? ''}]]`,
    )
  }
  return result
}

async function updateBacklinks(
  backlinks: string[],
  oldPath: string,
  newPath: string,
): Promise<void> {
  for (const bPath of backlinks) {
    try {
      const content = await readFile(bPath)
      const updated = replaceWikiLinks(content, oldPath, newPath)
      if (updated !== content) {
        await writeFile(bPath, updated)
        cacheActions.remapFileLink(bPath, oldPath, newPath)
      }
    } catch { /* skip unreadable files */ }
  }
}

// ── File actions ──────────────────────────────────────────────────────────────

export const fileActions = {
  async createFile(name: string): Promise<string | null> {
    const { rootHandle } = runtimeStore
    if (!rootHandle) return null
    const parts = name.includes('/') ? name.split('/') : [name]
    const fileName = parts.pop()!
    const finalName = fileName.endsWith('.md') ? fileName : `${fileName}.md`
    let dir = rootHandle
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true })
    await dir.getFileHandle(finalName, { create: true })
    const path = parts.length > 0 ? `${parts.join('/')}/${finalName}` : finalName
    const parent = parts.length > 0 ? parts.join('/') : null
    const entry: FileMeta = {
      name: finalName, path, kind: 'file', parent,
      size: 0, mtime: 0, hash: '', frontmatter: {}, outLinks: [], tags: [], aliases: [],
      created: new Date(0).toISOString().slice(0, 10),
      updated: null, dated: new Date(0).toISOString().slice(0, 10), tasks: [],
    }
    setCacheStore('files', path, entry)
    return path
  },

  async createFolder(name: string): Promise<void> {
    const { rootHandle } = runtimeStore
    if (!rootHandle) return
    const parts = name.split('/')
    let dir = rootHandle
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true })
    const dirName = parts[parts.length - 1]
    const parent = parts.length > 1 ? parts.slice(0, -1).join('/') : null
    const entry: FileMeta = {
      name: dirName, path: name, kind: 'directory', parent,
      size: 0, mtime: 0, hash: '', frontmatter: {}, outLinks: [], tags: [], aliases: [],
      created: new Date(0).toISOString().slice(0, 10),
      updated: null, dated: new Date(0).toISOString().slice(0, 10), tasks: [],
    }
    setCacheStore('files', name, entry)
  },

  async renameFile(oldPath: string, newName: string): Promise<void> {
    const { rootHandle } = runtimeStore
    if (!rootHandle) return
    const dir = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : ''
    const finalName = newName.endsWith('.md') ? newName : `${newName}.md`
    const newPath = dir ? `${dir}/${finalName}` : finalName

    const oldContent = await readFile(oldPath)
    await writeFile(newPath, oldContent, true)
    let dirHandle: FileSystemDirectoryHandle = rootHandle
    if (dir) {
      for (const part of dir.split('/')) dirHandle = await dirHandle.getDirectoryHandle(part)
    }
    await dirHandle.removeEntry(oldPath.split('/').pop()!)
    invalidateFile(oldPath)
    await deleteFileStatEntry(oldPath)

    const backlinks = cacheStore.backlinkMap[oldPath] ?? []
    cacheActions.removeCacheEntry(oldPath)
    setCacheStore('files', produce((m: Record<string, FileMeta>) => { delete m[oldPath] }))

    const parent = dir || null
    const entry: FileMeta = {
      name: finalName, path: newPath, kind: 'file', parent,
      size: 0, mtime: 0, hash: '', frontmatter: {}, outLinks: [], tags: [], aliases: [],
      created: new Date(0).toISOString().slice(0, 10),
      updated: null, dated: new Date(0).toISOString().slice(0, 10), tasks: [],
    }
    setCacheStore('files', newPath, entry)

    const { workspaceActions } = await import('./workspaceStore')
    workspaceActions.renameLeafPath(oldPath, newPath)
    await cacheActions.reindexFile(newPath, oldContent)
    await updateBacklinks(backlinks, oldPath, newPath)
  },

  async deleteFile(path: string): Promise<void> {
    const { rootHandle } = runtimeStore
    if (!rootHandle) return
    const parts = path.split('/')
    const name = parts.pop()!
    let dir: FileSystemDirectoryHandle = rootHandle
    for (const part of parts) dir = await dir.getDirectoryHandle(part)
    await dir.removeEntry(name)
    invalidateFile(path)
    await deleteFileStatEntry(path)
    cacheActions.removeCacheEntry(path)
    setCacheStore('files', produce((m: Record<string, FileMeta>) => { delete m[path] }))
  },

  async deleteFolder(path: string): Promise<void> {
    const { rootHandle } = runtimeStore
    if (!rootHandle) return
    const parts = path.split('/')
    const name = parts.pop()!
    let parentDir: FileSystemDirectoryHandle = rootHandle
    for (const part of parts) parentDir = await parentDir.getDirectoryHandle(part)
    await parentDir.removeEntry(name, { recursive: true })

    const toRemove = Object.values(cacheStore.files).filter(
      e => e.path === path || e.path.startsWith(path + '/'),
    )
    for (const entry of toRemove) {
      if (entry.kind === 'file') {
        invalidateFile(entry.path)
        await deleteFileStatEntry(entry.path)
        cacheActions.removeCacheEntry(entry.path)
      }
    }
    setCacheStore(
      'files',
      produce((m: Record<string, FileMeta>) => {
        for (const entry of toRemove) delete m[entry.path]
      }),
    )
  },

  beginCreate(mode: 'file' | 'folder', prefix = ''): void {
    setRuntimeStore('fileOp', { type: mode === 'file' ? 'create-file' : 'create-folder', prefix })
  },

  beginRename(path: string): void {
    setRuntimeStore('fileOp', { type: 'rename', path })
  },

  cancelOp(): void {
    setRuntimeStore('fileOp', null)
  },

  async commitCreate(name: string): Promise<void> {
    const op = runtimeStore.fileOp
    if (!op || (op.type !== 'create-file' && op.type !== 'create-folder')) return
    setRuntimeStore('fileOp', null)
    if (op.type === 'create-file') {
      const path = await fileActions.createFile(name)
      if (path) {
        const { workspaceActions } = await import('./workspaceStore')
        workspaceActions.openFile(path, { newTab: true, pin: true })
      }
    } else {
      await fileActions.createFolder(name)
    }
  },

  async commitRename(path: string, newName: string): Promise<void> {
    setRuntimeStore('fileOp', null)
    await fileActions.renameFile(path, newName)
  },
}

export { runtimeStore, setRuntimeStore }
