import { get, set } from 'idb-keyval'
import { fileSystemStore, setFileSystemStore, type FileNode } from '../stores/fileSystemStore'
import { editorStore, setEditorStore } from '../stores/editorStore'
import { parseFrontmatter, serializeFrontmatter } from '../lib/parseFrontmatter'
import { reindexFile, scanDirectory } from './knowledgeService'

const DB_KEY = 'rootHandle'

export async function openDirectory(): Promise<void> {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
  await set(DB_KEY, handle)
  setFileSystemStore({ rootHandle: handle, activeFilePath: null, openFilePaths: [] })
  setFileSystemStore('tree', await buildTree(handle))
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

export async function openFile(path: string): Promise<void> {
  const handle = await getFileHandle(path)
  const file = await handle.getFile()
  const content = await file.text()
  setEditorStore({ content, isDirty: false })
  setFileSystemStore('activeFilePath', path)
  if (!fileSystemStore.openFilePaths.includes(path)) {
    setFileSystemStore('openFilePaths', [...fileSystemStore.openFilePaths, path])
  }
}

export async function saveCurrentFile(): Promise<void> {
  const { rootHandle, activeFilePath } = fileSystemStore
  const { content, cmView } = editorStore
  if (!rootHandle || !activeFilePath) return

  const { frontmatter } = parseFrontmatter(content)
  const body = cmView?.state.doc.toString() ?? parseFrontmatter(content).body
  const newContent = serializeFrontmatter(frontmatter, body)

  const handle = await getFileHandle(activeFilePath)
  const writable = await handle.createWritable()
  await writable.write(newContent)
  await writable.close()

  setEditorStore({ content: newContent, isDirty: false })
  await reindexFile(activeFilePath, newContent)
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
