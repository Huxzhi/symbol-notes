import { get, set, del, keys, getMany, createStore } from 'idb-keyval'
import { runtimeStore } from '../stores/runtimeStore'
import type { FileMeta } from '../stores/types'

export type CachedFields = Pick<FileMeta, 'frontmatter' | 'outLinks' | 'tags' | 'aliases'>

const idbStore = createStore('symbol-notes', 'file-meta-cache')
const fileStatStore = createStore('symbol-notes', 'file-stat-cache')

export interface FileStatEntry {
  size: number
  mtime: number
  hash: string
}

export async function loadAllFileStats(): Promise<Map<string, FileStatEntry>> {
  try {
    const allKeys = await keys<string>(fileStatStore)
    const values = await getMany<FileStatEntry>(allKeys, fileStatStore)
    const map = new Map<string, FileStatEntry>()
    for (let i = 0; i < allKeys.length; i++) {
      if (values[i] !== undefined) map.set(allKeys[i], values[i])
    }
    return map
  } catch {
    return new Map()
  }
}

export async function setFileStatEntry(path: string, entry: FileStatEntry): Promise<void> {
  try {
    await set(path, entry, fileStatStore)
  } catch { /* non-fatal */ }
}

export async function deleteFileStatEntry(path: string): Promise<void> {
  try {
    await del(path, fileStatStore)
  } catch { /* non-fatal */ }
}

export async function pruneFileStatCache(activePaths: Set<string>): Promise<void> {
  try {
    const allKeys = await keys<string>(fileStatStore)
    await Promise.all(
      allKeys.filter(k => !activePaths.has(k)).map(k => del(k, fileStatStore)),
    )
  } catch { /* non-fatal */ }
}

// djb2 hash — fast, sync, good enough for cache invalidation
// Primary key for cache entries: same content always maps to same hash,
// path-agnostic so rename/move/WebDAV/S3 path changes don't invalidate cache.
export function hashContent(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i)
    h >>>= 0
  }
  return h.toString(36)
}

export async function getCachedMeta(hash: string): Promise<CachedFields | null> {
  try {
    const entry = await get<CachedFields>(hash, idbStore)
    return entry ?? null
  } catch {
    return null
  }
}

export async function setCachedMeta(hash: string, meta: CachedFields): Promise<void> {
  try {
    await set(hash, meta, idbStore)
  } catch {
    // cache write failure is non-fatal
  }
}

// Remove cache entries whose hashes are no longer referenced by any known file.
// Call after a full vault scan when the complete set of active hashes is known.
export async function pruneCache(activeHashes: Set<string>): Promise<void> {
  try {
    const allKeys = await keys<string>(idbStore)
    await Promise.all(
      allKeys.filter(k => !activeHashes.has(k)).map(k => del(k, idbStore)),
    )
  } catch {
    // GC failure is non-fatal
  }
}

// ── File content I/O + in-memory cache ──────────────────────────────────────

const contentCache = new Map<string, string>()

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
  const cached = contentCache.get(path)
  if (cached !== undefined) return cached
  const handle = await resolveFileHandle(path)
  const content = await (await handle.getFile()).text()
  contentCache.set(path, content)
  return content
}

export async function writeFile(path: string, content: string, create = false): Promise<void> {
  const handle = await resolveFileHandle(path, create)
  const writable = await handle.createWritable()
  await writable.write(content)
  await writable.close()
  contentCache.set(path, content)
  deleteFileStatEntry(path).catch(() => {})
}

export function invalidateFile(path: string): void {
  contentCache.delete(path)
}

export function clearContentCache(): void {
  contentCache.clear()
}
