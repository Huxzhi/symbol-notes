import { get, set } from 'idb-keyval'
import type { DirEntry, ScanEntry, FileSystemAdapter } from './types'
import { mapWithConcurrency } from './concurrency'

declare global {
  interface Window {
    showDirectoryPicker(options?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>
  }
  interface FileSystemDirectoryHandle {
    requestPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
  }
}

export class LocalAdapter implements FileSystemAdapter {
  private constructor(readonly rootHandle: FileSystemDirectoryHandle) {}

  static async open(): Promise<LocalAdapter> {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
    await set('rootHandle', handle)
    return new LocalAdapter(handle)
  }

  static async restore(): Promise<LocalAdapter | null> {
    const handle = await get<FileSystemDirectoryHandle>('rootHandle')
    if (!handle) return null
    try {
      const perm = await handle.requestPermission({ mode: 'readwrite' })
      if (perm !== 'granted') return null
      return new LocalAdapter(handle)
    } catch {
      return null
    }
  }

  get name(): string {
    return this.rootHandle.name
  }

  private async resolveFile(path: string, create = false): Promise<FileSystemFileHandle> {
    const parts = path.split('/')
    const name = parts.pop()!
    let dir = this.rootHandle
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, create ? { create: true } : undefined)
    }
    return dir.getFileHandle(name, create ? { create: true } : undefined)
  }

  private async resolveParentDir(path: string): Promise<[FileSystemDirectoryHandle, string]> {
    const parts = path.split('/')
    const name = parts.pop()!
    let dir = this.rootHandle
    for (const part of parts) dir = await dir.getDirectoryHandle(part)
    return [dir, name]
  }

  async readText(path: string): Promise<string> {
    const handle = await this.resolveFile(path)
    return (await handle.getFile()).text()
  }

  async writeText(path: string, content: string): Promise<void> {
    const handle = await this.resolveFile(path, true)
    const writable = await handle.createWritable()
    await writable.write(content)
    await writable.close()
  }

  async getMtime(path: string): Promise<number> {
    const handle = await this.resolveFile(path)
    return (await handle.getFile()).lastModified
  }

  async getFile(path: string): Promise<File> {
    const handle = await this.resolveFile(path)
    return handle.getFile()
  }

  async deleteEntry(path: string, opts?: { recursive?: boolean }): Promise<void> {
    const [dir, name] = await this.resolveParentDir(path)
    await dir.removeEntry(name, opts?.recursive ? { recursive: true } : undefined)
  }

  async createDirectory(path: string): Promise<void> {
    const parts = path.split('/')
    let dir = this.rootHandle
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true })
  }

  async *listAll(parentPath: string | null = null, dir?: FileSystemDirectoryHandle): AsyncGenerator<DirEntry> {
    const handle = dir ?? this.rootHandle
    for await (const [name, entry] of handle.entries()) {
      if (name.startsWith('.')) continue
      const path = parentPath ? `${parentPath}/${name}` : name
      if (entry.kind === 'directory') {
        yield { name, path, kind: 'directory', parent: parentPath, size: 0, mtime: 0 }
        yield* this.listAll(path, entry as FileSystemDirectoryHandle)
      } else {
        const file = await (entry as FileSystemFileHandle).getFile()
        yield { name, path, kind: 'file', parent: parentPath, size: file.size, mtime: file.lastModified }
      }
    }
  }

  async scanTree(concurrency = 32, onStat?: () => void): Promise<ScanEntry[]> {
    // walk 递归直接产出层级（结构便宜，当场就有）；文件 stat 攒起来 walk 后并发补。
    const fileStubs: { node: ScanEntry; handle: FileSystemFileHandle }[] = []
    const walk = async (
      parentPath: string | null,
      siblings: ScanEntry[],
      dir: FileSystemDirectoryHandle,
    ): Promise<void> => {
      for await (const [name, entry] of dir.entries()) {
        if (name.startsWith('.')) continue
        const path = parentPath ? `${parentPath}/${name}` : name
        if (entry.kind === 'directory') {
          const node: ScanEntry = { name, path, kind: 'directory', parent: parentPath, size: 0, mtime: 0, children: [] }
          siblings.push(node)
          await walk(path, node.children!, entry as FileSystemDirectoryHandle)
        } else {
          const node: ScanEntry = { name, path, kind: 'file', parent: parentPath, size: 0, mtime: 0 }
          siblings.push(node)
          fileStubs.push({ node, handle: entry as FileSystemFileHandle })
        }
      }
    }
    const roots: ScanEntry[] = []
    await walk(null, roots, this.rootHandle)
    await mapWithConcurrency(fileStubs, concurrency, async ({ node, handle }) => {
      const f = await handle.getFile()
      onStat?.()
      node.size = f.size
      node.mtime = f.lastModified
    })
    return roots
  }
}
