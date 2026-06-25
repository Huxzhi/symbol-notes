// 每文件解析缓存的读写 + 合并视图。
// cache 是 metadata 拥有的(path → FileCache,解析得来、可重建);stat 在 vault/store.files。
import type { FileCache, FileEntry, FileMeta } from '../stores/types'
import { vaultStore } from '../vault/store'
import { metadataStore, setMetadataStore } from './store'
import { extractDateFromName } from './parse/extract'

export const EMPTY_CACHE: FileCache = {
  frontmatter: {},
  outLinks: [],
  etags: [],
  tags: [],
  aliases: [],
  created: '',
  updated: null,
  dated: '',
  lists: [],
}

/** 某文件的解析内容(响应式,只订阅该 path)。 */
export function fileCache(path: string): FileCache | undefined {
  return metadataStore.cache[path]
}

/** 合并 stat + 解析内容的视图。内容缺失(扫描后、解析前)时用空内容兜底。 */
export function getFile(path: string): FileMeta | undefined {
  const entry = vaultStore.files[path]
  if (!entry) return undefined
  return { ...entry, ...(metadataStore.cache[path] ?? EMPTY_CACHE) }
}

/** 全部文件的合并视图(stat + 内容)。供需要遍历全部并读内容的消费方。 */
export function allFiles(): Record<string, FileMeta> {
  const out: Record<string, FileMeta> = {}
  for (const path of Object.keys(vaultStore.files)) {
    const f = getFile(path)
    if (f) out[path] = f
  }
  return out
}

export function setFileCache(path: string, content: FileCache): void {
  setMetadataStore('cache', path, content)
}

export function removeFileCache(path: string): void {
  setMetadataStore('cache', path, undefined as unknown as FileCache)
}

/** 扫描后用 stat 给每个 entry 播种「临时内容」(created/dated 由 mtime/文件名推),
 *  让日历等在后台解析完成前就有日期可用;解析完成后被真实内容覆盖。 */
export function seedCache(
  entries: Record<string, FileEntry>,
): Record<string, FileCache> {
  const epoch = new Date(0).toISOString().slice(0, 10)
  const out: Record<string, FileCache> = {}
  for (const entry of Object.values(entries)) {
    const day =
      entry.kind === 'directory'
        ? epoch
        : new Date(entry.mtime).toISOString().slice(0, 10)
    out[entry.path] = {
      ...EMPTY_CACHE,
      created: day,
      dated: extractDateFromName(entry.name) ?? day,
    }
  }
  return out
}
