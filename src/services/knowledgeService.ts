import { produce } from 'solid-js/store'
import { knowledgeStore, setKnowledgeStore } from '../stores/knowledgeStore'
import { fileSystemStore } from '../stores/fileSystemStore'
import { parseFrontmatter } from '../lib/parseFrontmatter'
import type { FileMetadata } from '../stores/knowledgeStore'
import { hashContent, getCachedMeta, setCachedMeta, pruneCache } from './fileCacheService'

export function extractLinks(content: string): string[] {
  const matches = [...content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)]
  return [...new Set(matches.map(m => {
    const t = m[1].trim()
    return t.endsWith('.md') ? t : `${t}.md`
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

// Inline #tag regex: must not be preceded by non-whitespace, first char non-digit
const BODY_TAG_RE = /(?<!\S)#([a-zA-Z_一-龥][a-zA-Z0-9_一-龥\/-]*)/g

export function extractBodyTags(body: string): string[] {
  // Strip fenced code blocks and inline code before matching
  const stripped = body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]+`/g, '')
  const seen = new Set<string>()
  for (const m of stripped.matchAll(BODY_TAG_RE)) {
    seen.add(m[1])
  }
  return [...seen]
}

function expandEtag(etag: string): string[] {
  const parts = etag.split('/')
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}

// Merge frontmatter tags with Obsidian-style expanded inline body tags
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

async function readAllFiles(
  dirHandle: FileSystemDirectoryHandle,
  path = '',
): Promise<Array<{ path: string; content: string }>> {
  const results: Array<{ path: string; content: string }> = []
  for await (const [name, handle] of dirHandle.entries()) {
    if (name.startsWith('.')) continue
    const nodePath = path ? `${path}/${name}` : name
    if (handle.kind === 'directory') {
      const sub = await readAllFiles(handle as FileSystemDirectoryHandle, nodePath)
      results.push(...sub)
    } else if (name.endsWith('.md')) {
      const file = await (handle as FileSystemFileHandle).getFile()
      results.push({ path: nodePath, content: await file.text() })
    }
  }
  return results
}

export async function scanDirectory(): Promise<void> {
  const { rootHandle } = fileSystemStore
  if (!rootHandle) return
  const files = await readAllFiles(rootHandle)
  const index: Record<string, FileMetadata> = {}

  const activeHashes = new Set<string>()

  await Promise.all(files.map(async ({ path, content }) => {
    const hash = hashContent(content)
    activeHashes.add(hash)

    const cached = await getCachedMeta(hash)
    if (cached) {
      index[path] = { path, ...cached }
      return
    }
    const { frontmatter, body } = parseFrontmatter(content)
    const parsed = {
      frontmatter,
      outLinks: extractLinks(body),
      tags: mergeTagsWithBody(extractTags(frontmatter.tags), extractBodyTags(body)),
      aliases: extractAliases(frontmatter.aliases),
    }
    index[path] = { path, ...parsed }
    await setCachedMeta(hash, parsed)
  }))

  const backlinkMap = buildBacklinkMap(index)
  const tagMap = buildTagMap(index)
  setKnowledgeStore({ index, backlinkMap, tagMap })
  pruneCache(activeHashes).catch(() => {})
}

/**
 * Incremental update of backlinkMap and tagMap for a single file.
 * Diffs old vs new outLinks/tags and only touches affected entries — O(links+tags).
 * Unresolved links (targets not yet in index) are stored as-is; when the target
 * is eventually indexed its backlinks are already present.
 */
export function applyFileMeta(newMeta: FileMetadata, prevMeta?: FileMetadata): void {
  setKnowledgeStore('index', newMeta.path, newMeta)

  const prevLinks = new Set(prevMeta?.outLinks ?? [])
  const nextLinks = new Set(newMeta.outLinks)
  for (const t of prevLinks) {
    if (!nextLinks.has(t))
      setKnowledgeStore('backlinkMap', t, list => list?.filter(p => p !== newMeta.path) ?? [])
  }
  for (const t of nextLinks) {
    if (!prevLinks.has(t))
      setKnowledgeStore('backlinkMap', t, list => list ? [...list, newMeta.path] : [newMeta.path])
  }

  const prevTags = new Set(prevMeta?.tags ?? [])
  const nextTags = new Set(newMeta.tags)
  for (const t of prevTags) {
    if (!nextTags.has(t))
      setKnowledgeStore('tagMap', t, list => list?.filter(p => p !== newMeta.path) ?? [])
  }
  for (const t of nextTags) {
    if (!prevTags.has(t))
      setKnowledgeStore('tagMap', t, list => list ? [...list, newMeta.path] : [newMeta.path])
  }
}

// Remove a file from the knowledge index and clean up backlinkMap/tagMap entries.
export function removeFileMeta(path: string): void {
  const meta = knowledgeStore.index[path]
  if (!meta) return
  for (const t of meta.outLinks) {
    setKnowledgeStore('backlinkMap', t, list => list?.filter(p => p !== path) ?? [])
  }
  for (const t of meta.tags) {
    setKnowledgeStore('tagMap', t, list => list?.filter(p => p !== path) ?? [])
  }
  setKnowledgeStore(produce(s => { delete s.index[path] }))
}

export async function reindexFile(path: string, content: string): Promise<void> {
  const hash = hashContent(content)
  const cached = await getCachedMeta(hash)
  let parsed: Omit<FileMetadata, 'path'>

  if (cached) {
    parsed = cached
  } else {
    const { frontmatter, body } = parseFrontmatter(content)
    parsed = {
      frontmatter,
      outLinks: extractLinks(body),
      tags: mergeTagsWithBody(extractTags(frontmatter.tags), extractBodyTags(body)),
      aliases: extractAliases(frontmatter.aliases),
    }
    await setCachedMeta(hash, parsed)
  }

  applyFileMeta({ path, ...parsed }, knowledgeStore.index[path])
}
