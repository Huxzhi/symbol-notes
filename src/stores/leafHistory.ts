/**
 * 追加一次导航到 leaf 的文件历史栈。
 * - 历史为空且给了 prevFile 时，先把 prevFile 作为起点种入（让首次导航也能后退）。
 * - file 与当前项相同则不重复入栈。
 * - 否则丢弃当前位置之后的「前进」项，再追加 file。
 */
export function pushHistory(
  history: string[],
  index: number,
  file: string,
  prevFile?: string,
): { history: string[]; index: number } {
  let h = history
  let i = index
  if (h.length === 0 && prevFile != null) {
    h = [prevFile]
    i = 0
  }
  if (h[i] === file) return { history: h, index: i }
  const next = h.slice(0, i + 1)
  next.push(file)
  return { history: next, index: next.length - 1 }
}
