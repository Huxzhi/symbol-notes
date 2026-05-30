import { get, set, del, keys, getMany, createStore } from 'idb-keyval'
import type { FileMeta } from '../stores/types'

export type CachedFields = Pick<FileMeta,
  'frontmatter' | 'outLinks' | 'tags' | 'aliases' | 'created' | 'updated' | 'tasks'
>

// ── Stat cache: path → { size, mtime, hash } ─────────────────────────────────

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

// ── Content hash ──────────────────────────────────────────────────────────────

// djb2 — fast, sync, path-agnostic: same content → same hash regardless of path.
// Used as primary key for parsed-meta so renames/moves don't invalidate cache.
export function hashContent(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i)
    h >>>= 0
  }
  return h.toString(36)
}

// ── Parsed meta cache: contentHash → CachedFields ────────────────────────────

const parsedMetaStore = createStore('symbol-notes', 'parsed-meta')

export async function getCachedMeta(hash: string): Promise<CachedFields | null> {
  try {
    const entry = await get<CachedFields>(hash, parsedMetaStore)
    return entry ?? null
  } catch {
    return null
  }
}

export async function setCachedMeta(hash: string, meta: CachedFields): Promise<void> {
  try {
    await set(hash, meta, parsedMetaStore)
  } catch { /* non-fatal */ }
}

export async function pruneCache(activeHashes: Set<string>): Promise<void> {
  try {
    const allKeys = await keys<string>(parsedMetaStore)
    await Promise.all(
      allKeys.filter(k => !activeHashes.has(k)).map(k => del(k, parsedMetaStore)),
    )
  } catch { /* non-fatal */ }
}
