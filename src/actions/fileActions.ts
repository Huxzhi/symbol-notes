import { produce } from 'solid-js/store'
import { globalStore, setGlobalStore } from '../stores/globalStore'
import { runtimeStore, setRuntimeStore } from '../stores/runtimeStore'
import { knowledgeActions } from './knowledgeActions'
import {
  deleteFileStatEntry, invalidateFile, readFile, writeFile,
} from '../services/fileCacheService'
import type { FileMapEntry } from '../stores/types'

// ── Internal helpers ──────────────────────────────────────────────────────────

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

async function updateBacklinks(backlinks: string[], oldPath: string, newPath: string): Promise<void> {
  for (const bPath of backlinks) {
    try {
      const content = await readFile(bPath)
      const updated = replaceWikiLinks(content, oldPath, newPath)
      if (updated !== content) {
        await writeFile(bPath, updated)
        knowledgeActions.remapFileLink(bPath, oldPath, newPath)
      }
    } catch { /* skip unreadable files */ }
  }
}

// ── File system operations ────────────────────────────────────────────────────

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
    const entry: FileMapEntry = { name: finalName, path, kind: 'file', parent }
    setGlobalStore('fs', 'fileMap', path, entry)
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
    const entry: FileMapEntry = { name: dirName, path: name, kind: 'directory', parent }
    setGlobalStore('fs', 'fileMap', name, entry)
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

    const backlinks = globalStore.knowledge.backlinkMap[oldPath] ?? []
    knowledgeActions.removeFileMeta(oldPath)
    setGlobalStore('fs', 'fileMap', produce((m: Record<string, FileMapEntry>) => { delete m[oldPath] }))

    const parent = dir || null
    const entry: FileMapEntry = { name: finalName, path: newPath, kind: 'file', parent }
    setGlobalStore('fs', 'fileMap', newPath, entry)

    const { workspaceActions } = await import('./workspaceActions')
    workspaceActions.renameLeafPath(oldPath, newPath)
    await knowledgeActions.reindexFile(newPath, oldContent)
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
    knowledgeActions.removeFileMeta(path)
    setGlobalStore('fs', 'fileMap', produce((m: Record<string, FileMapEntry>) => { delete m[path] }))
  },

  async deleteFolder(path: string): Promise<void> {
    const { rootHandle } = runtimeStore
    if (!rootHandle) return
    const parts = path.split('/')
    const name = parts.pop()!
    let parentDir: FileSystemDirectoryHandle = rootHandle
    for (const part of parts) parentDir = await parentDir.getDirectoryHandle(part)
    await parentDir.removeEntry(name, { recursive: true })

    const toRemove = Object.values(globalStore.fs.fileMap).filter(
      (e) => e.path === path || e.path.startsWith(path + '/'),
    )
    for (const entry of toRemove) {
      if (entry.kind === 'file') {
        invalidateFile(entry.path)
        await deleteFileStatEntry(entry.path)
        knowledgeActions.removeFileMeta(entry.path)
      }
    }
    setGlobalStore(
      'fs',
      'fileMap',
      produce((m: Record<string, FileMapEntry>) => {
        for (const entry of toRemove) delete m[entry.path]
      }),
    )
  },

  // ── UI operation flow ───────────────────────────────────────────────────────

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
        const { workspaceActions } = await import('./workspaceActions')
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
