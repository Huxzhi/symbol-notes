// 职责：从 frontmatter / 文件名里抽取并归一化标量字段（标签、别名、日期）。
// 纯函数、零 vault 内部依赖——既被 parse/fileMeta 的字段构建器用，也单独可测。

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

/** 周格式 2026-W22 或月格式 2026-06——周期笔记，不落到日历的某一天。 */
export function isPeriodDated(val: unknown): boolean {
  return typeof val === 'string' && /^\d{4}-(W\d{2}|\d{2})$/.test(val.trim())
}

/**
 * 计算 FileMeta.dated（用于按天聚合 listItem）。
 * - 完整日期 YYYY-MM-DD → 该天
 * - 周/月格式 → ''（不参与每日聚合；文件本身仍按 created/updated 显示）
 * - 缺失或无法识别 → 回退到 created
 */
export function resolveDatedField(rawDated: unknown, created: string): string {
  const day = extractDateString(rawDated)
  if (day) return day
  if (isPeriodDated(rawDated)) return ''
  return created
}

export function extractDateFromName(name: string): string | null {
  const hyphen = name.match(/(\d{4}-\d{2}-\d{2})/)
  if (hyphen) return hyphen[1]
  const compact = name.match(/(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`
  return null
}
