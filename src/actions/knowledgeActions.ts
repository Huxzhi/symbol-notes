import { produce } from 'solid-js/store'
import { globalStore, setGlobalStore } from '../stores/globalStore'
import { runtimeStore } from '../stores/runtimeStore'
import { parseFrontmatter } from '../lib/parseFrontmatter'
import { hashContent, getCachedMeta, setCachedMeta, pruneCache } from '../services/fileCacheService'
import {
  extractLinks,
  extractTags,
  extractAliases,
  extractBodyTags,
  mergeTagsWithBody,
  buildBacklinkMap,
  buildTagMap,
} from '../lib/knowledgeUtils'
import type { FileMetadata } from '../stores/types'

async function readAllFiles(
  dirHandle: FileSystemDirectoryHandle,
  path = '',
): Promise<Array<{ path: string; content: string | null }>> {
  const results: Array<{ path: string; content: string | null }> = []
  for await (const [name, handle] of dirHandle.entries()) {
    if (name.startsWith('.')) continue
    const nodePath = path ? `${path}/${name}` : name
    if (handle.kind === 'directory') {
      const sub = await readAllFiles(handle as FileSystemDirectoryHandle, nodePath)
      results.push(...sub)
    } else if (name.endsWith('.md')) {
      const file = await (handle as FileSystemFileHandle).getFile()
      results.push({ path: nodePath, content: await file.text() })
    } else {
      results.push({ path: nodePath, content: null })
    }
  }
  return results
}

export const knowledgeActions = {
  async scanDirectory(): Promise<void> {
    const { rootHandle } = runtimeStore
    if (!rootHandle) return
    const files = await readAllFiles(rootHandle)
    const index: Record<string, FileMetadata> = {}
    const activeHashes = new Set<string>()

    await Promise.all(files.map(async ({ path, content }) => {
      if (content === null) {
        index[path] = { path, frontmatter: {}, outLinks: [], tags: [], aliases: [] }
        return
      }
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
    setGlobalStore('knowledge', { index, backlinkMap, tagMap })
    pruneCache(activeHashes).catch(() => {})
  },

  async reindexFile(path: string, content: string): Promise<void> {
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
    knowledgeActions._applyFileMeta({ path, ...parsed }, globalStore.knowledge.index[path])
  },

  _applyFileMeta(newMeta: FileMetadata, prevMeta?: FileMetadata): void {
    setGlobalStore('knowledge', 'index', newMeta.path, newMeta)

    const prevLinks = new Set(prevMeta?.outLinks ?? [])
    const nextLinks = new Set(newMeta.outLinks)
    for (const t of prevLinks) {
      if (!nextLinks.has(t))
        setGlobalStore('knowledge', 'backlinkMap', t, list => list?.filter(p => p !== newMeta.path) ?? [])
    }
    for (const t of nextLinks) {
      if (!prevLinks.has(t))
        setGlobalStore('knowledge', 'backlinkMap', t, list => list ? [...list, newMeta.path] : [newMeta.path])
    }

    const prevTags = new Set(prevMeta?.tags ?? [])
    const nextTags = new Set(newMeta.tags)
    for (const t of prevTags) {
      if (!nextTags.has(t))
        setGlobalStore('knowledge', 'tagMap', t, list => list?.filter(p => p !== newMeta.path) ?? [])
    }
    for (const t of nextTags) {
      if (!prevTags.has(t))
        setGlobalStore('knowledge', 'tagMap', t, list => list ? [...list, newMeta.path] : [newMeta.path])
    }
  },

  removeFileMeta(path: string): void {
    const meta = globalStore.knowledge.index[path]
    if (!meta) return
    for (const t of meta.outLinks) {
      setGlobalStore('knowledge', 'backlinkMap', t, list => list?.filter(p => p !== path) ?? [])
    }
    for (const t of meta.tags) {
      setGlobalStore('knowledge', 'tagMap', t, list => list?.filter(p => p !== path) ?? [])
    }
    setGlobalStore('knowledge', produce(s => { delete s.index[path] }))
  },
}
