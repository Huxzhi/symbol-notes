import { vaultStore, setVaultStore } from '../stores/vaultStore'
import { runtimeStore, setRuntimeStore } from '../stores/runtimeStore'
import { parseFrontmatter } from '../lib/parseFrontmatter'
import { parseMarkdown } from '../lib/parseMarkdown'
import {
  hashContent, getCachedMeta, setCachedMeta, pruneCache,
  readFile, loadAllFileStats, setFileStatEntry, pruneFileStatCache,
} from './fileCacheService'
import {
  extractTags, extractAliases, mergeTagsWithBody, buildBacklinkMap, buildTagMap,
  extractDateString, extractDateFromName, buildTaskMap,
} from '../lib/knowledgeUtils'
import type { FileMeta, TaskItem } from '../stores/types'

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
  unchanged: Map<string, string>  // path → hash (stat matched IDB)
  changed: string[]               // paths needing content read
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
      const dirMtime = new Date(0).toISOString().slice(0, 10)
      result.files[path] = {
        name, path, kind: 'directory', parent: parentPath, size: 0, mtime: 0, hash: '',
        ...EMPTY_CONTENT,
        created: dirMtime,
        dated: extractDateFromName(name) ?? dirMtime,
      }
      await buildScan(handle as FileSystemDirectoryHandle, idbStats, path, result)
    } else {
      const file = await (handle as FileSystemFileHandle).getFile()
      const size = file.size
      const mtime = file.lastModified
      const mtimeStr = new Date(mtime).toISOString().slice(0, 10)
      result.files[path] = {
        name, path, kind: 'file', parent: parentPath, size, mtime, hash: '',
        ...EMPTY_CONTENT,
        created: mtimeStr,
        dated: extractDateFromName(name) ?? mtimeStr,
      }
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
    if (cached && vaultStore.files[path]?.hash === hash) continue
    if (cached) {
      const fname = path.split('/').at(-1) ?? ''
      const dated = extractDateFromName(fname) ?? cached.created
      setVaultStore('files', path, (f: FileMeta) => ({ ...f, hash, dated, ...cached }))
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
      if (entry?.size !== undefined && entry.mtime !== undefined) {
        await setFileStatEntry(path, { size: entry.size, mtime: entry.mtime, hash })
      }

      const cachedMeta = await getCachedMeta(hash)
      if (cachedMeta) {
        const fname = path.split('/').at(-1) ?? ''
        const dated = extractDateFromName(fname) ?? cachedMeta.created
        setVaultStore('files', path, (f: FileMeta) => ({ ...f, hash, dated, ...cachedMeta }))
        continue
      }

      const { frontmatter } = parseFrontmatter(content)
      const { outLinks, inlineTags, tasks: rawTaskItems } = parseMarkdown(content)

      const created = extractDateString(frontmatter.created)
                   ?? new Date(entry.mtime).toISOString().slice(0, 10)
      const updated = extractDateString(frontmatter.updated) ?? null
      const filename = path.split('/').at(-1) ?? ''
      const dated = extractDateFromName(filename) ?? created

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
        tasks,
      }
      await setCachedMeta(hash, parsed)
      setVaultStore('files', path, (f: FileMeta) => ({ ...f, hash, dated, ...parsed }))
    } catch { /* individual file errors are non-fatal */ }
  }
}

function runPhase2(): void {
  const mdFiles = Object.fromEntries(
    Object.entries(vaultStore.files).filter(([p]) => p.endsWith('.md')),
  )
  setVaultStore('backlinkMap', buildBacklinkMap(mdFiles))
  setVaultStore('tagMap', buildTagMap(mdFiles))
  setVaultStore('taskMap', buildTaskMap(mdFiles))
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
  setVaultStore('files', files)

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
  setVaultStore('files', files)
}
