const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif'])

export function computeWikiLink(name: string, kind: 'file' | 'directory'): string {
  if (kind === 'directory') return `[[${name}]]`
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  if (IMAGE_EXTS.has(ext)) return `![[${name}]]`
  if (name.endsWith('.md')) return `[[${name.slice(0, -3)}]]`
  return `[[${name}]]`
}

// Returns false when the move would be a no-op or invalid (cycle).
export function isValidMoveDrop(
  srcPath: string,
  destDirPath: string | null,
  srcParentPath: string | null,
): boolean {
  if (destDirPath === srcParentPath) return false
  if (destDirPath === srcPath) return false
  if (destDirPath !== null && destDirPath.startsWith(srcPath + '/')) return false
  return true
}
