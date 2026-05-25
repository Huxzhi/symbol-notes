import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { globalStore, setGlobalStore } from '../stores/globalStore'
import { runtimeStore } from '../stores/runtimeStore'
import { parseFrontmatter } from '../lib/parseFrontmatter'
import { wikiLinkParser } from '../lib/wikiLinkParser'
import { outLinksField } from '../lib/outLinksField'
import { inlineTagsField } from '../lib/inlineTagsField'
import {
  hashContent, getCachedMeta, setCachedMeta, pruneCache, readFile,
} from './fileCacheService'
import {
  extractTags, extractAliases, mergeTagsWithBody, buildBacklinkMap, buildTagMap,
} from '../lib/knowledgeUtils'
import type { FileNode } from '../stores/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function createHeadlessState(content: string): EditorState {
  return EditorState.create({
    doc: content,
    extensions: [
      markdown({ extensions: [GFM, wikiLinkParser] }),
      outLinksField,
      inlineTagsField,
    ],
  })
}

function collectMdPaths(nodes: FileNode[]): string[] {
  const paths: string[] = []
  for (const node of nodes) {
    if (node.kind === 'file' && node.path.endsWith('.md')) paths.push(node.path)
    else if (node.children) paths.push(...collectMdPaths(node.children))
  }
  return paths
}

function idle(): Promise<void> {
  return new Promise(resolve => {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => resolve(), { timeout: 500 })
    } else {
      setTimeout(resolve, 0)
    }
  })
}

// ── Session ───────────────────────────────────────────────────────────────────

interface Session { cancelled: boolean }
let currentSession: Session | null = null

// Phase 1: parse each file's metadata → update knowledge.index[path] progressively
async function runPhase1(
  session: Session,
  paths: string[],
  activeHashes: Set<string>,
): Promise<void> {
  for (const path of paths) {
    if (session.cancelled) return
    await idle()
    if (session.cancelled) return

    try {
      const content = await readFile(path)
      const hash = hashContent(content)
      activeHashes.add(hash)

      const cached = await getCachedMeta(hash)
      if (cached && globalStore.knowledge.index[path]) continue

      const state = createHeadlessState(content)
      const { frontmatter } = parseFrontmatter(content)
      const inlineTags = state.field(inlineTagsField).map(m => m.tag)
      const outLinks = state.field(outLinksField)
        .filter(l => l.type === 'wiki')
        .map(l => l.target.endsWith('.md') ? l.target : `${l.target}.md`)

      const parsed = {
        frontmatter,
        outLinks,
        tags: mergeTagsWithBody(extractTags(frontmatter.tags), inlineTags),
        aliases: extractAliases(frontmatter.aliases),
      }

      await setCachedMeta(hash, parsed)
      setGlobalStore('knowledge', 'index', path, { path, ...parsed })
    } catch {
      // individual file errors are non-fatal
    }
  }
}

// Phase 2: build aggregate views from the completed index
function runPhase2(): void {
  const backlinkMap = buildBacklinkMap(globalStore.knowledge.index)
  const tagMap = buildTagMap(globalStore.knowledge.index)
  setGlobalStore('knowledge', 'backlinkMap', backlinkMap)
  setGlobalStore('knowledge', 'tagMap', tagMap)
}

async function runSession(session: Session, paths: string[]): Promise<void> {
  setGlobalStore('knowledge', 'isIndexing', true)
  const activeHashes = new Set<string>()

  await runPhase1(session, paths, activeHashes)

  if (!session.cancelled) {
    runPhase2()
    pruneCache(activeHashes).catch(() => {})
  }

  if (currentSession === session) {
    setGlobalStore('knowledge', 'isIndexing', false)
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startIndexing(skipPath?: string): void {
  if (currentSession) currentSession.cancelled = true

  const { rootHandle } = runtimeStore
  const { tree } = globalStore.fs
  if (!rootHandle || !tree.length) return

  const paths = collectMdPaths(tree)
  const filtered = skipPath ? paths.filter(p => p !== skipPath) : paths
  if (!filtered.length) return

  const session: Session = { cancelled: false }
  currentSession = session
  runSession(session, filtered).catch(() => {})
}
