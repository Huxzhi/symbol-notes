import { vaultStore } from '../vault/store'

// 职责:metadata 直接管理的「唯一文件名查找表」——base 名(含 .md)→ 同名文件路径列表。
// 「文件名→文件」的高速字典:命中接近 O(1);list.length > 1 即同名冲突,由上层
// (链接解析 / 自动补全)按完整路径消歧。懒构建,文件集变更时由 fileManager 调
// invalidate 清空、下次访问重建。
let _uniqueFileLookup: Map<string, string[]> | null = null

/** 纯构建:从 files 的 path 集合派生 base 名(含 .md)→ 路径列表,跳过非 md。 */
export function buildUniqueFileLookup(files: Record<string, unknown>): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const path of Object.keys(files)) {
    if (!path.endsWith('.md')) continue
    const base = path.split('/').pop()!
    const list = index.get(base)
    if (list) list.push(path)
    else index.set(base, [path])
  }
  return index
}

/** 懒缓存的查找表(派生自 vaultStore.files)。 */
export function uniqueFileLookup(): Map<string, string[]> {
  if (!_uniqueFileLookup) _uniqueFileLookup = buildUniqueFileLookup(vaultStore.files)
  return _uniqueFileLookup
}

/** 文件集变更后失效,下次 uniqueFileLookup() 重建。 */
export function invalidateUniqueFileLookup(): void {
  _uniqueFileLookup = null
}
