/** 把 [[]] 内原始目标切成 base 与 anchor（只在第一个 # 处切，空 anchor 视为无）。 */
export function splitWikiTarget(raw: string): { base: string; anchor?: string } {
  const i = raw.indexOf('#')
  if (i < 0) return { base: raw }
  const base = raw.slice(0, i)
  const anchor = raw.slice(i + 1)
  return anchor ? { base, anchor } : { base }
}
