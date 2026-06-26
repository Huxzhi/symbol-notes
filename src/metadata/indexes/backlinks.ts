import type { FileMeta } from '../../stores/types'
import { vaultStore } from '../../vault/store'
import { metadataStore, setMetadataStore } from '../store'
import {
  uniqueFileLookup,
  buildUniqueFileLookup,
  invalidateUniqueFileLookup,
} from '../uniqueFileLookup'

// ── Alias 懒缓存（派生自 store.cache 的别名索引） ──────────────────────────────

let _aliasIndex: Map<string, string[]> | null = null

/** 文件集 / 别名变更后,失效派生的链接索引(uniqueFileLookup + aliasIndex)。 */
export function invalidateLinkIndexes(): void {
  invalidateUniqueFileLookup()
  _aliasIndex = null
}

export function getAliasIndex(): Map<string, string[]> {
  if (!_aliasIndex) _aliasIndex = buildAliasIndex(metadataStore.cache)
  return _aliasIndex
}

// ── Link resolution ───────────────────────────────────────────────────────────

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

/** 解析单个文件的出链目标 → 去重后的解析路径列表(正向解析结果)。 */
function resolvedTargetsOf(
  targets: string[],
  stemIndex: Map<string, string[]>,
  files: Record<string, unknown>,
  aliasIndex: Map<string, string[]>,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const target of new Set(targets)) {
    const r = resolveLink(target, stemIndex, files, aliasIndex)
    if (r && !seen.has(r)) {
      seen.add(r)
      out.push(r)
    }
  }
  return out
}

/** resolvedMap(src→targets)反转为 backlinkMap(target→srcs)。 */
function invertResolved(resolvedMap: Record<string, string[]>): Record<string, string[]> {
  const backlinkMap: Record<string, string[]> = {}
  for (const [src, targets] of Object.entries(resolvedMap)) {
    for (const t of targets) (backlinkMap[t] ??= []).push(src)
  }
  return backlinkMap
}

export function buildLinkMaps(
  files: Record<string, { outLinks: { target: string }[] }>,
): {
  resolvedMap: Record<string, string[]>
  backlinkMap: Record<string, string[]>
  unresolvedMap: Record<string, string[]>
} {
  const stemIndex = buildUniqueFileLookup(files)
  const aliasIndex = buildAliasIndex(files as Record<string, { aliases?: string[] }>)
  const resolvedMap: Record<string, string[]> = {}
  const unresolvedMap: Record<string, string[]> = {}
  for (const [src, meta] of Object.entries(files)) {
    for (const target of new Set(meta.outLinks.map(l => l.target))) {
      const resolved = resolveLink(target, stemIndex, files, aliasIndex)
      if (resolved) {
        const list = (resolvedMap[src] ??= [])
        if (!list.includes(resolved)) list.push(resolved)
      } else {
        ;(unresolvedMap[target] ??= []).push(src)
      }
    }
  }
  // 反向链接依靠正向链接(resolvedMap)反转构建。
  const backlinkMap = invertResolved(resolvedMap)
  return { resolvedMap, backlinkMap, unresolvedMap }
}

/** 全量重建 resolvedMap + backlinkMap + unresolvedMap（Phase2 全量扫描后调用） */
export function buildBacklinks(mdFiles: Record<string, FileMeta>): void {
  const { resolvedMap, backlinkMap, unresolvedMap } = buildLinkMaps(mdFiles)
  setMetadataStore('resolvedMap', resolvedMap)
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

/** 单文件 outLinks 变化时增量更新(backlinkMap/unresolvedMap 增量 diff + 重算 resolvedMap[path])。 */
export function applyFileBacklinks(
  path: string,
  prevOutLinks: string[],
  nextOutLinks: string[],
): void {
  const stemIndex = uniqueFileLookup()
  const aliasIndex = getAliasIndex()
  const prev = new Set(prevOutLinks)
  const next = new Set(nextOutLinks)
  for (const t of prev) if (!next.has(t)) unlinkSource(t, path, stemIndex, aliasIndex)
  for (const t of next) if (!prev.has(t)) linkSource(t, path, stemIndex, aliasIndex)
  setMetadataStore(
    'resolvedMap',
    path,
    resolvedTargetsOf(nextOutLinks, stemIndex, vaultStore.files, aliasIndex),
  )
}

/** 文件删除：将其入链移入 unresolvedMap，清理出链与正向项 */
export function removeFileBacklinks(path: string, file: FileMeta): void {
  // 入链:指向 path 的源,其 resolvedMap 去掉 path(已成未解析)
  const backlinks = metadataStore.backlinkMap[path] ?? []
  for (const src of backlinks)
    setMetadataStore('resolvedMap', src, (l: string[]) => (l ?? []).filter((t) => t !== path))
  if (backlinks.length > 0) {
    setMetadataStore('unresolvedMap', path, (l: string[]) => [...(l ?? []), ...backlinks])
    setMetadataStore('backlinkMap', path, [])
  }
  // 出链:清理 backlinkMap/unresolvedMap,并清空自身正向项
  setMetadataStore('resolvedMap', path, [])
  const stemIndex = uniqueFileLookup()
  const aliasIndex = getAliasIndex()
  for (const t of new Set(file.outLinks.map((l) => l.target)))
    unlinkSource(t, path, stemIndex, aliasIndex)
}

/** 新文件创建：将 unresolvedMap 中指向它的链接解析到 backlinkMap 与各源的 resolvedMap */
export function resolveNewFile(newPath: string): void {
  const stem = newPath.split('/').pop()!
  const keysToCheck = newPath !== stem ? [newPath, stem] : [newPath]
  const movedSources = new Set<string>()
  for (const key of keysToCheck) {
    const sources = metadataStore.unresolvedMap[key] ?? []
    if (sources.length === 0) continue
    setMetadataStore('backlinkMap', newPath, (list: string[]) => [...(list ?? []), ...sources])
    setMetadataStore('unresolvedMap', key, [])
    for (const s of sources) movedSources.add(s)
  }
  for (const src of movedSources)
    setMetadataStore('resolvedMap', src, (l: string[]) =>
      (l ?? []).includes(newPath) ? l : [...(l ?? []), newPath],
    )
}
