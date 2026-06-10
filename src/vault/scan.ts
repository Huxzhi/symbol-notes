// 职责：FS walk → FileMeta（buildScan），内容解析（runPhase1），快速重扫（rescanTree）
// isIndexing / scanAndIndex / Phase2 索引构建 在 index.ts
import { parseFrontmatter } from '../lib/parseFrontmatter'
import { createMarkdownParser } from '../lib/parseMarkdown'
import type { FileMeta } from '../stores/types'
import { setVaultStore, vaultStore } from './index'
import {
  getCachedMeta,
  getManyMeta,
  hashContent,
  setCachedMeta,
  setFileStatEntry,
} from './indexStorage'
import { scanTree, readFile } from './io'

// ── Content parsing helpers ───────────────────────────────────────────────────

export function extractTags(raw: unknown): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === 'string')
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  return []
}

export function extractAliases(raw: unknown): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean)
  if (typeof raw === 'string')
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  return []
}

function expandEtag(etag: string): string[] {
  const parts = etag.split('/')
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}

export function mergeTagsWithBody(
  fmTags: string[],
  bodyEtags: string[],
): string[] {
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Yield to the event loop via a macrotask so the browser can paint and the
 * progress count-up can advance. setTimeout(0) is predictable (no
 * requestIdleCallback "wait for idle" up-to-500ms uncertainty); we call it in
 * batches to keep throughput high.
 */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// Cache-hit application is cheap → batch yields to keep the count-up smooth.
const UNCHANGED_YIELD_EVERY = 50
// Changed files are parsed (expensive) → yield after every file.
const CHANGED_YIELD_EVERY = 10

// ── FS Walk → FileMeta (stat only) ───────────────────────────────────────────

export interface ScanResult {
  files: Record<string, FileMeta>
  activePaths: Set<string>
}

const EMPTY_CONTENT: Pick<
  FileMeta,
  | 'frontmatter'
  | 'outLinks'
  | 'etags'
  | 'tags'
  | 'aliases'
  | 'updated'
  | 'lists'
> = {
  frontmatter: {},
  outLinks: [],
  etags: [],
  tags: [],
  aliases: [],
  updated: null,
  lists: [],
}

export async function buildScan(onDetected?: () => void): Promise<ScanResult> {
  const result: ScanResult = { files: {}, activePaths: new Set() }
  const epoch = new Date(0).toISOString().slice(0, 10)
  const entries = await scanTree(32, onDetected)
  for (const entry of entries) {
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

export type ParsedFields = Partial<FileMeta>

/**
 * 后台解析所有 md（缓存优先），**不写 store**，把每个文件的 FileMeta 字段
 * 攒进返回的 Map，由调用方一次性合并。
 */
export async function parseAll(
  session: { cancelled: boolean },
  unchanged: string[],
  changed: string[],
  activeHashes: Set<string>,
  onParsed?: () => void,
): Promise<Map<string, ParsedFields>> {
  const results = new Map<string, ParsedFields>()
  const parser = createMarkdownParser()
  const hashes = unchanged.map((p) => vaultStore.files[p]?.hash ?? '')
  hashes.forEach((h) => {
    if (h) activeHashes.add(h)
  })

  const metas = await getManyMeta(hashes)
  const stillChanged: string[] = [...changed]
  for (let i = 0; i < unchanged.length; i++) {
    if (session.cancelled) return results
    if (i > 0 && i % UNCHANGED_YIELD_EVERY === 0) {
      await yieldToMain()
      if (session.cancelled) return results
    }
    const path = unchanged[i]
    const hash = hashes[i]
    if (!hash) continue
    const meta = metas[i]
    if (meta && Array.isArray(meta.lists)) {
      results.set(path, { hash, ...meta })
      onParsed?.()
    } else {
      stillChanged.push(path)
    }
  }

  for (let ci = 0; ci < stillChanged.length; ci++) {
    const path = stillChanged[ci]
    if (session.cancelled) return results
    if (ci > 0 && ci % CHANGED_YIELD_EVERY === 0) {
      await yieldToMain()
      if (session.cancelled) return results
    }
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
      if (cachedMeta && Array.isArray(cachedMeta.lists)) {
        results.set(path, { hash, ...cachedMeta })
      } else {
        const { frontmatter } = parseFrontmatter(content)
        const { outLinks, inlineTags, lists } = parser.parse(content)
        const created =
          extractDateString(frontmatter.created) ??
          new Date(entry.mtime).toISOString().slice(0, 10)
        const updated = extractDateString(frontmatter.updated) ?? null
        const dated = extractDateString(frontmatter.dated) ?? created
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
          lists,
        }
        await setCachedMeta(hash, parsed)
        results.set(path, { hash, ...parsed })
      }
    } catch {
      /* individual file errors are non-fatal */
    } finally {
      onParsed?.()
    }
  }
  return results
}

// ── Quick rescan (no parsing) ─────────────────────────────────────────────────

export async function rescanTree(): Promise<void> {
  const { files } = await buildScan()
  setVaultStore('files', files)
}
