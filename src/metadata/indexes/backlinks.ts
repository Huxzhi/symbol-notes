import type { FileMeta } from '../../stores/types'
import { vaultStore } from '../../vault/store'
import { metadataStore, setMetadataStore } from '../store'

// ── Stem / alias 懒缓存（派生自 store.files 的链接索引） ───────────────────────

let _stemIndex: Map<string, string[]> | null = null
let _aliasIndex: Map<string, string[]> | null = null

export function invalidateStemIndex(): void {
  _stemIndex = null
  _aliasIndex = null
}

export function getStemIndex(): Map<string, string[]> {
  if (!_stemIndex) _stemIndex = buildStemIndex(vaultStore.files)
  return _stemIndex
}

export function getAliasIndex(): Map<string, string[]> {
  if (!_aliasIndex) _aliasIndex = buildAliasIndex(metadataStore.cache)
  return _aliasIndex
}

// ── Link resolution ───────────────────────────────────────────────────────────

export function buildStemIndex(files: Record<string, unknown>): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const path of Object.keys(files)) {
    if (!path.endsWith('.md')) continue
    const stem = path.split('/').pop()!
    const list = index.get(stem)
    if (list) list.push(path)
    else index.set(stem, [path])
  }
  return index
}

export function buildAliasIndex(
  files: Record<string, { aliases?: string[] }>,
): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const [path, meta] of Object.entries(files)) {
    if (!path.endsWith('.md')) continue
    for (const alias of meta.aliases ?? []) {
      const key = alias.toLowerCase()
      const list = index.get(key)
      if (list) list.push(path)
      else index.set(key, [path])
    }
  }
  return index
}

export function resolveLink(
  target: string,
  stemIndex: Map<string, string[]>,
  files: Record<string, unknown>,
  aliasIndex?: Map<string, string[]>,
): string | null {
  if (target in files) return target
  const stem = target.split('/').pop()!
  const candidates = stemIndex.get(stem) ?? []
  if (candidates.length === 1) return candidates[0]
  const pathMatches = candidates.filter(c => c === target || c.endsWith('/' + target))
  if (pathMatches.length === 1) return pathMatches[0]
  if (aliasIndex) {
    const aliasKey = target.replace(/\.md$/, '').toLowerCase()
    const aliasHits = aliasIndex.get(aliasKey) ?? []
    if (aliasHits.length === 1) return aliasHits[0]
  }
  return null
}

export function buildLinkMaps(
  files: Record<string, { outLinks: { target: string }[] }>,
): { backlinkMap: Record<string, string[]>; unresolvedMap: Record<string, string[]> } {
  const stemIndex = buildStemIndex(files)
  const aliasIndex = buildAliasIndex(files as Record<string, { aliases?: string[] }>)
  const backlinkMap: Record<string, string[]> = {}
  const unresolvedMap: Record<string, string[]> = {}
  for (const [src, meta] of Object.entries(files)) {
    for (const target of new Set(meta.outLinks.map(l => l.target))) {
      const resolved = resolveLink(target, stemIndex, files, aliasIndex)
      if (resolved) {
        ;(backlinkMap[resolved] ??= []).push(src)
      } else {
        ;(unresolvedMap[target] ??= []).push(src)
      }
    }
  }
  return { backlinkMap, unresolvedMap }
}

/** 全量重建 backlinkMap + unresolvedMap（Phase2 全量扫描后调用） */
export function buildBacklinks(mdFiles: Record<string, FileMeta>): void {
  const { backlinkMap, unresolvedMap } = buildLinkMaps(mdFiles)
  setMetadataStore('backlinkMap', backlinkMap)
  setMetadataStore('unresolvedMap', unresolvedMap)
}

/** 把 path 这条入链记进 target 对应的 map（解析得到 → backlinkMap，否则 unresolvedMap）。 */
function linkSource(
  target: string,
  path: string,
  stemIndex: Map<string, string[]>,
  aliasIndex: Map<string, string[]>,
): void {
  const add = (l: string[]): string[] => (l ? [...l, path] : [path])
  const r = resolveLink(target, stemIndex, vaultStore.files, aliasIndex)
  if (r) setMetadataStore('backlinkMap', r, add)
  else setMetadataStore('unresolvedMap', target, add)
}

/** 从 target 对应的 map 里移除 path 这条入链。 */
function unlinkSource(
  target: string,
  path: string,
  stemIndex: Map<string, string[]>,
  aliasIndex: Map<string, string[]>,
): void {
  const remove = (l: string[]): string[] => l?.filter((p) => p !== path) ?? []
  const r = resolveLink(target, stemIndex, vaultStore.files, aliasIndex)
  if (r) setMetadataStore('backlinkMap', r, remove)
  else setMetadataStore('unresolvedMap', target, remove)
}

/** 单文件 outLinks 变化时增量更新 */
export function applyFileBacklinks(
  path: string,
  prevOutLinks: string[],
  nextOutLinks: string[],
): void {
  const stemIndex = getStemIndex()
  const aliasIndex = getAliasIndex()
  const prev = new Set(prevOutLinks)
  const next = new Set(nextOutLinks)
  for (const t of prev) if (!next.has(t)) unlinkSource(t, path, stemIndex, aliasIndex)
  for (const t of next) if (!prev.has(t)) linkSource(t, path, stemIndex, aliasIndex)
}

/** 文件删除：将其入链移入 unresolvedMap，清理出链 */
export function removeFileBacklinks(path: string, file: FileMeta): void {
  const backlinks = metadataStore.backlinkMap[path] ?? []
  if (backlinks.length > 0) {
    setMetadataStore('unresolvedMap', path, (l: string[]) => [...(l ?? []), ...backlinks])
    setMetadataStore('backlinkMap', path, [])
  }
  const stemIndex = getStemIndex()
  const aliasIndex = getAliasIndex()
  for (const t of new Set(file.outLinks.map((l) => l.target)))
    unlinkSource(t, path, stemIndex, aliasIndex)
}

/** 新文件创建：将 unresolvedMap 中指向它的链接解析到 backlinkMap */
export function resolveNewFile(newPath: string): void {
  const stem = newPath.split('/').pop()!
  const keysToCheck = newPath !== stem ? [newPath, stem] : [newPath]
  for (const key of keysToCheck) {
    const sources = metadataStore.unresolvedMap[key] ?? []
    if (sources.length === 0) continue
    setMetadataStore('backlinkMap', newPath, (list: string[]) => [...(list ?? []), ...sources])
    setMetadataStore('unresolvedMap', key, [])
  }
}
