import { createRoot, createEffect } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import { get, set } from 'idb-keyval'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { parseFrontmatter } from '../lib/parseFrontmatter'
import { wikiLinkParser } from '../lib/wikiLinkParser'
import { outLinksField } from '../lib/outLinksField'
import { inlineTagsField } from '../lib/inlineTagsField'
import { hashContent, getCachedMeta, setCachedMeta } from '../services/fileCacheService'
import { extractTags, extractAliases, mergeTagsWithBody } from '../lib/knowledgeUtils'
import type { CacheState, FileMeta } from './types'

const [cacheStore, setCacheStore] = createStore<CacheState>({
  files: {},
  backlinkMap: {},
  tagMap: {},
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

export interface CmParsed { outLinks: string[]; inlineTags: string[] }

type ContentFields = Pick<FileMeta, 'frontmatter' | 'outLinks' | 'tags' | 'aliases'>

// ── Internal helpers ──────────────────────────────────────────────────────────

function parseWithCm6(content: string): CmParsed {
  const state = EditorState.create({
    doc: content,
    extensions: [
      markdown({ extensions: [GFM, wikiLinkParser] }),
      outLinksField,
      inlineTagsField,
    ],
  })
  return {
    outLinks: state.field(outLinksField)
      .filter(l => l.type === 'wiki')
      .map(l => l.target.endsWith('.md') ? l.target : `${l.target}.md`),
    inlineTags: state.field(inlineTagsField).map(m => m.tag),
  }
}

function applyContent(path: string, hash: string, content: ContentFields): void {
  const prev = cacheStore.files[path]

  setCacheStore('files', path, (f: FileMeta) => ({ ...f, hash, ...content }))

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
}

// ── Actions ───────────────────────────────────────────────────────────────────

export const cacheActions = {
  async reindexFile(path: string, content: string, cmParsed?: CmParsed): Promise<void> {
    const hash = hashContent(content)
    const cached = await getCachedMeta(hash)
    let fields: ContentFields
    if (cached) {
      fields = cached
    } else {
      const { frontmatter } = parseFrontmatter(content)
      const { outLinks, inlineTags } = cmParsed ?? parseWithCm6(content)
      fields = {
        frontmatter,
        outLinks,
        tags: mergeTagsWithBody(extractTags(frontmatter.tags), inlineTags),
        aliases: extractAliases(frontmatter.aliases),
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
    setCacheStore('files', path, undefined as unknown as FileMeta)
  },
}

export { cacheStore, setCacheStore }
