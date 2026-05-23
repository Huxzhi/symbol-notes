import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { wikiLinkParser } from '../lib/wikiLinkParser'
import { outLinksField } from '../lib/outLinksField'
import { inlineTagsField } from '../lib/inlineTagsField'
import { parseFrontmatter } from '../lib/parseFrontmatter'
import { fileSystemStore } from '../stores/fileSystemStore'
import { knowledgeStore } from '../stores/knowledgeStore'
import { getCachedMeta, setCachedMeta } from './fileCacheService'
import { extractTags, extractAliases, mergeTagsWithBody, applyFileMeta } from './knowledgeService'
import type { FileNode } from '../stores/fileSystemStore'

interface Session {
  cancelled: boolean
}

let currentSession: Session | null = null

// Headless CM6: language + data fields only, no view-dependent extensions
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

function collectFilePaths(nodes: FileNode[]): string[] {
  const paths: string[] = []
  for (const node of nodes) {
    if (node.kind === 'file') paths.push(node.path)
    else if (node.children) paths.push(...collectFilePaths(node.children))
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

async function readContent(
  path: string,
  rootHandle: FileSystemDirectoryHandle,
): Promise<string> {
  const parts = path.split('/')
  let dir: FileSystemDirectoryHandle = rootHandle
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i])
  }
  return (await (await dir.getFileHandle(parts[parts.length - 1])).getFile()).text()
}

async function runSession(
  session: Session,
  rootHandle: FileSystemDirectoryHandle,
  paths: string[],
): Promise<void> {
  for (const path of paths) {
    if (session.cancelled) return
    await idle()
    if (session.cancelled) return

    try {
      const content = await readContent(path, rootHandle)

      // Cache hit + already indexed → nothing to do
      const cached = await getCachedMeta(path, content)
      if (cached && knowledgeStore.index[path]) continue

      // Parse with headless CM6
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

      await setCachedMeta(path, content, parsed)

      // Incremental update — no full rebuild, backlinkMap grows file-by-file
      applyFileMeta({ path, ...parsed }, knowledgeStore.index[path])
    } catch {
      // Individual file errors are non-fatal
    }
  }
}

export function startBackgroundParsing(skipPath: string): void {
  if (currentSession) currentSession.cancelled = true

  const { rootHandle, tree } = fileSystemStore
  if (!rootHandle || !tree.length) return

  const paths = collectFilePaths(tree).filter(p => p !== skipPath)
  if (!paths.length) return

  const session: Session = { cancelled: false }
  currentSession = session
  runSession(session, rootHandle, paths).catch(() => {})
}
