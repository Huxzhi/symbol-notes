import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { globalStore, setGlobalStore } from '../stores/globalStore'
import { parseFrontmatter } from '../lib/parseFrontmatter'
import { wikiLinkParser } from '../lib/wikiLinkParser'
import { outLinksField } from '../lib/outLinksField'
import { inlineTagsField } from '../lib/inlineTagsField'
import { hashContent, getCachedMeta, setCachedMeta } from '../services/fileCacheService'
import { extractTags, extractAliases, mergeTagsWithBody } from '../lib/knowledgeUtils'
import type { FileMeta } from '../stores/types'

export interface CmParsed { outLinks: string[]; inlineTags: string[] }

type ContentFields = Pick<FileMeta, 'frontmatter' | 'outLinks' | 'tags' | 'aliases'>

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
  const prev = globalStore.cache.files[path]

  setGlobalStore('cache', 'files', path, (f: FileMeta) => ({
    ...f, hash, ...content,
  }))

  const prevLinks = new Set(prev?.outLinks ?? [])
  const nextLinks = new Set(content.outLinks)
  for (const t of prevLinks) {
    if (!nextLinks.has(t))
      setGlobalStore('cache', 'backlinkMap', t, list => list?.filter(p => p !== path) ?? [])
  }
  for (const t of nextLinks) {
    if (!prevLinks.has(t))
      setGlobalStore('cache', 'backlinkMap', t, list => list ? [...list, path] : [path])
  }

  const prevTags = new Set(prev?.tags ?? [])
  const nextTags = new Set(content.tags)
  for (const t of prevTags) {
    if (!nextTags.has(t))
      setGlobalStore('cache', 'tagMap', t, list => list?.filter(p => p !== path) ?? [])
  }
  for (const t of nextTags) {
    if (!prevTags.has(t))
      setGlobalStore('cache', 'tagMap', t, list => list ? [...list, path] : [path])
  }
}

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
    const file = globalStore.cache.files[path]
    if (!file) return
    const outLinks = file.outLinks.map(l => l === oldTarget ? newTarget : l)
    applyContent(path, file.hash, { ...file, outLinks })
  },

  removeCacheEntry(path: string): void {
    const file = globalStore.cache.files[path]
    if (!file) return
    for (const t of file.outLinks) {
      setGlobalStore('cache', 'backlinkMap', t, list => list?.filter(p => p !== path) ?? [])
    }
    for (const t of file.tags) {
      setGlobalStore('cache', 'tagMap', t, list => list?.filter(p => p !== path) ?? [])
    }
    setGlobalStore('cache', 'files', path, undefined as unknown as FileMeta)
  },
}
