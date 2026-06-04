import { createStore, produce } from 'solid-js/store'
import { vaultActions, vaultStore, setVaultStore, invalidateStemIndex } from './vaultStore'
import {
  initFileIO, isReady,
  readFile, writeFile, getFileMtime,
  deleteEntry, invalidatePrefix, createDirectory,
  invalidateFile,
} from '../services/fileIO'
import { deleteFileStatEntry } from '../services/indexStorage'
import { clearEmbedUrlCache } from '../lib/cm6/embedExtension'
import { LocalAdapter } from '../services/fs/LocalAdapter'
import type { FileMeta, RuntimeState } from './types'
import type { ParseResult } from '../lib/parseMarkdown'

const [runtimeStore, setRuntimeStore] = createStore<RuntimeState>({
  fs: null,
  leafInstances: {},
  fileOp: null,
  isIndexing: false,
})

// ── App actions ───────────────────────────────────────────────────────────────

export const appActions = {
  async openVault(): Promise<void> {
    clearEmbedUrlCache()
    const adapter = await LocalAdapter.open()
    initFileIO(adapter)
    setRuntimeStore('fs', adapter)
    const { workspaceActions } = await import('./workspaceStore')
    workspaceActions.clearAllLeaves()
    const { scanAndIndex } = await import('../services/vaultIndexer')
    await scanAndIndex()
  },

  async restoreVault(): Promise<void> {
    const adapter = await LocalAdapter.restore()
    if (!adapter) return
    initFileIO(adapter)
    setRuntimeStore('fs', adapter)
    const { scanAndIndex } = await import('../services/vaultIndexer')
    await scanAndIndex()
  },

}

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

function resolveUnresolved(newPath: string): void {
  const stem = newPath.split('/').pop()!
  const keysToCheck = newPath !== stem ? [newPath, stem] : [newPath]
  for (const key of keysToCheck) {
    const sources = vaultStore.unresolvedMap[key] ?? []
    if (sources.length === 0) continue
    setVaultStore('backlinkMap', newPath, (list: string[]) => [...(list ?? []), ...sources])
    setVaultStore('unresolvedMap', key, [])
  }
}

async function updateBacklinks(oldPath: string, newPath: string): Promise<void> {
  const backlinks = vaultStore.backlinkMap[oldPath] ?? []
  for (const bPath of backlinks) {
    try {
      const content = await readFile(bPath)
      const updated = replaceWikiLinks(content, oldPath, newPath)
      if (updated !== content) {
        await writeFile(bPath, updated)
        vaultActions.remapFileLink(bPath, oldPath, newPath)
      }
    } catch { /* skip unreadable files */ }
  }
}

// ── File actions ──────────────────────────────────────────────────────────────

export const fileActions = {
  readFile(path: string): Promise<string> {
    return readFile(path)
  },

  async saveFile(path: string, content: string, cmParsed?: ParseResult): Promise<void> {
    await writeFile(path, content)
    const mtime = await getFileMtime(path)
    setVaultStore('files', path, 'mtime', mtime)
    await vaultActions.reindexFile(path, content, cmParsed, true)
  },

  async createFile(name: string): Promise<string | null> {
    if (!isReady()) return null
    const parts = name.includes('/') ? name.split('/') : [name]
    const fileName = parts.pop()!
    const finalName = fileName.endsWith('.md') ? fileName : `${fileName}.md`
    if (parts.length > 0) await createDirectory(parts.join('/'))
    const path = parts.length > 0 ? `${parts.join('/')}/${finalName}` : finalName
    await writeFile(path, '')
    const parent = parts.length > 0 ? parts.join('/') : null
    const entry: FileMeta = {
      name: finalName, path, kind: 'file', parent,
      size: 0, mtime: 0, hash: '', frontmatter: {}, outLinks: [], tags: [], aliases: [],
      created: new Date(0).toISOString().slice(0, 10),
      updated: null, dated: new Date(0).toISOString().slice(0, 10), tasks: [],
    }
    setVaultStore('files', path, entry)
    invalidateStemIndex()
    resolveUnresolved(path)
    return path
  },

  async createFolder(name: string): Promise<void> {
    if (!isReady()) return
    await createDirectory(name)
    const parts = name.split('/')
    const dirName = parts[parts.length - 1]
    const parent = parts.length > 1 ? parts.slice(0, -1).join('/') : null
    const entry: FileMeta = {
      name: dirName, path: name, kind: 'directory', parent,
      size: 0, mtime: 0, hash: '', frontmatter: {}, outLinks: [], tags: [], aliases: [],
      created: new Date(0).toISOString().slice(0, 10),
      updated: null, dated: new Date(0).toISOString().slice(0, 10), tasks: [],
    }
    setVaultStore('files', name, entry)
    invalidateStemIndex()
  },

  async renameFile(oldPath: string, newName: string): Promise<void> {
    if (!isReady()) return
    const dir = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : ''
    const finalName = newName.endsWith('.md') ? newName : `${newName}.md`
    const newPath = dir ? `${dir}/${finalName}` : finalName

    if (newPath !== oldPath && vaultStore.files[newPath]) {
      throw new Error(`已存在同名文件：${finalName}`)
    }

    const oldContent = await readFile(oldPath)
    await writeFile(newPath, oldContent)
    await deleteEntry(oldPath)
    await deleteFileStatEntry(oldPath)

    vaultActions.removeVaultEntry(oldPath)
    setVaultStore('files', produce((m: Record<string, FileMeta>) => { delete m[oldPath] }))

    const parent = dir || null
    const entry: FileMeta = {
      name: finalName, path: newPath, kind: 'file', parent,
      size: 0, mtime: 0, hash: '', frontmatter: {}, outLinks: [], tags: [], aliases: [],
      created: new Date(0).toISOString().slice(0, 10),
      updated: null, dated: new Date(0).toISOString().slice(0, 10), tasks: [],
    }
    setVaultStore('files', newPath, entry)
    invalidateStemIndex()

    const { workspaceActions } = await import('./workspaceStore')
    workspaceActions.renameLeafPath(oldPath, newPath)
    await vaultActions.reindexFile(newPath, oldContent)
    await updateBacklinks(oldPath, newPath)
  },

  async deleteFile(path: string): Promise<void> {
    if (!isReady()) return
    await deleteEntry(path)
    await deleteFileStatEntry(path)
    vaultActions.removeVaultEntry(path)
    setVaultStore('files', produce((m: Record<string, FileMeta>) => { delete m[path] }))
    invalidateStemIndex()
  },

  async deleteFolder(path: string): Promise<void> {
    if (!isReady()) return
    const toRemove = Object.values(vaultStore.files).filter(
      e => e.path === path || e.path.startsWith(path + '/'),
    )
    await deleteEntry(path, { recursive: true })
    invalidatePrefix(path)
    for (const entry of toRemove) {
      if (entry.kind === 'file') {
        await deleteFileStatEntry(entry.path)
        vaultActions.removeVaultEntry(entry.path)
      }
    }
    setVaultStore(
      'files',
      produce((m: Record<string, FileMeta>) => {
        for (const entry of toRemove) delete m[entry.path]
      }),
    )
    invalidateStemIndex()
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

  async moveFile(srcPath: string, destDirPath: string | null): Promise<void> {
    if (!isReady()) return
    const name = srcPath.split('/').pop()!
    const newPath = destDirPath ? `${destDirPath}/${name}` : name
    if (newPath === srcPath) return

    if (vaultStore.files[newPath]) {
      throw new Error(`目标位置已存在同名文件：${name}`)
    }

    const oldContent = await readFile(srcPath)
    await writeFile(newPath, oldContent)
    await deleteEntry(srcPath)
    await deleteFileStatEntry(srcPath)

    vaultActions.removeVaultEntry(srcPath)
    setVaultStore('files', produce((m: Record<string, FileMeta>) => { delete m[srcPath] }))

    const entry: FileMeta = {
      name, path: newPath, kind: 'file', parent: destDirPath ?? null,
      size: 0, mtime: 0, hash: '', frontmatter: {}, outLinks: [], tags: [], aliases: [],
      created: new Date(0).toISOString().slice(0, 10),
      updated: null, dated: new Date(0).toISOString().slice(0, 10), tasks: [],
    }
    setVaultStore('files', newPath, entry)
    invalidateStemIndex()

    const { workspaceActions } = await import('./workspaceStore')
    workspaceActions.renameLeafPath(srcPath, newPath)
    await vaultActions.reindexFile(newPath, oldContent)
    await updateBacklinks(srcPath, newPath)
  },

  async moveFolder(srcPath: string, destDirPath: string | null): Promise<void> {
    if (!isReady()) return
    const folderName = srcPath.split('/').pop()!
    const newFolderPath = destDirPath ? `${destDirPath}/${folderName}` : folderName
    if (newFolderPath === srcPath) return
    if (newFolderPath.startsWith(srcPath + '/')) return

    if (vaultStore.files[newFolderPath]) {
      throw new Error(`目标位置已存在同名文件夹：${folderName}`)
    }

    const descendants = Object.values(vaultStore.files).filter(
      e => e.path === srcPath || e.path.startsWith(srcPath + '/'),
    )
    const fileEntries = descendants.filter(e => e.kind === 'file')
    const dirEntries = descendants.filter(e => e.kind === 'directory')

    const allNewDirs = [newFolderPath, ...dirEntries.map(
      e => newFolderPath + e.path.slice(srcPath.length),
    )].sort((a, b) => a.split('/').length - b.split('/').length)

    for (const dirPath of allNewDirs) await createDirectory(dirPath)

    const fileContents = new Map<string, string>()
    for (const entry of fileEntries) {
      const content = await readFile(entry.path)
      fileContents.set(entry.path, content)
      const newFilePath = newFolderPath + entry.path.slice(srcPath.length)
      await writeFile(newFilePath, content)
    }

    await deleteEntry(srcPath, { recursive: true })
    invalidatePrefix(srcPath)
    for (const entry of fileEntries) await deleteFileStatEntry(entry.path)

    setVaultStore('files', produce((m: Record<string, FileMeta>) => {
      for (const entry of descendants) delete m[entry.path]
    }))
    for (const entry of descendants) {
      const newEntryPath = newFolderPath + entry.path.slice(srcPath.length)
      const newParent = newEntryPath.includes('/')
        ? newEntryPath.slice(0, newEntryPath.lastIndexOf('/'))
        : null
      setVaultStore('files', newEntryPath, { ...entry, path: newEntryPath, parent: newParent, hash: '' })
    }
    invalidateStemIndex()

    const { workspaceActions } = await import('./workspaceStore')
    for (const entry of fileEntries) {
      const newFilePath = newFolderPath + entry.path.slice(srcPath.length)
      const content = fileContents.get(entry.path) ?? ''
      workspaceActions.renameLeafPath(entry.path, newFilePath)
      await vaultActions.reindexFile(newFilePath, content)
      await updateBacklinks(entry.path, newFilePath)
    }
  },

  async moveEntry(srcPath: string, destDirPath: string | null): Promise<void> {
    const entry = vaultStore.files[srcPath]
    if (!entry) return
    if (entry.kind === 'directory') {
      await fileActions.moveFolder(srcPath, destDirPath)
    } else {
      await fileActions.moveFile(srcPath, destDirPath)
    }
  },
}

export { runtimeStore, setRuntimeStore }
