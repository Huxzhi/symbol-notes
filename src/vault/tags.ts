import { buildTagMap } from '../lib/knowledgeUtils'
import type { FileMeta } from '../stores/types'
import { vaultStore, setVaultStore } from './index'

/** 全量重建 tagMap */
export function buildTags(mdFiles: Record<string, FileMeta>): void {
  setVaultStore('tagMap', buildTagMap(mdFiles))
}

/** 单文件 tags 变化时增量更新 */
export function applyFileTags(path: string, prevTags: string[], nextTags: string[]): void {
  const prev = new Set(prevTags)
  const next = new Set(nextTags)
  for (const t of prev) {
    if (!next.has(t))
      setVaultStore('tagMap', t, (l: string[]) => l?.filter(p => p !== path) ?? [])
  }
  for (const t of next) {
    if (!prev.has(t))
      setVaultStore('tagMap', t, (l: string[]) => l ? [...l, path] : [path])
  }
}

/** 文件删除：从所有 tag 列表中移除 */
export function removeFileTags(path: string, tags: string[]): void {
  for (const t of tags)
    setVaultStore('tagMap', t, (l: string[]) => l?.filter(p => p !== path) ?? [])
}
