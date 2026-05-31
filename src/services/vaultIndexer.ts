import { vaultStore, setVaultStore } from '../stores/vaultStore'
import { runtimeStore, setRuntimeStore } from '../stores/runtimeStore'
import { parseFrontmatter } from '../lib/parseFrontmatter'
import { createMarkdownParser } from '../lib/parseMarkdown'
import { readFile } from './fileIO'
import {
  hashContent, getCachedMeta, setCachedMeta, getManyMeta, pruneCache,
  loadAllFileStats, setFileStatEntry, pruneFileStatCache,
} from './indexStorage'
import {
  extractTags, extractAliases, mergeTagsWithBody, buildLinkMaps, buildTagMap,
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

// Pure FS walk — collects stat fields only, no cache comparison.
async function buildScan(
  dirHandle: FileSystemDirectoryHandle,
  parentPath: string | null = null,
  result: ScanResult = { files: {}, activePaths: new Set() },
): Promise<ScanResult> {
  for await (const [name, handle] of dirHandle.entries()) {
    if (name.startsWith('.')) continue
    const path = parentPath ? `${parentPath}/${name}` : name

    if (handle.kind === 'directory') {
      const epoch = new Date(0).toISOString().slice(0, 10)
      result.files[path] = {
        name, path, kind: 'directory', parent: parentPath, size: 0, mtime: 0, hash: '',
        ...EMPTY_CONTENT,
        created: epoch,
        dated: extractDateFromName(name) ?? epoch,
      }
      await buildScan(handle as FileSystemDirectoryHandle, path, result)
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
    }
  }
  return result
}

// ── Index phases ──────────────────────────────────────────────────────────────

interface Session { cancelled: boolean }
let currentSession: Session | null = null

async function runPhase1(
  session: Session,
  unchanged: string[],   // hash assigned from sn-stat, content not yet loaded
  changed: string[],     // stat mismatch — need to read file and compute hash
  activeHashes: Set<string>,
): Promise<void> {
  const parser = createMarkdownParser()
  // unchanged: batch-fetch sn-meta by hash (one IDB transaction for all)
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
      changed.push(path)  // sn-meta miss → fall through to full parse
    }
  }

  // changed: size/mtime differ — read file, compute hash, get or build FileMeta
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

  const { rootHandle } = runtimeStore
  if (!rootHandle) return

  setRuntimeStore('isIndexing', true)

  // FS walk and IDB stat read run in parallel
  const [{ files, activePaths }, idbStats] = await Promise.all([
    buildScan(rootHandle),
    loadAllFileStats(),
  ])

  if (session.cancelled) return

  // Compare size+mtime against stat cache:
  //   match   → assign cached hash directly (no file read needed)
  //   no match → needs file read to compute hash
  // Files over MAX_PARSE_BYTES are skipped entirely — left with EMPTY_CONTENT,
  // opened directly from the file handle by the editor.
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
    setRuntimeStore('isIndexing', false)
  }
}

export async function rescanTree(): Promise<void> {
  const { rootHandle } = runtimeStore
  if (!rootHandle) return
  const { files } = await buildScan(rootHandle)
  setVaultStore('files', files)
}
