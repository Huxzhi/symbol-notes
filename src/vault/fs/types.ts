export interface DirEntry {
  name: string
  path: string
  kind: 'file' | 'directory'
  parent: string | null
  size: number
  mtime: number
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
  scanTree(concurrency?: number, onStat?: () => void): Promise<DirEntry[]>
}
