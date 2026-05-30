import { createRoot, createEffect } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import { get, set } from 'idb-keyval'
import { parseFrontmatter } from '../lib/parseFrontmatter'
import { parseMarkdown } from '../lib/parseMarkdown'
import type { ParseResult } from '../lib/parseMarkdown'
import { hashContent, getCachedMeta, setCachedMeta } from '../services/indexStorage'
import { extractTags, extractAliases, mergeTagsWithBody, extractDateString, extractDateFromName, buildBacklinkMap, buildTagMap, buildTaskMap } from '../lib/knowledgeUtils'
import type { VaultState, FileMeta, TaskItem } from './types'

const [vaultStore, setVaultStore] = createStore<VaultState>({
  files: {},
  backlinkMap: {},
  tagMap: {},
  taskMap: {},
})

export async function initVaultStore(): Promise<void> {
  const saved = await get<{ files: Record<string, FileMeta> }>('vault-files')
  if (!saved?.files) return
  const mdFiles = Object.fromEntries(
    Object.entries(saved.files).filter(([p]) => p.endsWith('.md')),
  )
  setVaultStore(reconcile({
    files: saved.files,
    backlinkMap: buildBacklinkMap(mdFiles),
    tagMap: buildTagMap(mdFiles),
    taskMap: buildTaskMap(mdFiles),
  }))
}

let _saveTimer: ReturnType<typeof setTimeout> | null = null
createRoot(() => {
  createEffect(() => {
    const files = JSON.parse(JSON.stringify(vaultStore.files)) as Record<string, FileMeta>
    if (_saveTimer) clearTimeout(_saveTimer)
    _saveTimer = setTimeout(() => set('vault-files', { files }), 500)
  })
})

// ── Types ─────────────────────────────────────────────────────────────────────

type ContentFields = Pick<FileMeta, 'frontmatter' | 'outLinks' | 'tags' | 'aliases' | 'created' | 'updated' | 'tasks'>

function applyContent(path: string, hash: string, content: ContentFields): void {
  const prev = vaultStore.files[path]

  const filename = path.split('/').at(-1) ?? ''
  const dated = extractDateFromName(filename) ?? content.created
  setVaultStore('files', path, (f: FileMeta) => ({ ...f, hash, dated, ...content }))

  const prevLinks = new Set(prev?.outLinks ?? [])
  const nextLinks = new Set(content.outLinks)
  for (const t of prevLinks) {
    if (!nextLinks.has(t))
      setVaultStore('backlinkMap', t, (list: string[]) => list?.filter(p => p !== path) ?? [])
  }
  for (const t of nextLinks) {
    if (!prevLinks.has(t))
      setVaultStore('backlinkMap', t, (list: string[]) => list ? [...list, path] : [path])
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
  async reindexFile(path: string, content: string, cmParsed?: ParseResult): Promise<void> {
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
    const file = vaultStore.files[path]
    if (!file) return
    const outLinks = file.outLinks.map(l => l === oldTarget ? newTarget : l)
    applyContent(path, file.hash, { ...file, outLinks })
  },

  removeVaultEntry(path: string): void {
    const file = vaultStore.files[path]
    if (!file) return
    for (const t of file.outLinks)
      setVaultStore('backlinkMap', t, (list: string[]) => list?.filter(p => p !== path) ?? [])
    for (const t of file.tags)
      setVaultStore('tagMap', t, (list: string[]) => list?.filter(p => p !== path) ?? [])
    setVaultStore('taskMap', path, undefined as unknown as TaskItem[])
    setVaultStore('files', path, undefined as unknown as FileMeta)
  },
}

export { vaultStore, setVaultStore }
