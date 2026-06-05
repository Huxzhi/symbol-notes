// 职责：FS walk → FileMeta（buildScan），内容解析（runPhase1），快速重扫（rescanTree）
// isIndexing / scanAndIndex / Phase2 索引构建 在 index.ts
import { parseFrontmatter } from '../lib/parseFrontmatter'

// ── Content parsing helpers ───────────────────────────────────────────────────

export function extractTags(raw: unknown): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === 'string') return raw.split(',').map(s => s.trim()).filter(Boolean)
  return []
}

export function extractAliases(raw: unknown): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean)
  if (typeof raw === 'string') return raw.split(',').map(s => s.trim()).filter(Boolean)
  return []
}

function expandEtag(etag: string): string[] {
  const parts = etag.split('/')
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}

export function mergeTagsWithBody(fmTags: string[], bodyEtags: string[]): string[] {
  const set = new Set(fmTags)
  for (const etag of bodyEtags) for (const t of expandEtag(etag)) set.add(t)
  return [...set]
}

export function extractDateString(val: unknown): string | null {
  if (typeof val !== 'string') return null
  return /^\d{4}-\d{2}-\d{2}/.test(val) ? val.slice(0, 10) : null
}

export function extractDateFromName(name: string): string | null {
  const hyphen = name.match(/(\d{4}-\d{2}-\d{2})/)
  if (hyphen) return hyphen[1]
  const compact = name.match(/(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`
  return null
}
import { createMarkdownParser } from '../lib/parseMarkdown'
import type { FileMeta, TaskItem } from '../stores/types'
import { setVaultStore, vaultStore } from './index'
import {
  getCachedMeta,
  getManyMeta,
  hashContent,
  setCachedMeta,
  setFileStatEntry,
} from './indexStorage'
import { listAll, readFile } from './io'

// ── Helpers ───────────────────────────────────────────────────────────────────

function idle(): Promise<void> {
  return new Promise((resolve) => {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => resolve(), { timeout: 500 })
    } else {
      setTimeout(resolve, 0)
    }
  })
}

// ── FS Walk → FileMeta (stat only) ───────────────────────────────────────────

export interface ScanResult {
  files: Record<string, FileMeta>
  activePaths: Set<string>
}

const EMPTY_CONTENT: Pick<
  FileMeta,
  'frontmatter' | 'outLinks' | 'etags' | 'tags' | 'aliases' | 'updated' | 'tasks'
> = {
  frontmatter: {},
  outLinks: [],
  etags: [],
  tags: [],
  aliases: [],
  updated: null,
  tasks: [],
}

export async function buildScan(): Promise<ScanResult> {
  const result: ScanResult = { files: {}, activePaths: new Set() }
  const epoch = new Date(0).toISOString().slice(0, 10)
  for await (const entry of listAll()) {
    const { name, path, kind, parent, size, mtime } = entry
    if (kind === 'directory') {
      result.files[path] = {
        name,
        path,
        kind: 'directory',
        parent,
        size: 0,
        mtime: 0,
        hash: '',
        ...EMPTY_CONTENT,
        created: epoch,
        dated: extractDateFromName(name) ?? epoch,
      }
    } else {
      const mtimeStr = new Date(mtime).toISOString().slice(0, 10)
      result.files[path] = {
        name,
        path,
        kind: 'file',
        parent,
        size,
        mtime,
        hash: '',
        ...EMPTY_CONTENT,
        created: mtimeStr,
        dated: extractDateFromName(name) ?? mtimeStr,
      }
      result.activePaths.add(path)
    }
  }
  return result
}

// ── Phase 1: 内容解析，填充 FileMeta hash/frontmatter/outLinks/tags/tasks ────

export async function runPhase1(
  session: { cancelled: boolean },
  unchanged: string[],
  changed: string[],
  activeHashes: Set<string>,
): Promise<void> {
  const parser = createMarkdownParser()
  const hashes = unchanged.map((p) => vaultStore.files[p]?.hash ?? '')
  hashes.forEach((h) => {
    if (h) activeHashes.add(h)
  })

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
      if (entry)
        await setFileStatEntry(path, {
          size: entry.size,
          mtime: entry.mtime,
          hash,
        })
      const cachedMeta = await getCachedMeta(hash)
      if (cachedMeta) {
        setVaultStore('files', path, (f: FileMeta) => ({
          ...f,
          hash,
          ...cachedMeta,
        }))
        continue
      }
      const { frontmatter } = parseFrontmatter(content)
      const {
        outLinks,
        inlineTags,
        tasks: rawTaskItems,
      } = parser.parse(content)
      const created =
        extractDateString(frontmatter.created) ??
        new Date(entry.mtime).toISOString().slice(0, 10)
      const updated = extractDateString(frontmatter.updated) ?? null
      const dated = extractDateString(frontmatter.dated) ?? created
      const tasks: TaskItem[] = rawTaskItems.map((t) => ({
        ...t,
        dueDate: t.dueDate ?? dated,
        completedDate: t.checked ? (t.completedDate ?? dated) : null,
      }))
      const fmTags = extractTags(frontmatter.tags)
      const parsed = {
        frontmatter,
        outLinks,
        etags: [...new Set([...fmTags, ...inlineTags])],
        tags: mergeTagsWithBody(fmTags, inlineTags),
        aliases: extractAliases(frontmatter.aliases),
        created,
        updated,
        dated,
        tasks,
      }
      await setCachedMeta(hash, parsed)
      setVaultStore('files', path, (f: FileMeta) => ({ ...f, hash, ...parsed }))
    } catch {
      /* individual file errors are non-fatal */
    }
  }
}

// ── Quick rescan (no parsing) ─────────────────────────────────────────────────

export async function rescanTree(): Promise<void> {
  const { files } = await buildScan()
  setVaultStore('files', files)
}
