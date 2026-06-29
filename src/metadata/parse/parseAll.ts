// 职责:后台批量「读文件 → 解析内容」,产出每个 path 的解析字段(缓存优先)。
// 这是 metadata 的「读取+解析」入口(原 loader/scan.ts 的 parseAll)。不写 store,
// 由调用方(metadata/derive.buildAll)一次性合并进 fileMap 并建跨文件索引。
import { createMarkdownParser } from '../../lib/parseMarkdown'
import type { FileMeta } from '../../stores/types'
import { vaultStore } from '../../vault/store'
import { getCachedMeta, getManyMeta, setCachedMeta } from '../parsedCache'
import { setFileStatEntry } from '../../vault/statCache'
import { hashContent } from '../../lib/contentHash'
import { readFile } from '../../vault/fs/io'
import { buildContentFields } from './fileMeta'

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
    }
  }
  return results
}
