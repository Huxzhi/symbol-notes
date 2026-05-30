import { createRoot, createEffect } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import { get, set } from 'idb-keyval'
import { parseFrontmatter } from '../lib/parseFrontmatter'
import { parseMarkdown } from '../lib/parseMarkdown'
import type { ParseResult } from '../lib/parseMarkdown'
import { hashContent, getCachedMeta, setCachedMeta } from '../services/fileCacheService'
import { extractTags, extractAliases, mergeTagsWithBody, extractDateString, extractDateFromName } from '../lib/knowledgeUtils'
import type { CacheState, FileMeta, TaskItem } from './types'

const [cacheStore, setCacheStore] = createStore<CacheState>({
  files: {},
  backlinkMap: {},
  tagMap: {},
  taskMap: {},
})

export async function initCacheStore(): Promise<void> {
  const saved = await get<CacheState>('sn-cache')
  if (saved) setCacheStore(reconcile(saved))
}

let _saveTimer: ReturnType<typeof setTimeout> | null = null
createRoot(() => {
  createEffect(() => {
    const snapshot = JSON.parse(JSON.stringify(cacheStore)) as CacheState
    if (_saveTimer) clearTimeout(_saveTimer)
    _saveTimer = setTimeout(() => set('sn-cache', snapshot), 500)
  })
})

// ── Types ─────────────────────────────────────────────────────────────────────

type ContentFields = Pick<FileMeta, 'frontmatter' | 'outLinks' | 'tags' | 'aliases' | 'created' | 'updated' | 'tasks'>

function applyContent(path: string, hash: string, content: ContentFields): void {
  const prev = cacheStore.files[path]

  const filename = path.split('/').at(-1) ?? ''
  const dated = extractDateFromName(filename) ?? content.created
  setCacheStore('files', path, (f: FileMeta) => ({ ...f, hash, dated, ...content }))

  const prevLinks = new Set(prev?.outLinks ?? [])
  const nextLinks = new Set(content.outLinks)
  for (const t of prevLinks) {
    if (!nextLinks.has(t))
      setCacheStore('backlinkMap', t, (list: string[]) => list?.filter(p => p !== path) ?? [])
  }
  for (const t of nextLinks) {
    if (!prevLinks.has(t))
      setCacheStore('backlinkMap', t, (list: string[]) => list ? [...list, path] : [path])
  }

  const prevTags = new Set(prev?.tags ?? [])
  const nextTags = new Set(content.tags)
  for (const t of prevTags) {
    if (!nextTags.has(t))
      setCacheStore('tagMap', t, (list: string[]) => list?.filter(p => p !== path) ?? [])
  }
  for (const t of nextTags) {
    if (!prevTags.has(t))
      setCacheStore('tagMap', t, (list: string[]) => list ? [...list, path] : [path])
  }

  setCacheStore('taskMap', path, content.tasks ?? [])
}

// ── Actions ───────────────────────────────────────────────────────────────────

export const cacheActions = {
  async reindexFile(path: string, content: string, cmParsed?: ParseResult): Promise<void> {
    const hash = hashContent(content)
    const cached = await getCachedMeta(hash)
    let fields: ContentFields
    if (cached) {
      fields = cached
    } else {
      const { frontmatter } = parseFrontmatter(content)
      const { outLinks, inlineTags, tasks: rawTasks } = cmParsed ?? parseMarkdown(content)
      const existingMtime = cacheStore.files[path]?.mtime ?? Date.now()
      const created = extractDateString(frontmatter.created)
                   ?? new Date(existingMtime).toISOString().slice(0, 10)
      const updated = extractDateString(frontmatter.updated) ?? null
      const filename = path.split('/').at(-1) ?? ''
      const dated = extractDateFromName(filename) ?? created
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
        tasks,
      }
      await setCachedMeta(hash, fields)
    }
    applyContent(path, hash, fields)
  },

  remapFileLink(path: string, oldTarget: string, newTarget: string): void {
    const file = cacheStore.files[path]
    if (!file) return
    const outLinks = file.outLinks.map(l => l === oldTarget ? newTarget : l)
    applyContent(path, file.hash, { ...file, outLinks })
  },

  removeCacheEntry(path: string): void {
    const file = cacheStore.files[path]
    if (!file) return
    for (const t of file.outLinks)
      setCacheStore('backlinkMap', t, (list: string[]) => list?.filter(p => p !== path) ?? [])
    for (const t of file.tags)
      setCacheStore('tagMap', t, (list: string[]) => list?.filter(p => p !== path) ?? [])
    setCacheStore('taskMap', path, undefined as unknown as TaskItem[])
    setCacheStore('files', path, undefined as unknown as FileMeta)
  },
}

export { cacheStore, setCacheStore }
