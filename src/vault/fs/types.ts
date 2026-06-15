export interface DirEntry {
  name: string
  path: string
  kind: 'file' | 'directory'
  parent: string | null
  size: number
  mtime: number
}

/** 嵌套的扫描结果：递归 walk 直接产出层级，目录带 children。 */
export interface ScanEntry {
  name: string
  path: string
  kind: 'file' | 'directory'
  parent: string | null
  size: number
  mtime: number
  children?: ScanEntry[]   // 仅 directory
}

export interface FileSystemAdapter {
  readonly name: string
  readText(path: string): Promise<string>
  writeText(path: string, content: string): Promise<void>
  getMtime(path: string): Promise<number>
  getFile(path: string): Promise<File>
  deleteEntry(path: string, opts?: { recursive?: boolean }): Promise<void>
  createDirectory(path: string): Promise<void>
  listAll(): AsyncGenerator<DirEntry>
  scanTree(concurrency?: number, onStat?: () => void): Promise<ScanEntry[]>
}
