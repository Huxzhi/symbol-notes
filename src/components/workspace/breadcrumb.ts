/** 把文件路径拆成「累计路径的文件夹段」+「去掉 .md 的文件名」。 */
export function splitBreadcrumb(path: string): {
  folders: { name: string; path: string }[]
  file: string
} {
  const parts = path.split('/')
  const fileName = parts.pop() ?? ''
  const file = fileName.replace(/\.md$/, '')
  const folders: { name: string; path: string }[] = []
  let acc = ''
  for (const p of parts) {
    acc = acc ? `${acc}/${p}` : p
    folders.push({ name: p, path: acc })
  }
  return { folders, file }
}
