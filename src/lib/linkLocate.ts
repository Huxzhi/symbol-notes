function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 在 doc 里找 [[stem...]]，stem 后可接 #anchor / |alias / 直接 ]]。
 *  多处命中且给了 headingPathHint：优先选其上方最近 ATX 标题文本匹配 hint 末项的那处。 */
export function findWikiLink(
  doc: string,
  targetStem: string,
  headingPathHint?: string[],
): { from: number; to: number } | null {
  const re = new RegExp(`\\[\\[${escapeRe(targetStem)}(?:#[^\\]|]*)?(?:\\|[^\\]]*)?\\]\\]`, 'g')
  const hits: { from: number; to: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(doc)) !== null) hits.push({ from: m.index, to: m.index + m[0].length })
  if (hits.length === 0) return null
  if (hits.length === 1 || !headingPathHint?.length) return hits[0]

  const wantHeading = headingPathHint[headingPathHint.length - 1]
  for (const h of hits) {
    const before = doc.slice(0, h.from)
    const lastHeading = [...before.matchAll(/^#{1,6}\s+(.*)$/gm)].pop()
    if (lastHeading && lastHeading[1].trim() === wantHeading) return h
  }
  return hits[0]
}

/** 找文本匹配的 ATX 标题行，返回该行（去尾空白）的范围。 */
export function findHeading(doc: string, text: string): { from: number; to: number } | null {
  const re = /^(#{1,6}\s+(.*))$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(doc)) !== null) {
    if (m[2].trim() === text.trim()) {
      return { from: m.index, to: m.index + m[1].trimEnd().length }
    }
  }
  return null
}
