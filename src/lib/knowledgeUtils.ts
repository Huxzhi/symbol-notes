import type { FileMetadata } from '../stores/types'

export function extractLinks(content: string): string[] {
  const matches = [...content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)]
  return [...new Set(matches.map(m => {
    const t = m[1].trim()
    const stem = t.split('/').pop()!
    return stem.includes('.') ? t : `${t}.md`
  }))]
}

export function extractTags(raw: unknown): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === 'string') return raw.split(',').map(s => s.trim()).filter(Boolean)
  return []
}

export function extractAliases(raw: unknown): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean)
  if (typeof raw === 'string') return raw.split(',').map(s => s.trim()).filter(Boolean)
  return []
}

const BODY_TAG_RE = /(?<!\S)#([a-zA-Z_一-龥][a-zA-Z0-9_一-龥\/-]*)/g

export function extractBodyTags(body: string): string[] {
  const stripped = body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]+`/g, '')
  const seen = new Set<string>()
  for (const m of stripped.matchAll(BODY_TAG_RE)) seen.add(m[1])
  return [...seen]
}

function expandEtag(etag: string): string[] {
  const parts = etag.split('/')
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}

export function mergeTagsWithBody(fmTags: string[], bodyEtags: string[]): string[] {
  const set = new Set(fmTags)
  for (const etag of bodyEtags) {
    for (const t of expandEtag(etag)) set.add(t)
  }
  return [...set]
}

export function buildBacklinkMap(
  index: Record<string, FileMetadata>,
): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  for (const path of Object.keys(index)) {
    if (!map[path]) map[path] = []
  }
  for (const [path, meta] of Object.entries(index)) {
    for (const link of meta.outLinks) {
      if (!map[link]) map[link] = []
      if (!map[link].includes(path)) map[link].push(path)
    }
  }
  return map
}

export function buildTagMap(
  index: Record<string, FileMetadata>,
): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  for (const [path, meta] of Object.entries(index)) {
    for (const tag of meta.tags) {
      if (!map[tag]) map[tag] = []
      map[tag].push(path)
    }
  }
  return map
}
