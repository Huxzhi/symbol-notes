import { get, set } from 'idb-keyval'
import { fileSystemStore, setFileSystemStore, type FileNode } from '../stores/fileSystemStore'
import { editorStore, setEditorStore } from '../stores/editorStore'
import { reindexFile, scanDirectory } from './knowledgeService'
import { startBackgroundParsing } from './backgroundParser'

const DB_KEY = 'rootHandle'

export async function openDirectory(): Promise<void> {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
  await set(DB_KEY, handle)
  setFileSystemStore({ rootHandle: handle, activeFilePath: null, openFilePaths: [] })
  setFileSystemStore('tree', await buildTree(handle))
  await scanDirectory()
}

export async function restoreDirectory(): Promise<void> {
  const handle = await get<FileSystemDirectoryHandle>(DB_KEY)
  if (!handle) return
  try {
    const perm = await handle.requestPermission({ mode: 'readwrite' })
    if (perm !== 'granted') return
    setFileSystemStore({ rootHandle: handle })
    setFileSystemStore('tree', await buildTree(handle))
    await scanDirectory()
  } catch {
    // handle was invalidated (e.g. directory moved/deleted)
  }
}

async function buildTree(
  dirHandle: FileSystemDirectoryHandle,
  path = '',
): Promise<FileNode[]> {
  const nodes: FileNode[] = []
  for await (const [name, handle] of dirHandle.entries()) {
    if (name.startsWith('.')) continue
    const nodePath = path ? `${path}/${name}` : name
    if (handle.kind === 'directory') {
      const children = await buildTree(handle as FileSystemDirectoryHandle, nodePath)
      nodes.push({ name, path: nodePath, kind: 'directory', children })
    } else if (name.endsWith('.md')) {
      nodes.push({ name, path: nodePath, kind: 'file' })
    }
  }
  return nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

async function getFileHandle(path: string): Promise<FileSystemFileHandle> {
  const { rootHandle } = fileSystemStore
  if (!rootHandle) throw new Error('No root directory')
  const parts = path.split('/')
  let dir: FileSystemDirectoryHandle = rootHandle
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i])
  }
  return dir.getFileHandle(parts[parts.length - 1])
}

export async function createFile(name: string, dirPath?: string): Promise<void> {
  const { rootHandle } = fileSystemStore
  if (!rootHandle) return
  const filename = name.endsWith('.md') ? name : `${name}.md`
  let dir: FileSystemDirectoryHandle = rootHandle
  if (dirPath) {
    for (const part of dirPath.split('/')) {
      dir = await dir.getDirectoryHandle(part)
    }
  }
  const filePath = dirPath ? `${dirPath}/${filename}` : filename
  const handle = await dir.getFileHandle(filename, { create: true })
  const writable = await handle.createWritable()
  await writable.write('')
  await writable.close()
  setFileSystemStore('tree', await buildTree(rootHandle))
  await openFile(filePath)
}

export async function openFile(path: string): Promise<void> {
  const handle = await getFileHandle(path)
  const file = await handle.getFile()
  const content = await file.text()
  setEditorStore({ content, isDirty: false })
  setFileSystemStore('activeFilePath', path)
  if (!fileSystemStore.openFilePaths.includes(path)) {
    setFileSystemStore('openFilePaths', [...fileSystemStore.openFilePaths, path])
  }
  startBackgroundParsing(path)
}

export async function saveCurrentFile(): Promise<void> {
  const { rootHandle, activeFilePath } = fileSystemStore
  const { cmView } = editorStore
  if (!rootHandle || !activeFilePath || !cmView) return

  const newContent = cmView.state.doc.toString()

  const handle = await getFileHandle(activeFilePath)
  const writable = await handle.createWritable()
  await writable.write(newContent)
  await writable.close()

  setEditorStore({ content: newContent, isDirty: false })
  await reindexFile(activeFilePath, newContent)
}

export async function renameFile(oldPath: string, newBaseName: string): Promise<void> {
  const { rootHandle } = fileSystemStore
  if (!rootHandle) return

  const parts = oldPath.split('/')
  const oldFileName = parts[parts.length - 1]
  const dirParts = parts.slice(0, -1)
  const newFileName = newBaseName.endsWith('.md') ? newBaseName : `${newBaseName}.md`
  const newPath = dirParts.length > 0 ? `${dirParts.join('/')}/${newFileName}` : newFileName

  if (newPath === oldPath) return

  let parentDir: FileSystemDirectoryHandle = rootHandle
  for (const part of dirParts) {
    parentDir = await parentDir.getDirectoryHandle(part)
  }

  // Write new file — use editor content to preserve any unsaved changes
  const content = editorStore.content
  const newHandle = await parentDir.getFileHandle(newFileName, { create: true })
  const writable = await newHandle.createWritable()
  await writable.write(content)
  await writable.close()

  // Try to delete old file; file systems that don't support delete (WebDAV, S3)
  // will throw here — give the user a choice instead of silently failing.
  try {
    await parentDir.removeEntry(oldFileName)
  } catch {
    const proceed = window.confirm(
      `文件系统不支持删除操作。\n` +
      `已成功创建「${newFileName}」，但「${oldFileName}」无法自动删除。\n\n` +
      `是否切换到新文件？（旧文件将保留）`,
    )
    if (!proceed) {
      // Roll back: remove the newly created file and abort
      try { await parentDir.removeEntry(newFileName) } catch {}
      return
    }
  }

  // Update open tab list and active path
  setFileSystemStore(
    'openFilePaths',
    fileSystemStore.openFilePaths.map(p => (p === oldPath ? newPath : p)),
  )
  setFileSystemStore('activeFilePath', newPath)
  setEditorStore({ isDirty: false })

  // Rebuild file tree and knowledge index
  // Knowledge index: old path disappears (deleted), new path appears; cache hit
  // because content hash is identical — no re-parse needed.
  setFileSystemStore('tree', await buildTree(rootHandle))
  await scanDirectory()
}

export function closeFile(path: string): void {
  const paths = fileSystemStore.openFilePaths.filter(p => p !== path)
  setFileSystemStore('openFilePaths', paths)
  if (fileSystemStore.activeFilePath === path) {
    const next = paths[paths.length - 1] ?? null
    setFileSystemStore('activeFilePath', next)
    if (next) openFile(next)
    else setEditorStore({ content: '', isDirty: false })
  }
}
