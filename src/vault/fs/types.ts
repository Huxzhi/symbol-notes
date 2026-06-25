/** 嵌套的扫描结果：递归 walk 直接产出层级，目录带 children。
 *  只含结构（建树用）；size/mtime 不在这里——属 fileMap 的 FileEntry，由 statFiles 补。 */
export interface ScanEntry {
  name: string
  path: string
  kind: 'file' | 'directory'
  parent: string | null
  children?: ScanEntry[]   // 仅 directory
}

export interface FileSystemAdapter {
  readonly name: string
  readText(path: string): Promise<string>
  writeText(path: string, content: string): Promise<void>
  getMtime(path: string): Promise<number>
  getFile(path: string): Promise<File>
  /** 并发抓取一批文件的 size/mtime（structure-only scan 后补 stat 用）。 */
  statFiles(
    paths: string[],
    concurrency?: number,
    onStat?: () => void,
  ): Promise<Map<string, { size: number; mtime: number }>>
  deleteEntry(path: string, opts?: { recursive?: boolean }): Promise<void>
  createDirectory(path: string): Promise<void>
  /** 只建结构树（不含 stat）；文件 size/mtime 留 0，随后用 statFiles 补。 */
  scanTree(onDetected?: () => void): Promise<ScanEntry[]>
}
