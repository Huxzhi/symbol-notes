import { get, set } from 'idb-keyval'
import { batch } from 'solid-js'
import { globalStore, setGlobalStore } from '../stores/globalStore'
import { runtimeStore, setRuntimeStore } from '../stores/runtimeStore'
import { knowledgeActions } from './knowledgeActions'
import { clearEmbedUrlCache } from '../lib/embedExtension'
import { parseFrontmatter, formatTimestamp, setFrontmatterField } from '../lib/parseFrontmatter'
import type { FileNode } from '../stores/types'

declare global {
  interface Window {
    showDirectoryPicker: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
  }
  interface FileSystemDirectoryHandle {
    requestPermission: (options?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>
  }
}

const DB_KEY = 'rootHandle'

async function buildTree(
  dirHandle: FileSystemDirectoryHandle,
  path = '',
): Promise<FileNode[]> {
  const nodes: FileNode[] = []
  for await (const [name, handle] of dirHandle.entries()) {
    if (name.startsWith('.')) continue
    const nodePath = path ? `${path}/${name}` : name
    if (handle.kind === 'directory') {
      const children = await buildTree(handle as FileSystemDirectoryHandle, nodePath)
      nodes.push({ name, path: nodePath, kind: 'directory', children })
    } else {
      nodes.push({ name, path: nodePath, kind: 'file' })
    }
  }
  return nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

async function getFileHandle(path: string): Promise<FileSystemFileHandle> {
  const { rootHandle } = runtimeStore
  if (!rootHandle) throw new Error('No root directory')
  const parts = path.split('/')
  let dir: FileSystemDirectoryHandle = rootHandle
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i])
  }
  return dir.getFileHandle(parts[parts.length - 1])
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceWikiLinks(content: string, oldPath: string, newPath: string): string {
  const oldBase = oldPath.replace(/\.md$/, '')
  const newBase = newPath.replace(/\.md$/, '')
  const oldStem = oldBase.split('/').pop()!
  const newStem = newBase.split('/').pop()!
  const pairs: [string, string][] = []
  if (oldBase !== oldStem) {
    pairs.push([`${oldBase}.md`, `${newBase}.md`])
    pairs.push([oldBase, newBase])
  }
  pairs.push([`${oldStem}.md`, `${newStem}.md`])
  pairs.push([oldStem, newStem])
  let result = content
  for (const [old, next] of pairs) {
    result = result.replace(
      new RegExp(`\\[\\[${escapeRegex(old)}(\\|[^\\]]*)?\\]\\]`, 'g'),
      (_, alias) => `[[${next}${alias ?? ''}]]`,
    )
  }
  return result
}

async function updateBacklinks(backlinks: string[], oldPath: string, newPath: string): Promise<void> {
  for (const bPath of backlinks) {
    try {
      const content = await fsActions.readFile(bPath)
      const updated = replaceWikiLinks(content, oldPath, newPath)
      if (updated !== content) {
        await fsActions.writeFile(bPath, updated)
        await knowledgeActions.reindexFile(bPath, updated)
      }
    } catch { /* skip unreadable files */ }
  }
}

export const fsActions = {
  async openDirectory(): Promise<void> {
    clearEmbedUrlCache()
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
    await set(DB_KEY, handle)
    batch(() => {
      setRuntimeStore('rootHandle', handle)
      setGlobalStore('fs', 'tree', [])
    })
    // Import lazily to avoid circular dependency at module load time
    const { workspaceActions } = await import('./workspaceActions')
    workspaceActions.clearAllLeaves()
    setGlobalStore('fs', 'tree', await buildTree(handle))
    await knowledgeActions.scanDirectory()
  },

  async restoreDirectory(): Promise<void> {
    const handle = await get<FileSystemDirectoryHandle>(DB_KEY)
    if (!handle) return
    try {
      const perm = await handle.requestPermission({ mode: 'readwrite' })
      if (perm !== 'granted') return
      setRuntimeStore('rootHandle', handle)
      setGlobalStore('fs', 'tree', await buildTree(handle))
      await knowledgeActions.scanDirectory()
    } catch { /* handle invalidated */ }
  },

  async createFile(name: string): Promise<string | null> {
    const { rootHandle } = runtimeStore
    if (!rootHandle) return null
    const parts = name.includes('/') ? name.split('/') : [name]
    const fileName = parts.pop()!
    const finalName = fileName.endsWith('.md') ? fileName : `${fileName}.md`
    let dir = rootHandle
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: true })
    }
    await dir.getFileHandle(finalName, { create: true })
    const path = parts.length > 0 ? `${parts.join('/')}/${finalName}` : finalName
    setGlobalStore('fs', 'tree', await buildTree(rootHandle))
    return path
  },

  async createDirectory(name: string): Promise<void> {
    const { rootHandle } = runtimeStore
    if (!rootHandle) return
    const parts = name.split('/')
    let dir = rootHandle
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: true })
    }
    setGlobalStore('fs', 'tree', await buildTree(rootHandle))
  },

  async renameFile(oldPath: string, newName: string): Promise<void> {
    const { rootHandle } = runtimeStore
    if (!rootHandle) return
    const dir = oldPath.includes('/')
      ? oldPath.slice(0, oldPath.lastIndexOf('/'))
      : ''
    const finalName = newName.endsWith('.md') ? newName : `${newName}.md`
    const newPath = dir ? `${dir}/${finalName}` : finalName

    const oldContent = await fsActions.readFile(oldPath)
    let dirHandle: FileSystemDirectoryHandle = rootHandle
    if (dir) {
      for (const part of dir.split('/')) {
        dirHandle = await dirHandle.getDirectoryHandle(part)
      }
    }
    const newHandle = await dirHandle.getFileHandle(finalName, { create: true })
    const writable = await newHandle.createWritable()
    await writable.write(oldContent)
    await writable.close()
    await dirHandle.removeEntry(oldPath.split('/').pop()!)

    const backlinks = globalStore.knowledge.backlinkMap[oldPath] ?? []
    knowledgeActions.removeFileMeta(oldPath)
    const { workspaceActions } = await import('./workspaceActions')
    workspaceActions.renameLeafPath(oldPath, newPath)
    setGlobalStore('fs', 'tree', await buildTree(rootHandle))
    await knowledgeActions.reindexFile(newPath, oldContent)
    await updateBacklinks(backlinks, oldPath, newPath)
  },

  async deleteFile(path: string): Promise<void> {
    const { rootHandle } = runtimeStore
    if (!rootHandle) return
    const parts = path.split('/')
    const name = parts.pop()!
    let dir: FileSystemDirectoryHandle = rootHandle
    for (const part of parts) dir = await dir.getDirectoryHandle(part)
    await dir.removeEntry(name)
    knowledgeActions.removeFileMeta(path)
    setGlobalStore('fs', 'tree', await buildTree(rootHandle))
  },

  async writeFile(path: string, content: string): Promise<void> {
    const handle = await getFileHandle(path)
    const writable = await handle.createWritable()
    await writable.write(content)
    await writable.close()
  },

  async readFile(path: string): Promise<string> {
    const handle = await getFileHandle(path)
    const file = await handle.getFile()
    return file.text()
  },

  async loadFileContent(path: string): Promise<string> {
    const handle = await getFileHandle(path)
    const file = await handle.getFile()
    let content = await file.text()
    if (globalStore.workspace.autoTimestamps) {
      const { frontmatter } = parseFrontmatter(content)
      const ts = formatTimestamp(file.lastModified)
      let updated = content
      if (!frontmatter.created) updated = setFrontmatterField(updated, 'created', ts)
      if (!frontmatter.updated) updated = setFrontmatterField(updated, 'updated', ts)
      if (updated !== content) {
        const writable = await handle.createWritable()
        await writable.write(updated)
        await writable.close()
        content = updated
      }
    }
    return content
  },
}
