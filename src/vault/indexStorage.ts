import { get, set, del, keys, getMany, createStore } from 'idb-keyval'
import type { FileMeta } from '../stores/types'

export type CachedFields = Pick<FileMeta,
  'frontmatter' | 'outLinks' | 'etags' | 'tags' | 'aliases' | 'created' | 'updated' | 'dated' | 'lists'
>

// ── Stat cache: path → { size, mtime, hash } ─────────────────────────────────

const fileStatStore = createStore('sn-stat', 'cache')

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

// ── Content hash (MurmurHash3 x86_128) ───────────────────────────────────────

// 128-bit, sync, no crypto.subtle. Output: 32 hex chars.
function fmix32(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

export function hashContent(str: string): string {
  const bytes = new TextEncoder().encode(str)
  const len = bytes.length
  const nblocks = (len / 16) | 0
  const c1 = 0x239b961b, c2 = 0xab0e9789, c3 = 0x38b34ae5, c4 = 0xa1e38b93
  let h1 = 0, h2 = 0, h3 = 0, h4 = 0

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i < nblocks; i++) {
    const b = i << 4
    let k1 = view.getUint32(b,      true)
    let k2 = view.getUint32(b + 4,  true)
    let k3 = view.getUint32(b + 8,  true)
    let k4 = view.getUint32(b + 12, true)

    k1 = Math.imul(k1, c1) >>> 0; k1 = ((k1 << 15) | (k1 >>> 17)) >>> 0; k1 = Math.imul(k1, c2) >>> 0
    h1 ^= k1; h1 = ((h1 << 19) | (h1 >>> 13)) >>> 0; h1 = (h1 + h2) >>> 0; h1 = (Math.imul(h1, 5) + 0x561ccd1b) >>> 0

    k2 = Math.imul(k2, c2) >>> 0; k2 = ((k2 << 16) | (k2 >>> 16)) >>> 0; k2 = Math.imul(k2, c3) >>> 0
    h2 ^= k2; h2 = ((h2 << 17) | (h2 >>> 15)) >>> 0; h2 = (h2 + h3) >>> 0; h2 = (Math.imul(h2, 5) + 0x0bcaa747) >>> 0

    k3 = Math.imul(k3, c3) >>> 0; k3 = ((k3 << 17) | (k3 >>> 15)) >>> 0; k3 = Math.imul(k3, c4) >>> 0
    h3 ^= k3; h3 = ((h3 << 15) | (h3 >>> 17)) >>> 0; h3 = (h3 + h4) >>> 0; h3 = (Math.imul(h3, 5) + 0x96cd1c35) >>> 0

    k4 = Math.imul(k4, c4) >>> 0; k4 = ((k4 << 18) | (k4 >>> 14)) >>> 0; k4 = Math.imul(k4, c1) >>> 0
    h4 ^= k4; h4 = ((h4 << 13) | (h4 >>> 19)) >>> 0; h4 = (h4 + h1) >>> 0; h4 = (Math.imul(h4, 5) + 0x32ac3b17) >>> 0
  }

  const off = nblocks << 4
  let k1 = 0, k2 = 0, k3 = 0, k4 = 0
  /* eslint-disable no-fallthrough */
  switch (len & 15) {
    case 15: k4 ^= bytes[off + 14] << 16 // falls through
    case 14: k4 ^= bytes[off + 13] << 8  // falls through
    case 13: k4 ^= bytes[off + 12]
      k4 = Math.imul(k4, c4) >>> 0; k4 = ((k4 << 18) | (k4 >>> 14)) >>> 0; k4 = Math.imul(k4, c1) >>> 0; h4 ^= k4
      // falls through
    case 12: k3 ^= bytes[off + 11] << 24 // falls through
    case 11: k3 ^= bytes[off + 10] << 16 // falls through
    case 10: k3 ^= bytes[off + 9] << 8   // falls through
    case  9: k3 ^= bytes[off + 8]
      k3 = Math.imul(k3, c3) >>> 0; k3 = ((k3 << 17) | (k3 >>> 15)) >>> 0; k3 = Math.imul(k3, c4) >>> 0; h3 ^= k3
      // falls through
    case  8: k2 ^= bytes[off + 7] << 24  // falls through
    case  7: k2 ^= bytes[off + 6] << 16  // falls through
    case  6: k2 ^= bytes[off + 5] << 8   // falls through
    case  5: k2 ^= bytes[off + 4]
      k2 = Math.imul(k2, c2) >>> 0; k2 = ((k2 << 16) | (k2 >>> 16)) >>> 0; k2 = Math.imul(k2, c3) >>> 0; h2 ^= k2
      // falls through
    case  4: k1 ^= bytes[off + 3] << 24  // falls through
    case  3: k1 ^= bytes[off + 2] << 16  // falls through
    case  2: k1 ^= bytes[off + 1] << 8   // falls through
    case  1: k1 ^= bytes[off]
      k1 = Math.imul(k1, c1) >>> 0; k1 = ((k1 << 15) | (k1 >>> 17)) >>> 0; k1 = Math.imul(k1, c2) >>> 0; h1 ^= k1
  }
  /* eslint-enable no-fallthrough */

  h1 ^= len; h2 ^= len; h3 ^= len; h4 ^= len
  h1 = (h1 + h2 + h3 + h4) >>> 0
  h2 = (h2 + h1) >>> 0; h3 = (h3 + h1) >>> 0; h4 = (h4 + h1) >>> 0
  h1 = fmix32(h1); h2 = fmix32(h2); h3 = fmix32(h3); h4 = fmix32(h4)
  h1 = (h1 + h2 + h3 + h4) >>> 0
  h2 = (h2 + h1) >>> 0; h3 = (h3 + h1) >>> 0; h4 = (h4 + h1) >>> 0

  return h1.toString(16).padStart(8, '0')
       + h2.toString(16).padStart(8, '0')
       + h3.toString(16).padStart(8, '0')
       + h4.toString(16).padStart(8, '0')
}

// ── Parsed meta cache: contentHash → CachedFields ────────────────────────────

// v2: dated 字段对周/月格式不再回退到 created，旧缓存需失效以触发全量重解析
const parsedMetaStore = createStore('sn-meta-v2', 'cache')

export async function getManyMeta(hashes: string[]): Promise<(CachedFields | undefined)[]> {
  try {
    return await getMany<CachedFields>(hashes, parsedMetaStore)
  } catch {
    return hashes.map(() => undefined)
  }
}

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
