export const IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif',
])

export function isImagePath(path: string | null): path is string {
  if (!path) return false
  const dot = path.lastIndexOf('.')
  if (dot === -1) return false
  return IMAGE_EXTS.has(path.slice(dot).toLowerCase())
}

export function isMdPath(path: string | null): path is string {
  return !!path && path.endsWith('.md')
}
