import type { FileSystemAdapter } from './types'
import { deleteFileStatEntry } from '../statCache'
export type { DirEntry, ScanEntry } from './types'

let _adapter: FileSystemAdapter | null = null
const contentCache = new Map<string, string>()

export function initFileIO(adapter: FileSystemAdapter | null): void {
  _adapter = adapter
  contentCache.clear()
}

export function isReady(): boolean {
  return _adapter !== null
}

function adapter(): FileSystemAdapter {
  if (!_adapter) throw new Error('No file system adapter')
  return _adapter
}

export async function readFile(path: string): Promise<string> {
  const cached = contentCache.get(path)
  if (cached !== undefined) return cached
  const content = await adapter().readText(path)
  contentCache.set(path, content)
  return content
}

export async function writeFile(path: string, content: string): Promise<void> {
  await adapter().writeText(path, content)
  contentCache.set(path, content)
  deleteFileStatEntry(path).catch(() => {})
}

export async function getFileMtime(path: string): Promise<number> {
  return adapter().getMtime(path)
}

export async function getFile(path: string): Promise<File> {
  return adapter().getFile(path)
}

export async function deleteEntry(
  path: string,
  opts?: { recursive?: boolean },
): Promise<void> {
  await adapter().deleteEntry(path, opts)
  contentCache.delete(path)
  deleteFileStatEntry(path).catch(() => {})
}

export function invalidatePrefix(prefix: string): void {
  for (const key of contentCache.keys()) {
    if (key === prefix || key.startsWith(prefix + '/')) contentCache.delete(key)
  }
}

export async function createDirectory(path: string): Promise<void> {
  return adapter().createDirectory(path)
}

export async function* listAll(): AsyncGenerator<
  import('./types').DirEntry
> {
  if (!_adapter) return
  yield* _adapter.listAll()
}

export async function scanTree(
  concurrency?: number,
  onStat?: () => void,
): Promise<import('./types').ScanEntry[]> {
  if (!_adapter) return []
  return _adapter.scanTree(concurrency, onStat)
}

export function invalidateFile(path: string): void {
  contentCache.delete(path)
}
