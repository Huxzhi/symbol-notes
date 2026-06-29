// 职责：metadata 的派生引擎——从 vault.fileMap 解析内容、建跨文件索引。
// - 全量 buildAll：由 vault 的 scanReady 信号触发（派生优先：metadata 读 vault，vault 不反依赖）。
// - 增量 updateFile/removeFile：命令层（fileManager）落盘后显式调（command → metadata，向下依赖）。
// - remapFileLink：rename 命令改写引用文件后，更新该文件缓存的 outLinks 与反链。
// metadata 只读 vault.fileMap、只写自己的 cache/索引（hash 字段仍落在 vault.files，方向 metadata→vault）。
// 进度信号：buildAll 自带 begin/end（自平衡）。vault 扫描阶段另有自己的 begin/end，
// markScanReady → 本 effect 同步开启 buildAll 的 begin，两段任务衔接无空窗，启动遮罩
// `!initialized && inProgressTaskCount>0` 全程不闪。
import { createEffect, createRoot } from 'solid-js'
import { produce } from 'solid-js/store'
import { hashContent } from '../lib/contentHash'
import type { ParseResult } from '../lib/parseMarkdown'
import { parseMarkdown } from '../lib/parseMarkdown'
import type { FileCache, FileEntry } from '../stores/types'
import { scanReady, setVaultStore, vaultStore } from '../vault/store'
import {
  loadAllFileStats,
  pruneFileStatCache,
  setFileStatEntry,
} from '../vault/statCache'
import {
  allFiles,
  EMPTY_CACHE,
  getFile,
  removeFileCache,
  seedCache,
  setFileCache,
} from './cache'
import {
  applyFileBacklinks,
  buildBacklinks,
  invalidateLinkIndexes,
  removeFileBacklinks,
} from './indexes/backlinks'
import {
  applyFileCalendar,
  buildCalendar,
  removeFileCalendar,
} from './indexes/calendar'
import { applyFileTags, buildTags, removeFileTags } from './indexes/tags'
import { applyFileTasks, buildTasks, removeFileTasks } from './indexes/tasks'
import { buildContentFields, type ContentFields } from './parse/fileMeta'
import { parseAll } from './parse/parseAll'
import { getCachedMeta, pruneCache, setCachedMeta } from './parsedCache'
import {
  beginIndexTask,
  endIndexTask,
  markInitialized,
  metadataStore,
  setMetadataStore,
} from './store'

const MAX_PARSE_BYTES = 20 * 1024 * 1024

// 每次全量派生一代；vault 切换 / 重扫触发新一代，作废在途解析。
let generation = 0

/**
 * 全量派生：读 vault.fileMap（此时已含 stat）→ idb 复用变更检测 → 解析 → 合并 → 建索引。
 * 不抓 stat（那是 vault 扫描的职责，已在 markScanReady 前完成）。
 */
export async function buildAll(): Promise<void> {
  const gen = ++generation
  const session = {
    get cancelled() {
      return gen !== generation
    },
  }
  beginIndexTask()
  try {
    const filePaths = Object.keys(vaultStore.files)
    const idbStats = await loadAllFileStats()
    if (session.cancelled) return

    // 变更检测：size/mtime 与 idb stat 缓存一致 → 复用 hash（跳过重解析）
    const mdUnchanged: string[] = []
    const mdChanged: string[] = []
    const reuseHash = new Map<string, string>()
    for (const path of filePaths) {
      if (!path.endsWith('.md')) continue
      const s = vaultStore.files[path]
      if (!s || s.size > MAX_PARSE_BYTES) continue
      const cached = idbStats.get(path)
      if (cached && cached.size === s.size && cached.mtime === s.mtime) {
        mdUnchanged.push(path)
        reuseHash.set(path, cached.hash)
      } else {
        mdChanged.push(path)
      }
    }

    setVaultStore(
      'files',
      produce((fs: Record<string, FileEntry>) => {
        for (const [path, hash] of reuseHash) {
          const e = fs[path]
          if (e) e.hash = hash
        }
      }),
    )
    setMetadataStore('cache', seedCache(vaultStore.files))

    // 后台解析（不写 store）。进度走 inProgressTaskCount。
    const activeHashes = new Set<string>()
    const results = await parseAll(session, mdUnchanged, mdChanged, activeHashes)
    if (session.cancelled) return

    // 一次性合并——hash 落 vault.fileMap，解析内容落 metadata.cache
    setVaultStore(
      'files',
      produce((fs: Record<string, FileEntry>) => {
        for (const [path, fields] of results) {
          if (fs[path] && fields.hash !== undefined) fs[path].hash = fields.hash
        }
      }),
    )
    setMetadataStore(
      'cache',
      produce((cs: Record<string, FileCache>) => {
        for (const [path, fields] of results) {
          const { hash: _h, ...content } = fields
          cs[path] = { ...EMPTY_CACHE, ...content }
        }
      }),
    )

    // 构建跨文件索引（用合并视图）
    const merged = allFiles()
    const mdFiles = Object.fromEntries(
      Object.entries(merged).filter(([p]) => p.endsWith('.md')),
    )
    buildBacklinks(mdFiles)
    buildTags(mdFiles)
    buildTasks(mdFiles)
    buildCalendar(merged)
    pruneFileStatCache(new Set(filePaths)).catch(() => {})
    pruneCache(activeHashes).catch(() => {})

    if (!session.cancelled) markInitialized()
  } finally {
    // 与 vault 扫描的 beginIndexTask 配对（每次 scanReady 触发一次 buildAll）。
    endIndexTask()
  }
}

/** 启动时调一次：订阅 vault 的 scanReady，就绪即跑全量派生。createRoot 常驻不销毁。 */
export function startMetadataDerivation(): void {
  createRoot(() => {
    createEffect(() => {
      if (scanReady() > 0) void buildAll()
    })
  })
}

// ── 增量派生（命令层落盘后调） ──────────────────────────────────────────────────

/** 单文件保存后：解析内容 → 更新 FileMeta → 增量更新三个索引。 */
export async function updateFile(
  path: string,
  content: string,
  cmParsed?: ParseResult,
  persistStat = false,
): Promise<void> {
  beginIndexTask()
  try {
    const hash = hashContent(content)
    const cached = await getCachedMeta(hash)
    let fields: ContentFields
    if (cached && Array.isArray(cached.lists)) {
      fields = cached
    } else {
      const existingMtime = vaultStore.files[path]?.mtime ?? Date.now()
      fields = buildContentFields(
        content,
        cmParsed ?? parseMarkdown(content),
        existingMtime,
      )
      await setCachedMeta(hash, fields)
    }

    const prev = getFile(path) // 合并视图(改前),供索引读旧 outLinks/tags
    setVaultStore('files', path, 'hash', hash) // hash 属 stat
    setFileCache(path, fields) // 解析内容落 metadata
    applyFileBacklinks(
      path,
      (prev?.outLinks ?? []).map((l) => l.target),
      fields.outLinks.map((l) => l.target),
    )
    applyFileTags(path, prev?.tags ?? [], fields.tags)
    applyFileTasks(path, fields.lists)
    applyFileCalendar(path, prev, getFile(path))

    if (persistStat) {
      const entry = vaultStore.files[path]
      if (entry?.kind === 'file')
        await setFileStatEntry(path, {
          size: entry.size,
          mtime: entry.mtime,
          hash,
        })
    }
  } finally {
    endIndexTask()
  }
}

/** 文件删除：从解析内容和所有索引中移除（fileMap 删除由命令层负责）。 */
export function removeFile(path: string): void {
  const file = getFile(path)
  if (!file) return
  removeFileBacklinks(path, file)
  removeFileTags(path, file.tags)
  removeFileTasks(path)
  removeFileCalendar(path, file)
  setVaultStore('files', path, undefined as unknown as FileEntry)
  removeFileCache(path)
  invalidateLinkIndexes()
}

/** 某个文件内的 wiki 链接指向从 oldTarget 重命名为 newTarget（rename 命令改写引用文件后调）。 */
export function remapFileLink(
  filePath: string,
  oldTarget: string,
  newTarget: string,
): void {
  const content = metadataStore.cache[filePath]
  if (!content) return
  const prevOutLinks = content.outLinks
  const nextOutLinks = prevOutLinks.map((l) =>
    l.target === oldTarget ? { ...l, target: newTarget } : l,
  )
  setMetadataStore('cache', filePath, 'outLinks', nextOutLinks)
  applyFileBacklinks(
    filePath,
    prevOutLinks.map((l) => l.target),
    nextOutLinks.map((l) => l.target),
  )
}
