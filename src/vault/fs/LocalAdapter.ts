import { get, set } from 'idb-keyval'

import type { FileSystemAdapter, ScanEntry } from './types'

declare global {
  interface Window {
    showDirectoryPicker(options?: {
      mode?: 'read' | 'readwrite'
    }): Promise<FileSystemDirectoryHandle>
  }
  interface FileSystemDirectoryHandle {
    requestPermission(options?: {
      mode?: 'read' | 'readwrite'
    }): Promise<PermissionState>
  }
}

export class LocalAdapter implements FileSystemAdapter {
  // path → 文件句柄缓存：scanTree 时填充，省掉每次读取的逐段 getDirectoryHandle。
  // 仅内存（只持久化 rootHandle），每次 open/scan 重建；外部改动致 stale 时回退 resolveFile。
  private handleCache = new Map<string, FileSystemFileHandle>()

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

  private async resolveFile(
    path: string,
    create = false,
  ): Promise<FileSystemFileHandle> {
    const parts = path.split('/')
    const name = parts.pop()!
    let dir = this.rootHandle
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(
        part,
        create ? { create: true } : undefined,
      )
    }
    return dir.getFileHandle(name, create ? { create: true } : undefined)
  }

  private async resolveParentDir(
    path: string,
  ): Promise<[FileSystemDirectoryHandle, string]> {
    const parts = path.split('/')
    const name = parts.pop()!
    let dir = this.rootHandle
    for (const part of parts) dir = await dir.getDirectoryHandle(part)
    return [dir, name]
  }

  async readText(path: string): Promise<string> {
    return (await this.getFile(path)).text()
  }

  async writeText(path: string, content: string): Promise<void> {
    const handle = await this.resolveFile(path, true)
    this.handleCache.set(path, handle)
    const writable = await handle.createWritable()
    await writable.write(content)
    await writable.close()
  }

  async getMtime(path: string): Promise<number> {
    return (await this.getFile(path)).lastModified
  }

  async getFile(path: string): Promise<File> {
    const cached = this.handleCache.get(path)
    if (cached) {
      try {
        return await cached.getFile()
      } catch {
        this.handleCache.delete(path) // stale（被外部移动/删除）→ 重新解析
      }
    }
    const handle = await this.resolveFile(path)
    this.handleCache.set(path, handle)
    return handle.getFile()
  }

  async statFiles(
    paths: string[],
    concurrency = 32,
    onStat?: () => void,
  ): Promise<Map<string, { size: number; mtime: number }>> {
    const out = new Map<string, { size: number; mtime: number }>()
    await mapWithConcurrency(paths, concurrency, async (path) => {
      try {
        const f = await this.getFile(path)
        out.set(path, { size: f.size, mtime: f.lastModified })
      } catch {
        /* 文件刚被删/无权限 → 跳过，留 stat 为 0 */
      }
      onStat?.()
    })
    return out
  }

  async deleteEntry(
    path: string,
    opts?: { recursive?: boolean },
  ): Promise<void> {
    const [dir, name] = await this.resolveParentDir(path)
    await dir.removeEntry(
      name,
      opts?.recursive ? { recursive: true } : undefined,
    )
    this.handleCache.delete(path)
    const prefix = path + '/'
    for (const k of this.handleCache.keys()) {
      if (k.startsWith(prefix)) this.handleCache.delete(k)
    }
  }

  async createDirectory(path: string): Promise<void> {
    const parts = path.split('/')
    let dir = this.rootHandle
    for (const part of parts)
      dir = await dir.getDirectoryHandle(part, { create: true })
  }

  async scanTree(onDetected?: () => void): Promise<ScanEntry[]> {
    // 只走结构（便宜，当场就有）+ 顺手缓存文件句柄；size/mtime 留 0，由后台 statFiles 补。
    this.handleCache.clear()
    const walk = async (
      parentPath: string | null,
      siblings: ScanEntry[],
      dir: FileSystemDirectoryHandle,
    ): Promise<void> => {
      for await (const [name, entry] of dir.entries()) {
        if (name.startsWith('.')) continue
        const path = parentPath ? `${parentPath}/${name}` : name
        if (entry.kind === 'directory') {
          const node: ScanEntry = {
            name,
            path,
            kind: 'directory',
            parent: parentPath,
            children: [],
          }
          siblings.push(node)
          await walk(path, node.children!, entry as FileSystemDirectoryHandle)
        } else {
          siblings.push({ name, path, kind: 'file', parent: parentPath })
          this.handleCache.set(path, entry as FileSystemFileHandle)
          onDetected?.()
        }
      }
    }
    const roots: ScanEntry[] = []
    await walk(null, roots, this.rootHandle)
    return roots
  }
}
/** 有界并发 map：最多 limit 个 fn 同时执行，结果按输入顺序返回。 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  const n = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: n }, () => worker()))
  return results
}
