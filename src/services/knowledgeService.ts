import { knowledgeStore, setKnowledgeStore } from '../stores/knowledgeStore'
import { fileSystemStore } from '../stores/fileSystemStore'
import { parseFrontmatter } from '../lib/parseFrontmatter'
import type { FileMetadata } from '../stores/knowledgeStore'

export function extractLinks(content: string): string[] {
  const matches = [...content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)]
  return [...new Set(matches.map(m => m[1].trim()))]
}

export function extractTags(raw: unknown): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === 'string') return raw.split(',').map(s => s.trim()).filter(Boolean)
  return []
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

function buildTagMap(
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
  for (const { path, content } of files) {
    const { frontmatter, body } = parseFrontmatter(content)
    index[path] = {
      path,
      frontmatter,
      outLinks: extractLinks(body),
      tags: extractTags(frontmatter.tags),
    }
  }
  const backlinkMap = buildBacklinkMap(index)
  const tagMap = buildTagMap(index)
  setKnowledgeStore({ index, backlinkMap, tagMap })
}

export async function reindexFile(path: string, content: string): Promise<void> {
  const { frontmatter, body } = parseFrontmatter(content)
  const meta: FileMetadata = {
    path,
    frontmatter,
    outLinks: extractLinks(body),
    tags: extractTags(frontmatter.tags),
  }
  const newIndex = { ...knowledgeStore.index, [path]: meta }
  setKnowledgeStore('index', path, meta)
  setKnowledgeStore('backlinkMap', buildBacklinkMap(newIndex))
  setKnowledgeStore('tagMap', buildTagMap(newIndex))
}
