import { runtimeStore } from '../stores/runtimeStore'
import { deleteFileStatEntry } from './indexStorage'

const fileContentCache = new Map<string, string>()

async function resolveFileHandle(path: string, create = false): Promise<FileSystemFileHandle> {
  const { rootHandle } = runtimeStore
  if (!rootHandle) throw new Error('No root directory')
  const parts = path.split('/')
  let dir: FileSystemDirectoryHandle = rootHandle
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i])
  }
  return dir.getFileHandle(parts[parts.length - 1], create ? { create: true } : undefined)
}

export async function readFile(path: string): Promise<string> {
  const cached = fileContentCache.get(path)
  if (cached !== undefined) return cached
  const handle = await resolveFileHandle(path)
  const content = await (await handle.getFile()).text()
  fileContentCache.set(path, content)
  return content
}

export async function writeFile(path: string, content: string, create = false): Promise<void> {
  const handle = await resolveFileHandle(path, create)
  const writable = await handle.createWritable()
  await writable.write(content)
  await writable.close()
  fileContentCache.set(path, content)
  // Invalidate stat so the next scan re-examines this file
  deleteFileStatEntry(path).catch(() => {})
}

export async function getFileMtime(path: string): Promise<number> {
  const handle = await resolveFileHandle(path)
  return (await handle.getFile()).lastModified
}

export function invalidateFile(path: string): void {
  fileContentCache.delete(path)
}

export function clearContentCache(): void {
  fileContentCache.clear()
}
