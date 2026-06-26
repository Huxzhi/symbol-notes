// 全局数据服务单例:vault / metadata / fileManager。三个平级服务,按职责分。
// 组件直接 import 使用;插件经 ctx.vault / ctx.metadata / ctx.fileManager 拿到的是
// 同一批单例(pluginRegistry 只是把它们转交给插件,不重建)。
// 这些是对 src/vault/* 领域模块的稳定门面;依赖方向:services → vault,vault 不反依赖。
import type { FileEntry, FileMeta } from './stores/types'
import { readFile, vaultFs, vaultStore } from './vault'
import { getAliasIndex, uniqueFileLookup, resolveLink, metadataStore, getFile } from './metadata'
import { fileActions } from './fileManager'

// ── 契约 ────────────────────────────────────────────────────────────────────

/** 字节层:文件读取 + 响应式 fileMap(仅 stat 的 FileEntry)。 */
export interface VaultService {
  /** vault 是否已打开(响应式)。 */
  ready(): boolean
  /** 全部文件/目录的 stat(响应式)。解析内容见 metadata.file。 */
  files(): Record<string, FileEntry>
  readFile(path: string): Promise<string>
}

/** 解析缓存 / 派生索引:每文件内容、双链、链接解析。 */
export interface MetadataService {
  /** 单文件的合并视图(stat + 解析内容,响应式)。 */
  file(path: string): FileMeta | undefined
  /** 指向 path 的文件列表(响应式)。 */
  backlinks(path: string): string[]
  /** 把 `[[名字]]` 解析成绝对路径,解析不到返回 null。 */
  resolveLink(target: string): string | null
}

/** 链接感知的高层文件操作(落盘 + 增量索引 + 改反链)。 */
export interface FileManagerService {
  saveFile(path: string, content: string): Promise<void>
  createFile(name: string): Promise<string | null>
  createFolder(name: string): Promise<void>
  deleteFile(path: string): Promise<void>
  deleteFolder(path: string): Promise<void>
  renameFile(path: string, newName: string): Promise<void>
  moveEntry(src: string, dest: string | null): Promise<void>
}

// ── 单例实现(facade,不改行为) ──────────────────────────────────────────────

export const vault: VaultService = {
  ready: () => vaultFs() !== null,
  files: () => vaultStore.files,
  readFile: (path) => readFile(path),
}

export const metadata: MetadataService = {
  file: (path) => getFile(path),
  backlinks: (path) => [...(metadataStore.backlinkMap[path] ?? [])],
  resolveLink: (target) => {
    const withExt = target.endsWith('.md') ? target : `${target}.md`
    return resolveLink(withExt, uniqueFileLookup(), vaultStore.files, getAliasIndex())
  },
}

export const fileManager: FileManagerService = {
  saveFile: (path, content) => fileActions.saveFile(path, content),
  createFile: (name) => fileActions.createFile(name),
  createFolder: (name) => fileActions.createFolder(name),
  deleteFile: (path) => fileActions.deleteFile(path),
  deleteFolder: (path) => fileActions.deleteFolder(path),
  renameFile: (path, newName) => fileActions.renameFile(path, newName),
  moveEntry: (src, dest) => fileActions.moveEntry(src, dest),
}
