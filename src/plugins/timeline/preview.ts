export interface NotePreview {
  thumbnail?: string
  snippet?: string
}

const MD_IMAGE = /!\[[^\]]*\]\(([^)\s]+)/ // ![alt](url
const EMBED_IMAGE = /!\[\[([^\]]+)\]\]/ // ![[file]]
const SNIPPET_MAX = 120

/**
 * 从 markdown 正文抽取预览：
 *   - thumbnail：首个图片（markdown 或 ![[embed]]）的 url/文件名
 *   - snippet：首段非空、非 frontmatter、非标题、非图片的正文，超长截断
 */
export function extractPreview(content: string): NotePreview {
  const result: NotePreview = {}

  const md = content.match(MD_IMAGE)
  const embed = content.match(EMBED_IMAGE)
  if (md) result.thumbnail = md[1]
  else if (embed) result.thumbnail = embed[1]

  const lines = content.split('\n')
  let inFrontmatter = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (i === 0 && line === '---') {
      inFrontmatter = true
      continue
    }
    if (inFrontmatter) {
      if (line === '---') inFrontmatter = false
      continue
    }
    if (!line) continue
    if (line.startsWith('#')) continue
    if (line.startsWith('![')) continue
    result.snippet =
      line.length > SNIPPET_MAX ? line.slice(0, SNIPPET_MAX) + '…' : line
    break
  }

  return result
}
