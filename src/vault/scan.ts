import { createSignal } from 'solid-js'
import { vaultStore, setVaultStore } from './state'
import { parseFrontmatter } from '../lib/parseFrontmatter'
import { createMarkdownParser } from '../lib/parseMarkdown'
import { readFile, listAll, isReady } from './io'
import {
  hashContent, getCachedMeta, setCachedMeta, getManyMeta, pruneCache,
  loadAllFileStats, setFileStatEntry, pruneFileStatCache,
} from '../services/indexStorage'
import {
  extractTags, extractAliases, mergeTagsWithBody, buildLinkMaps, buildTagMap,
  extractDateString, extractDateFromName, buildTaskMap,
} from '../lib/knowledgeUtils'
import type { FileMeta, TaskItem } from '../stores/types'

export const [isIndexing, setIsIndexing] = createSignal(false)

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  activePaths: Set<string>
}

const EMPTY_CONTENT: Pick<FileMeta, 'frontmatter' | 'outLinks' | 'tags' | 'aliases' | 'updated' | 'tasks'> = {
  frontmatter: {},
  outLinks: [],
  tags: [],
  aliases: [],
  updated: null,
  tasks: [],
}

async function buildScan(): Promise<ScanResult> {
  const result: ScanResult = { files: {}, activePaths: new Set() }
  const epoch = new Date(0).toISOString().slice(0, 10)
  for await (const entry of listAll()) {
    const { name, path, kind, parent, size, mtime } = entry
    if (kind === 'directory') {
      result.files[path] = {
        name, path, kind: 'directory', parent, size: 0, mtime: 0, hash: '',
        ...EMPTY_CONTENT,
        created: epoch,
        dated: extractDateFromName(name) ?? epoch,
      }
    } else {
      const mtimeStr = new Date(mtime).toISOString().slice(0, 10)
      result.files[path] = {
        name, path, kind: 'file', parent, size, mtime, hash: '',
        ...EMPTY_CONTENT,
        created: mtimeStr,
        dated: extractDateFromName(name) ?? mtimeStr,
      }
      result.activePaths.add(path)
    }
  }
  return result
}

// ── Index phases ──────────────────────────────────────────────────────────────

interface Session { cancelled: boolean }
let currentSession: Session | null = null

async function runPhase1(
  session: Session,
  unchanged: string[],
  changed: string[],
  activeHashes: Set<string>,
): Promise<void> {
  const parser = createMarkdownParser()
  const hashes = unchanged.map(p => vaultStore.files[p]?.hash ?? '')
  hashes.forEach(h => { if (h) activeHashes.add(h) })

  const metas = await getManyMeta(hashes)
  for (let i = 0; i < unchanged.length; i++) {
    if (session.cancelled) return
    const path = unchanged[i]
    const hash = hashes[i]
    if (!hash) continue
    const meta = metas[i]
    if (meta) {
      setVaultStore('files', path, (f: FileMeta) => ({ ...f, hash, ...meta }))
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

      const entry = vaultStore.files[path]
      if (entry) {
        await setFileStatEntry(path, { size: entry.size, mtime: entry.mtime, hash })
      }

      const cachedMeta = await getCachedMeta(hash)
      if (cachedMeta) {
        setVaultStore('files', path, (f: FileMeta) => ({ ...f, hash, ...cachedMeta }))
        continue
      }

      const { frontmatter } = parseFrontmatter(content)
      const { outLinks, inlineTags, tasks: rawTaskItems } = parser.parse(content)

      const created = extractDateString(frontmatter.created)
                   ?? new Date(entry.mtime).toISOString().slice(0, 10)
      const updated = extractDateString(frontmatter.updated) ?? null
      const filename = path.split('/').at(-1) ?? ''
      const dated = extractDateString(frontmatter.dated) ?? created

      const tasks: TaskItem[] = rawTaskItems.map(t => ({
        ...t,
        dueDate: t.dueDate ?? dated,
        completedDate: t.checked ? (t.completedDate ?? dated) : null,
      }))

      const parsed = {
        frontmatter,
        outLinks,
        tags: mergeTagsWithBody(extractTags(frontmatter.tags), inlineTags),
        aliases: extractAliases(frontmatter.aliases),
        created,
        updated,
        dated,
        tasks,
      }
      await setCachedMeta(hash, parsed)
      setVaultStore('files', path, (f: FileMeta) => ({ ...f, hash, ...parsed }))
    } catch { /* individual file errors are non-fatal */ }
  }
}

function runPhase2(): void {
  const mdFiles = Object.fromEntries(
    Object.entries(vaultStore.files).filter(([p]) => p.endsWith('.md')),
  )
  const { backlinkMap, unresolvedMap } = buildLinkMaps(mdFiles)
  setVaultStore('backlinkMap', backlinkMap)
  setVaultStore('unresolvedMap', unresolvedMap)
  setVaultStore('tagMap', buildTagMap(mdFiles))
  setVaultStore('taskMap', buildTaskMap(mdFiles))
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function scanAndIndex(): Promise<void> {
  if (currentSession) currentSession.cancelled = true
  const session: Session = { cancelled: false }
  currentSession = session

  if (!isReady()) return

  setIsIndexing(true)

  const [{ files, activePaths }, idbStats] = await Promise.all([
    buildScan(),
    loadAllFileStats(),
  ])

  if (session.cancelled) return

  const MAX_PARSE_BYTES = 20 * 1024 * 1024
  const mdUnchanged: string[] = []
  const mdChanged: string[] = []

  for (const [path, file] of Object.entries(files)) {
    if (file.kind !== 'file' || !path.endsWith('.md')) continue
    if (file.size > MAX_PARSE_BYTES) continue
    const stat = idbStats.get(path)
    if (stat && stat.size === file.size && stat.mtime === file.mtime) {
      files[path] = { ...file, hash: stat.hash }
      mdUnchanged.push(path)
    } else {
      mdChanged.push(path)
    }
  }

  setVaultStore('files', files)

  const activeHashes = new Set<string>()
  await runPhase1(session, mdUnchanged, mdChanged, activeHashes)

  if (!session.cancelled) {
    runPhase2()
    pruneFileStatCache(activePaths).catch(() => {})
    pruneCache(activeHashes).catch(() => {})
  }

  if (currentSession === session) {
    setIsIndexing(false)
  }
}

export async function rescanTree(): Promise<void> {
  if (!isReady()) return
  const { files } = await buildScan()
  setVaultStore('files', files)
}
