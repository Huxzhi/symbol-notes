import { get, set } from 'idb-keyval'
import { Transaction } from '@codemirror/state'
import { fileSystemStore, setFileSystemStore, type FileNode } from '../stores/fileSystemStore'
import { editorStore, setEditorStore } from '../stores/editorStore'
import { batch } from 'solid-js'
import { knowledgeStore } from '../stores/knowledgeStore'
import { uiStore } from '../stores/uiStore'
import { reindexFile, scanDirectory, applyFileMeta, removeFileMeta } from './knowledgeService'
import { startBackgroundParsing } from './backgroundParser'
import { parseFrontmatter, formatTimestamp, setFrontmatterField } from '../lib/parseFrontmatter'

const DB_KEY = 'rootHandle'

export async function openDirectory(): Promise<void> {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
  await set(DB_KEY, handle)
  setFileSystemStore({ rootHandle: handle, activeFilePath: null, openFilePaths: [] })
  setFileSystemStore('tree', await buildTree(handle))
  await scanDirectory()
}

export async function restoreDirectory(): Promise<void> {
  const handle = await get<FileSystemDirectoryHandle>(DB_KEY)
  if (!handle) return
  try {
    const perm = await handle.requestPermission({ mode: 'readwrite' })
    if (perm !== 'granted') return
    setFileSystemStore({ rootHandle: handle })
    setFileSystemStore('tree', await buildTree(handle))
    await scanDirectory()
  } catch {
    // handle was invalidated (e.g. directory moved/deleted)
  }
}

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
    } else if (name.endsWith('.md')) {
      nodes.push({ name, path: nodePath, kind: 'file' })
    }
  }
  return nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

async function getFileHandle(path: string): Promise<FileSystemFileHandle> {
  const { rootHandle } = fileSystemStore
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

// Replace [[oldTarget]] / [[oldTarget|alias]] with [[newTarget]] / [[newTarget|alias]].
// Handles both bare stem (note) and fully-qualified (folder/note) forms, with or
// without the .md extension, so all four common variants are covered in one pass.
function replaceWikiLinks(content: string, oldPath: string, newPath: string): string {
  const oldBase = oldPath.replace(/\.md$/, '')   // folder/note
  const newBase = newPath.replace(/\.md$/, '')   // folder/newname
  const oldStem = oldBase.split('/').pop()!      // note
  const newStem = newBase.split('/').pop()!      // newname

  // Build (old, new) pairs from most-specific to least-specific so a longer
  // match is replaced before its substring can match again.
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

async function updateBacklinks(
  backlinks: string[],
  oldPath: string,
  newPath: string,
): Promise<void> {
  await Promise.all(
    backlinks.map(async (blPath) => {
      try {
        const handle = await getFileHandle(blPath)
        const content = await (await handle.getFile()).text()
        const updated = replaceWikiLinks(content, oldPath, newPath)
        if (updated === content) return
        const writable = await handle.createWritable()
        await writable.write(updated)
        await writable.close()
        await reindexFile(blPath, updated)
      } catch {
        // non-fatal: skip files we can't update
      }
    }),
  )
}

export async function createFile(name: string, dirPath?: string): Promise<void> {
  const { rootHandle } = fileSystemStore
  if (!rootHandle) return
  const filename = name.endsWith('.md') ? name : `${name}.md`
  let dir: FileSystemDirectoryHandle = rootHandle
  if (dirPath) {
    for (const part of dirPath.split('/')) {
      dir = await dir.getDirectoryHandle(part)
    }
  }
  const filePath = dirPath ? `${dirPath}/${filename}` : filename
  const handle = await dir.getFileHandle(filename, { create: true })
  const writable = await handle.createWritable()
  await writable.write('')
  await writable.close()
  setFileSystemStore('tree', await buildTree(rootHandle))
  await openFile(filePath)
}

export async function openFile(path: string): Promise<void> {
  const handle = await getFileHandle(path)
  const file = await handle.getFile()
  let content = await file.text()

  if (uiStore.autoTimestamps) {
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

  setEditorStore({ content, isDirty: false })
  setFileSystemStore('activeFilePath', path)
  if (!fileSystemStore.openFilePaths.includes(path)) {
    setFileSystemStore('openFilePaths', [...fileSystemStore.openFilePaths, path])
  }
  startBackgroundParsing(path)
}

export async function saveCurrentFile(): Promise<void> {
  const { rootHandle, activeFilePath } = fileSystemStore
  const { cmView } = editorStore
  if (!rootHandle || !activeFilePath || !cmView) return

  let newContent = cmView.state.doc.toString()

  if (uiStore.autoTimestamps) {
    const ts = formatTimestamp(Date.now())
    const withUpdated = setFrontmatterField(newContent, 'updated', ts)
    if (withUpdated !== newContent) {
      let from = 0
      while (from < newContent.length && from < withUpdated.length && newContent[from] === withUpdated[from]) from++
      let toOld = newContent.length, toNew = withUpdated.length
      while (toOld > from && toNew > from && newContent[toOld - 1] === withUpdated[toNew - 1]) { toOld--; toNew-- }
      cmView.dispatch({
        changes: { from, to: toOld, insert: withUpdated.slice(from, toNew) },
        annotations: Transaction.remote.of(true),
      })
      newContent = withUpdated
    }
  }

  const handle = await getFileHandle(activeFilePath)
  const writable = await handle.createWritable()
  await writable.write(newContent)
  await writable.close()

  setEditorStore({ content: newContent, isDirty: false })
  await reindexFile(activeFilePath, newContent)
}

export async function renameFile(oldPath: string, newBaseName: string): Promise<void> {
  const { rootHandle } = fileSystemStore
  if (!rootHandle) return

  const parts = oldPath.split('/')
  const oldFileName = parts[parts.length - 1]
  const dirParts = parts.slice(0, -1)
  const newFileName = newBaseName.endsWith('.md') ? newBaseName : `${newBaseName}.md`
  const newPath = dirParts.length > 0 ? `${dirParts.join('/')}/${newFileName}` : newFileName

  if (newPath === oldPath) return

  let parentDir: FileSystemDirectoryHandle = rootHandle
  for (const part of dirParts) {
    parentDir = await parentDir.getDirectoryHandle(part)
  }

  // Write new file — use editor content to preserve any unsaved changes
  const content = editorStore.content
  const newHandle = await parentDir.getFileHandle(newFileName, { create: true })
  const writable = await newHandle.createWritable()
  await writable.write(content)
  await writable.close()

  // Try to delete old file; file systems that don't support delete (WebDAV, S3)
  // will throw here — give the user a choice instead of silently failing.
  try {
    await parentDir.removeEntry(oldFileName)
  } catch {
    const proceed = window.confirm(
      `文件系统不支持删除操作。\n` +
      `已成功创建「${newFileName}」，但「${oldFileName}」无法自动删除。\n\n` +
      `是否切换到新文件？（旧文件将保留）`,
    )
    if (!proceed) {
      // Roll back: remove the newly created file and abort
      try { await parentDir.removeEntry(newFileName) } catch {}
      return
    }
  }

  // Capture backlinks before mutating the store (backlinkMap[oldPath] lists
  // every file that currently contains [[oldName]] / [[folder/oldName]]).
  const backlinks = [...(knowledgeStore.backlinkMap[oldPath] ?? [])]

  // Update open tab list and active path
  setFileSystemStore(
    'openFilePaths',
    fileSystemStore.openFilePaths.map(p => (p === oldPath ? newPath : p)),
  )
  setFileSystemStore('activeFilePath', newPath)
  setEditorStore({ isDirty: false })

  setFileSystemStore('tree', await buildTree(rootHandle))

  // Incremental knowledge index update — O(links+tags), no full vault scan.
  // Content hash is unchanged so the cache entry for the new path is a hit.
  const oldMeta = knowledgeStore.index[oldPath]
  if (oldMeta) {
    batch(() => {
      applyFileMeta({ ...oldMeta, path: newPath }, undefined)
      removeFileMeta(oldPath)
    })
  }

  // Prompt to update backlinks only when some exist
  if (backlinks.length > 0) {
    const preview = backlinks.slice(0, 5).map(p => `  • ${p}`).join('\n')
    const extra = backlinks.length > 5 ? `\n  ...还有 ${backlinks.length - 5} 个` : ''
    const confirmed = window.confirm(
      `有 ${backlinks.length} 个文件引用了「${oldFileName}」：\n${preview}${extra}\n\n` +
      `是否将链接同步更新为「${newFileName}」？`,
    )
    if (confirmed) {
      await updateBacklinks(backlinks, oldPath, newPath)
    }
  }
}

export function closeFile(path: string): void {
  const paths = fileSystemStore.openFilePaths.filter(p => p !== path)
  setFileSystemStore('openFilePaths', paths)
  if (fileSystemStore.activeFilePath === path) {
    const next = paths[paths.length - 1] ?? null
    setFileSystemStore('activeFilePath', next)
    if (next) openFile(next)
    else setEditorStore({ content: '', isDirty: false })
  }
}
