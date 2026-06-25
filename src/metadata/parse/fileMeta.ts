// 职责：把「文件内容 + body 解析结果」拼成 FileMeta 的内容字段。
// 这是 scan.parseAll（批量后台解析）与 fileActions.reindexFile（单文件保存）
// 共用的唯一字段构建器——避免两处各写一遍同款拼装逻辑。
import { parseFrontmatter } from '../../lib/parseFrontmatter'
import type { ParseResult } from '../../lib/parseMarkdown'
import type { FileMeta } from '../../stores/types'
import {
  extractAliases,
  extractDateString,
  extractTags,
  mergeTagsWithBody,
  resolveDatedField,
} from './extract'

/** FileMeta 中由内容解析得来的字段子集（与 indexStorage.CachedFields 同形）。 */
export type ContentFields = Pick<
  FileMeta,
  | 'frontmatter'
  | 'outLinks'
  | 'etags'
  | 'tags'
  | 'aliases'
  | 'created'
  | 'updated'
  | 'dated'
  | 'lists'
>

/**
 * @param content      原始文件内容（用于解析 frontmatter）
 * @param parsed       body 解析结果（outLinks / inlineTags / lists）
 * @param fallbackMtime created 缺失时回退用的 mtime（毫秒）
 */
export function buildContentFields(
  content: string,
  parsed: ParseResult,
  fallbackMtime: number,
): ContentFields {
  const { frontmatter } = parseFrontmatter(content)
  const { outLinks, inlineTags, lists } = parsed
  const created =
    extractDateString(frontmatter.created) ??
    new Date(fallbackMtime).toISOString().slice(0, 10)
  const updated = extractDateString(frontmatter.updated) ?? null
  const dated = resolveDatedField(frontmatter.dated, created)
  const fmTags = extractTags(frontmatter.tags)
  return {
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
}
