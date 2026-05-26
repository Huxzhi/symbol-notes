import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { globalStore, setGlobalStore } from '../stores/globalStore'
import { runtimeStore, setRuntimeStore } from '../stores/runtimeStore'
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
import type { FileMeta } from '../stores/types'

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

// ── Scan ──────────────────────────────────────────────────────────────────────

interface ScanResult {
  files: Record<string, FileMeta>
  unchanged: Map<string, string>  // path → hash (stat matched IDB)
  changed: string[]               // paths needing content read
  activePaths: Set<string>
}

const EMPTY_CONTENT: Pick<FileMeta, 'frontmatter' | 'outLinks' | 'tags' | 'aliases'> = {
  frontmatter: {},
  outLinks: [],
  tags: [],
  aliases: [],
}

async function buildScan(
  dirHandle: FileSystemDirectoryHandle,
  idbStats: Map<string, { size: number; mtime: number; hash: string }>,
  parentPath: string | null = null,
  result: ScanResult = { files: {}, unchanged: new Map(), changed: [], activePaths: new Set() },
): Promise<ScanResult> {
  for await (const [name, handle] of dirHandle.entries()) {
    if (name.startsWith('.')) continue
    const path = parentPath ? `${parentPath}/${name}` : name

    if (handle.kind === 'directory') {
      result.files[path] = { name, path, kind: 'directory', parent: parentPath, size: 0, mtime: 0, hash: '', ...EMPTY_CONTENT }
      await buildScan(handle as FileSystemDirectoryHandle, idbStats, path, result)
    } else {
      const file = await (handle as FileSystemFileHandle).getFile()
      const size = file.size
      const mtime = file.lastModified
      result.files[path] = { name, path, kind: 'file', parent: parentPath, size, mtime, hash: '', ...EMPTY_CONTENT }
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

// ── Index phases ──────────────────────────────────────────────────────────────

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
    if (cached && globalStore.cache.files[path]?.hash === hash) continue
    if (cached) {
      setGlobalStore('cache', 'files', path, (f: FileMeta) => ({ ...f, hash, ...cached }))
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

      const entry = globalStore.cache.files[path]
      if (entry?.size !== undefined && entry.mtime !== undefined) {
        await setFileStatEntry(path, { size: entry.size, mtime: entry.mtime, hash })
      }

      const cachedMeta = await getCachedMeta(hash)
      if (cachedMeta) {
        setGlobalStore('cache', 'files', path, (f: FileMeta) => ({ ...f, hash, ...cachedMeta }))
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
      setGlobalStore('cache', 'files', path, (f: FileMeta) => ({ ...f, hash, ...parsed }))
    } catch { /* individual file errors are non-fatal */ }
  }
}

function runPhase2(): void {
  const mdFiles = Object.fromEntries(
    Object.entries(globalStore.cache.files).filter(([p]) => p.endsWith('.md')),
  )
  setGlobalStore('cache', 'backlinkMap', buildBacklinkMap(mdFiles))
  setGlobalStore('cache', 'tagMap', buildTagMap(mdFiles))
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function scanAndIndex(): Promise<void> {
  if (currentSession) currentSession.cancelled = true
  const session: Session = { cancelled: false }
  currentSession = session

  const { rootHandle } = runtimeStore
  if (!rootHandle) return

  setRuntimeStore('isIndexing', true)

  const idbStats = await loadAllFileStats()
  const { files, unchanged, changed, activePaths } = await buildScan(rootHandle, idbStats)

  if (session.cancelled) return
  setGlobalStore('cache', 'files', files)

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
    setRuntimeStore('isIndexing', false)
  }
}

export async function rescanTree(): Promise<void> {
  const { rootHandle } = runtimeStore
  if (!rootHandle) return
  const idbStats = await loadAllFileStats()
  const { files } = await buildScan(rootHandle, idbStats)
  setGlobalStore('cache', 'files', files)
}
