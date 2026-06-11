import type { FileMeta } from '../stores/types'
import { vaultStore, setVaultStore, getStemIndex } from './index'

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
  files: Record<string, { outLinks: string[] }>,
): { backlinkMap: Record<string, string[]>; unresolvedMap: Record<string, string[]> } {
  const stemIndex = buildStemIndex(files)
  const backlinkMap: Record<string, string[]> = {}
  const unresolvedMap: Record<string, string[]> = {}
  for (const [src, meta] of Object.entries(files)) {
    for (const target of meta.outLinks) {
      const resolved = resolveLink(target, stemIndex, files)
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
  setVaultStore('backlinkMap', backlinkMap)
  setVaultStore('unresolvedMap', unresolvedMap)
}

/** 单文件 outLinks 变化时增量更新 */
export function applyFileBacklinks(
  path: string,
  prevOutLinks: string[],
  nextOutLinks: string[],
): void {
  const stemIndex = getStemIndex()
  const prev = new Set(prevOutLinks)
  const next = new Set(nextOutLinks)
  for (const t of prev) {
    if (!next.has(t)) {
      const r = resolveLink(t, stemIndex, vaultStore.files)
      if (r) setVaultStore('backlinkMap', r, (l: string[]) => l?.filter(p => p !== path) ?? [])
      else setVaultStore('unresolvedMap', t, (l: string[]) => l?.filter(p => p !== path) ?? [])
    }
  }
  for (const t of next) {
    if (!prev.has(t)) {
      const r = resolveLink(t, stemIndex, vaultStore.files)
      if (r) setVaultStore('backlinkMap', r, (l: string[]) => l ? [...l, path] : [path])
      else setVaultStore('unresolvedMap', t, (l: string[]) => l ? [...l, path] : [path])
    }
  }
}

/** 文件删除：将其入链移入 unresolvedMap，清理出链 */
export function removeFileBacklinks(path: string, file: FileMeta): void {
  const backlinks = vaultStore.backlinkMap[path] ?? []
  if (backlinks.length > 0) {
    setVaultStore('unresolvedMap', path, (l: string[]) => [...(l ?? []), ...backlinks])
    setVaultStore('backlinkMap', path, [])
  }
  const stemIndex = getStemIndex()
  for (const t of file.outLinks) {
    const r = resolveLink(t, stemIndex, vaultStore.files)
    if (r) setVaultStore('backlinkMap', r, (l: string[]) => l?.filter(p => p !== path) ?? [])
    else setVaultStore('unresolvedMap', t, (l: string[]) => l?.filter(p => p !== path) ?? [])
  }
}

/** 新文件创建：将 unresolvedMap 中指向它的链接解析到 backlinkMap */
export function resolveNewFile(newPath: string): void {
  const stem = newPath.split('/').pop()!
  const keysToCheck = newPath !== stem ? [newPath, stem] : [newPath]
  for (const key of keysToCheck) {
    const sources = vaultStore.unresolvedMap[key] ?? []
    if (sources.length === 0) continue
    setVaultStore('backlinkMap', newPath, (list: string[]) => [...(list ?? []), ...sources])
    setVaultStore('unresolvedMap', key, [])
  }
}
