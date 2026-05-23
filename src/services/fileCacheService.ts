import { get, set, del, keys, createStore } from 'idb-keyval'
import type { FileMetadata } from '../stores/knowledgeStore'

export type CachedFields = Pick<FileMetadata, 'frontmatter' | 'outLinks' | 'tags' | 'aliases'>

const idbStore = createStore('symbol-notes', 'file-meta-cache')

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
