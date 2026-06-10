import { get, set } from 'idb-keyval'
import type { DirEntry, FileSystemAdapter } from './types'
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

  async scanTree(concurrency = 32, onStat?: () => void): Promise<DirEntry[]> {
    const dirs: DirEntry[] = []
    const fileStubs: { name: string; path: string; parent: string | null; handle: FileSystemFileHandle }[] = []
    const walk = async (parentPath: string | null, dir: FileSystemDirectoryHandle): Promise<void> => {
      for await (const [name, entry] of dir.entries()) {
        if (name.startsWith('.')) continue
        const path = parentPath ? `${parentPath}/${name}` : name
        if (entry.kind === 'directory') {
          dirs.push({ name, path, kind: 'directory', parent: parentPath, size: 0, mtime: 0 })
          await walk(path, entry as FileSystemDirectoryHandle)
        } else {
          fileStubs.push({ name, path, parent: parentPath, handle: entry as FileSystemFileHandle })
        }
      }
    }
    await walk(null, this.rootHandle)
    const files = await mapWithConcurrency(fileStubs, concurrency, async (s): Promise<DirEntry> => {
      const f = await s.handle.getFile()
      onStat?.()
      return { name: s.name, path: s.path, kind: 'file', parent: s.parent, size: f.size, mtime: f.lastModified }
    })
    return [...dirs, ...files]
  }
}
