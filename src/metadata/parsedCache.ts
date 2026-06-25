// 解析缓存(持久, IndexedDB):contentHash → FileCache。
// 即 Obsidian 的 metadataCache。按 hash 存:① 跨会话免重解析 ② 内容相同的文件去重。
// 内存层按 path 存(metadata/cache.ts);此处按 hash 存。同一个 FileCache,两种键。
import { get, set, del, keys, getMany, createStore } from 'idb-keyval'
import type { FileCache } from '../stores/types'

// v3: outLinks 由 string[] 升级为 WikiLinkInfo[]，旧缓存失效以触发重解析
const parsedMetaStore = createStore('sn-meta-v3', 'cache')

export async function getManyMeta(hashes: string[]): Promise<(FileCache | undefined)[]> {
  try {
    return await getMany<FileCache>(hashes, parsedMetaStore)
  } catch {
    return hashes.map(() => undefined)
  }
}

export async function getCachedMeta(hash: string): Promise<FileCache | null> {
  try {
    const entry = await get<FileCache>(hash, parsedMetaStore)
    return entry ?? null
  } catch {
    return null
  }
}

export async function setCachedMeta(hash: string, meta: FileCache): Promise<void> {
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
