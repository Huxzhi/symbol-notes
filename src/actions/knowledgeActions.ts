import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { produce } from 'solid-js/store'
import { globalStore, setGlobalStore } from '../stores/globalStore'
import { parseFrontmatter } from '../lib/parseFrontmatter'
import { wikiLinkParser } from '../lib/wikiLinkParser'
import { outLinksField } from '../lib/outLinksField'
import { inlineTagsField } from '../lib/inlineTagsField'
import { hashContent, getCachedMeta, setCachedMeta } from '../services/fileCacheService'
import { extractTags, extractAliases, mergeTagsWithBody } from '../lib/knowledgeUtils'
import type { FileMetadata } from '../stores/types'

// Pre-parsed CM6 fields — pass from EditorPane to skip redundant headless parse
export interface CmParsed { outLinks: string[]; inlineTags: string[] }

// ── Internal ──────────────────────────────────────────────────────────────────

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

export function applyFileMeta(newMeta: FileMetadata, prevMeta?: FileMetadata): void {
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
}

// ── Public API ────────────────────────────────────────────────────────────────

export const knowledgeActions = {
  // cmParsed: pass from EditorPane (reuses the live CM6 state).
  // Omit when only content is available (fsActions): falls back to headless CM6.
  async reindexFile(path: string, content: string, cmParsed?: CmParsed): Promise<void> {
    const hash = hashContent(content)
    const cached = await getCachedMeta(hash)
    let parsed: Omit<FileMetadata, 'path'>
    if (cached) {
      parsed = cached
    } else {
      const { frontmatter } = parseFrontmatter(content)
      const { outLinks, inlineTags } = cmParsed ?? parseWithCm6(content)
      parsed = {
        frontmatter,
        outLinks,
        tags: mergeTagsWithBody(extractTags(frontmatter.tags), inlineTags),
        aliases: extractAliases(frontmatter.aliases),
      }
      await setCachedMeta(hash, parsed)
    }
    applyFileMeta({ path, ...parsed }, globalStore.knowledge.index[path])
  },

  // Called by fsActions.renameFile for each file that links to the renamed path.
  // Avoids a full CM6 re-parse: we know the only change is one outLink target.
  remapFileLink(path: string, oldTarget: string, newTarget: string): void {
    const meta = globalStore.knowledge.index[path]
    if (!meta) return
    const newOutLinks = meta.outLinks.map(l => l === oldTarget ? newTarget : l)
    applyFileMeta({ ...meta, outLinks: newOutLinks }, meta)
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
