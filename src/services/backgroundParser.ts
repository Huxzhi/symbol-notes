import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { wikiLinkParser } from '../lib/wikiLinkParser'
import { outLinksField } from '../lib/outLinksField'
import { inlineTagsField } from '../lib/inlineTagsField'
import { parseFrontmatter } from '../lib/parseFrontmatter'
import { globalStore, setGlobalStore } from '../stores/globalStore'
import { runtimeStore } from '../stores/runtimeStore'
import { knowledgeActions } from '../actions/knowledgeActions'
import { hashContent, getCachedMeta, setCachedMeta } from './fileCacheService'
import { extractTags, extractAliases, mergeTagsWithBody } from '../lib/knowledgeUtils'
import type { FileNode } from '../stores/types'

interface Session {
  cancelled: boolean
}

let currentSession: Session | null = null

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
  setGlobalStore('knowledge', 'isIndexing', true)
  for (const path of paths) {
    if (session.cancelled) break
    await idle()
    if (session.cancelled) break

    try {
      const content = await readContent(path, rootHandle)
      const hash = hashContent(content)

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

      knowledgeActions._applyFileMeta({ path, ...parsed }, globalStore.knowledge.index[path])
    } catch {
      // Individual file errors are non-fatal
    }
  }
  if (currentSession === session) {
    setGlobalStore('knowledge', 'isIndexing', false)
  }
}

export function startBackgroundParsing(skipPath: string): void {
  if (currentSession) currentSession.cancelled = true

  const { rootHandle } = runtimeStore
  const { tree } = globalStore.fs
  if (!rootHandle || !tree.length) return

  const paths = collectFilePaths(tree).filter(p => p !== skipPath)
  if (!paths.length) return

  const session: Session = { cancelled: false }
  currentSession = session
  runSession(session, rootHandle, paths).catch(() => {})
}
