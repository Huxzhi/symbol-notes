// stat 缓存(持久, IndexedDB):path → { size, mtime, hash }。
// 即 Obsidian 的 fileCache。扫描时据此判断文件「变没变」(size/mtime 一致则复用 hash,
// 跳过重解析)。属 vault 的变更检测;hash 是去 metadata/parsedCache 取解析结果的钥匙。
import { set, del, keys, getMany, createStore } from 'idb-keyval'

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
