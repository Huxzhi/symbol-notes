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
  hashContent, getCachedMeta, setCachedMeta, pruneCache,
  readFile, loadAllFileStats, setFileStatEntry, pruneFileStatCache,
} from './fileCacheService'
import {
  extractTags, extractAliases, mergeTagsWithBody, buildBacklinkMap, buildTagMap,
} from '../lib/knowledgeUtils'
import type { FileMapEntry } from '../stores/types'

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

function idle(): Promise<void> {
  return new Promise(resolve => {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => resolve(), { timeout: 500 })
    } else {
      setTimeout(resolve, 0)
    }
  })
}

// ── buildFileMap ──────────────────────────────────────────────────────────────

interface ScanResult {
  fileMap: Record<string, FileMapEntry>
  unchanged: Map<string, string>
  changed: string[]
  activePaths: Set<string>
}

async function buildFileMap(
  dirHandle: FileSystemDirectoryHandle,
  idbStats: Map<string, { size: number; mtime: number; hash: string }>,
  parentPath: string | null = null,
  result: ScanResult = {
    fileMap: {},
    unchanged: new Map(),
    changed: [],
    activePaths: new Set(),
  },
): Promise<ScanResult> {
  for await (const [name, handle] of dirHandle.entries()) {
    if (name.startsWith('.')) continue
    const path = parentPath ? `${parentPath}/${name}` : name

    if (handle.kind === 'directory') {
      result.fileMap[path] = { name, path, kind: 'directory', parent: parentPath }
      await buildFileMap(handle as FileSystemDirectoryHandle, idbStats, path, result)
    } else {
      const file = await (handle as FileSystemFileHandle).getFile()
      const size = file.size
      const mtime = file.lastModified
      result.fileMap[path] = { name, path, kind: 'file', parent: parentPath, size, mtime }
      result.activePaths.add(path)

      const cached = idbStats.get(path)
      if (cached && cached.size === size && cached.mtime === mtime) {
        result.unchanged.set(path, cached.hash)
      } else {
        result.changed.push(path)
      }
    }
  }
  return result
}

// ── Session ───────────────────────────────────────────────────────────────────

interface Session { cancelled: boolean }
let currentSession: Session | null = null

async function runPhase1(
  session: Session,
  unchanged: Map<string, string>,
  changed: string[],
  activeHashes: Set<string>,
): Promise<void> {
  for (const [path, hash] of unchanged) {
    if (session.cancelled) return
    activeHashes.add(hash)
    const cached = await getCachedMeta(hash)
    if (cached && globalStore.knowledge.index[path]) continue
    if (cached) {
      setGlobalStore('knowledge', 'index', path, { path, ...cached })
    } else {
      changed.push(path)
    }
  }

  for (const path of changed) {
    if (session.cancelled) return
    await idle()
    if (session.cancelled) return

    try {
      const content = await readFile(path)
      const hash = hashContent(content)
      activeHashes.add(hash)

      const entry = globalStore.fs.fileMap[path]
      if (entry?.size !== undefined && entry.mtime !== undefined) {
        await setFileStatEntry(path, { size: entry.size, mtime: entry.mtime, hash })
      }

      const cachedMeta = await getCachedMeta(hash)
      if (cachedMeta) {
        setGlobalStore('knowledge', 'index', path, { path, ...cachedMeta })
        continue
      }

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
    } catch { /* individual file errors are non-fatal */ }
  }
}

function runPhase2(): void {
  const backlinkMap = buildBacklinkMap(globalStore.knowledge.index)
  const tagMap = buildTagMap(globalStore.knowledge.index)
  setGlobalStore('knowledge', 'backlinkMap', backlinkMap)
  setGlobalStore('knowledge', 'tagMap', tagMap)
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function scanAndIndex(): Promise<void> {
  if (currentSession) currentSession.cancelled = true
  const session: Session = { cancelled: false }
  currentSession = session

  const { rootHandle } = runtimeStore
  if (!rootHandle) return

  setGlobalStore('knowledge', 'isIndexing', true)

  const idbStats = await loadAllFileStats()
  const { fileMap, unchanged, changed, activePaths } = await buildFileMap(rootHandle, idbStats)

  if (session.cancelled) return
  setGlobalStore('fs', 'fileMap', fileMap)

  const mdUnchanged = new Map<string, string>()
  const mdChanged: string[] = []
  for (const [path, hash] of unchanged) {
    if (path.endsWith('.md')) mdUnchanged.set(path, hash)
  }
  for (const path of changed) {
    if (path.endsWith('.md')) mdChanged.push(path)
  }

  const activeHashes = new Set<string>()
  await runPhase1(session, mdUnchanged, mdChanged, activeHashes)

  if (!session.cancelled) {
    runPhase2()
    pruneFileStatCache(activePaths).catch(() => {})
    pruneCache(activeHashes).catch(() => {})
  }

  if (currentSession === session) {
    setGlobalStore('knowledge', 'isIndexing', false)
  }
}

export async function rescanTree(): Promise<void> {
  const { rootHandle } = runtimeStore
  if (!rootHandle) return
  const idbStats = await loadAllFileStats()
  const { fileMap } = await buildFileMap(rootHandle, idbStats)
  setGlobalStore('fs', 'fileMap', fileMap)
}
