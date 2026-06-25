// 职责：FS walk → FileMeta（buildScan），后台批量解析（parseAll），快速重扫（rescanTree）
// 字段抽取/拼装在 parse/；Phase2 索引构建在 index.ts
import { createMarkdownParser } from '../lib/parseMarkdown'
import type { FileMeta, TreeNode } from '../stores/types'
import { setVaultStore, vaultStore } from '../vault/store'
import { buildTreeFromScan, setFileTree } from '../vault/fileTree'
import {
  getCachedMeta,
  getManyMeta,
  hashContent,
  setCachedMeta,
  setFileStatEntry,
} from '../vault/indexStorage'
import { scanTree, readFile, type ScanEntry } from '../vault/fs/io'
import { extractDateFromName } from '../metadata/parse/extract'
import { buildContentFields } from '../metadata/parse/fileMeta'

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
  tree: TreeNode
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
  const files: Record<string, FileMeta> = {}
  const activePaths = new Set<string>()
  const epoch = new Date(0).toISOString().slice(0, 10)
  const roots = await scanTree(32, onDetected)
  // 顺着嵌套结果一遍：扁平化成 files（合并 store 仍需要）+ 收集活跃路径。
  const walk = (entries: ScanEntry[]): void => {
    for (const entry of entries) {
      const { name, path, kind, parent, size, mtime } = entry
      if (kind === 'directory') {
        files[path] = {
          name, path, kind: 'directory', parent,
          size: 0, mtime: 0, hash: '', ...EMPTY_CONTENT,
          created: epoch, dated: extractDateFromName(name) ?? epoch,
        }
        walk(entry.children ?? [])
      } else {
        const mtimeStr = new Date(mtime).toISOString().slice(0, 10)
        files[path] = {
          name, path, kind: 'file', parent,
          size, mtime, hash: '', ...EMPTY_CONTENT,
          created: mtimeStr, dated: extractDateFromName(name) ?? mtimeStr,
        }
        activePaths.add(path)
      }
    }
  }
  walk(roots)
  return { files, activePaths, tree: buildTreeFromScan(roots) }
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
        // 复用同一个 parser 实例解析 body（批量解析省开销），frontmatter 与字段
        // 拼装交给共享的 buildContentFields。
        const parsed = buildContentFields(content, parser.parse(content), entry.mtime)
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
  const { files, tree } = await buildScan()
  setVaultStore('files', files)
  setFileTree(tree)
}
