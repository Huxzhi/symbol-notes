import { createSignal } from 'solid-js'
import { createStore } from 'solid-js/store'
import type { FileSystemAdapter } from '../services/fs/types'

const [_vaultFs, setVaultFs] = createSignal<FileSystemAdapter | null>(null)
export const vaultFs = _vaultFs
export { setVaultFs }
import { parseFrontmatter } from '../lib/parseFrontmatter'
import { parseMarkdown } from '../lib/parseMarkdown'
import type { ParseResult } from '../lib/parseMarkdown'
import { hashContent, getCachedMeta, setCachedMeta, setFileStatEntry } from '../services/indexStorage'
import { extractTags, extractAliases, mergeTagsWithBody, extractDateString, buildStemIndex, resolveLink } from '../lib/knowledgeUtils'
import type { VaultState, FileMeta, TaskItem } from './types'

const [vaultStore, setVaultStore] = createStore<VaultState>({
  files: {},
  backlinkMap: {},
  unresolvedMap: {},
  tagMap: {},
  taskMap: {},
})

// ── Types ─────────────────────────────────────────────────────────────────────

type ContentFields = Pick<FileMeta, 'frontmatter' | 'outLinks' | 'tags' | 'aliases' | 'created' | 'updated' | 'dated' | 'tasks'>

let _stemIndex: Map<string, string[]> | null = null

export function invalidateStemIndex(): void {
  _stemIndex = null
}

export function getStemIndex(): Map<string, string[]> {
  if (!_stemIndex) _stemIndex = buildStemIndex(vaultStore.files)
  return _stemIndex
}

function applyContent(path: string, hash: string, content: ContentFields): void {
  const prev = vaultStore.files[path]
  setVaultStore('files', path, (f: FileMeta) => ({ ...f, hash, ...content }))

  const stemIndex = getStemIndex()

  const prevLinks = new Set(prev?.outLinks ?? [])
  const nextLinks = new Set(content.outLinks)
  for (const t of prevLinks) {
    if (!nextLinks.has(t)) {
      const resolved = resolveLink(t, stemIndex, vaultStore.files)
      if (resolved)
        setVaultStore('backlinkMap', resolved, (list: string[]) => list?.filter(p => p !== path) ?? [])
      else
        setVaultStore('unresolvedMap', t, (list: string[]) => list?.filter(p => p !== path) ?? [])
    }
  }
  for (const t of nextLinks) {
    if (!prevLinks.has(t)) {
      const resolved = resolveLink(t, stemIndex, vaultStore.files)
      if (resolved)
        setVaultStore('backlinkMap', resolved, (list: string[]) => list ? [...list, path] : [path])
      else
        setVaultStore('unresolvedMap', t, (list: string[]) => list ? [...list, path] : [path])
    }
  }

  const prevTags = new Set(prev?.tags ?? [])
  const nextTags = new Set(content.tags)
  for (const t of prevTags) {
    if (!nextTags.has(t))
      setVaultStore('tagMap', t, (list: string[]) => list?.filter(p => p !== path) ?? [])
  }
  for (const t of nextTags) {
    if (!prevTags.has(t))
      setVaultStore('tagMap', t, (list: string[]) => list ? [...list, path] : [path])
  }

  setVaultStore('taskMap', path, content.tasks ?? [])
}

// ── Actions ───────────────────────────────────────────────────────────────────

export const vaultActions = {
  async reindexFile(path: string, content: string, cmParsed?: ParseResult, persistStat = false): Promise<void> {
    const hash = hashContent(content)
    const cached = await getCachedMeta(hash)
    let fields: ContentFields
    if (cached) {
      fields = cached
    } else {
      const { frontmatter } = parseFrontmatter(content)
      const { outLinks, inlineTags, tasks: rawTasks } = cmParsed ?? parseMarkdown(content)
      const existingMtime = vaultStore.files[path]?.mtime ?? Date.now()
      const created = extractDateString(frontmatter.created)
                   ?? new Date(existingMtime).toISOString().slice(0, 10)
      const updated = extractDateString(frontmatter.updated) ?? null
      const filename = path.split('/').at(-1) ?? ''
      const dated = extractDateString(frontmatter.dated) ?? created
      const tasks: TaskItem[] = rawTasks.map(t => ({
        ...t,
        dueDate: t.dueDate ?? dated,
        completedDate: t.checked ? (t.completedDate ?? dated) : null,
      }))
      fields = {
        frontmatter,
        outLinks,
        tags: mergeTagsWithBody(extractTags(frontmatter.tags), inlineTags),
        aliases: extractAliases(frontmatter.aliases),
        created,
        updated,
        dated,
        tasks,
      }
      await setCachedMeta(hash, fields)
    }
    applyContent(path, hash, fields)
    if (persistStat) {
      const entry = vaultStore.files[path]
      if (entry?.kind === 'file') {
        await setFileStatEntry(path, { size: entry.size, mtime: entry.mtime, hash })
      }
    }
  },

  remapFileLink(path: string, oldTarget: string, newTarget: string): void {
    const file = vaultStore.files[path]
    if (!file) return
    const outLinks = file.outLinks.map(l => l === oldTarget ? newTarget : l)
    applyContent(path, file.hash, { ...file, outLinks })
  },

  removeVaultEntry(path: string): void {
    const file = vaultStore.files[path]
    if (!file) return

    // Move all files that linked TO this path into unresolvedMap
    const backlinks = vaultStore.backlinkMap[path] ?? []
    if (backlinks.length > 0) {
      setVaultStore('unresolvedMap', path, (list: string[]) => [...(list ?? []), ...backlinks])
      setVaultStore('backlinkMap', path, [])
    }

    // Remove this file's own outLinks from backlinkMap/unresolvedMap
    const stemIndex = getStemIndex()
    for (const t of file.outLinks) {
      const resolved = resolveLink(t, stemIndex, vaultStore.files)
      if (resolved)
        setVaultStore('backlinkMap', resolved, (list: string[]) => list?.filter(p => p !== path) ?? [])
      else
        setVaultStore('unresolvedMap', t, (list: string[]) => list?.filter(p => p !== path) ?? [])
    }

    for (const t of file.tags)
      setVaultStore('tagMap', t, (list: string[]) => list?.filter(p => p !== path) ?? [])
    setVaultStore('taskMap', path, undefined as unknown as TaskItem[])
    setVaultStore('files', path, undefined as unknown as FileMeta)
    invalidateStemIndex()
  },
}

export { vaultStore, setVaultStore }
