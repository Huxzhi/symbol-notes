import { get, set, createStore } from 'idb-keyval'
import type { FileMetadata } from '../stores/knowledgeStore'

interface CacheEntry {
  hash: string
  frontmatter: Record<string, unknown>
  outLinks: string[]
  tags: string[]
  aliases: string[]
}

type CachedFields = Pick<FileMetadata, 'frontmatter' | 'outLinks' | 'tags' | 'aliases'>

const idbStore = createStore('symbol-notes', 'file-meta-cache')

// djb2 hash — fast, sync, collision-resistant enough for cache invalidation
function hashContent(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i)
    h >>>= 0
  }
  return h.toString(36)
}

export async function getCachedMeta(
  path: string,
  content: string,
): Promise<CachedFields | null> {
  try {
    const entry = await get<CacheEntry>(path, idbStore)
    if (!entry || entry.hash !== hashContent(content)) return null
    return { frontmatter: entry.frontmatter, outLinks: entry.outLinks, tags: entry.tags, aliases: entry.aliases ?? [] }
  } catch {
    return null
  }
}

export async function setCachedMeta(
  path: string,
  content: string,
  meta: CachedFields,
): Promise<void> {
  try {
    await set(path, { hash: hashContent(content), ...meta } satisfies CacheEntry, idbStore)
  } catch {
    // cache write failure is non-fatal
  }
}
