import { createStore } from 'solid-js/store'

export interface FileNode {
  name: string
  path: string
  kind: 'file' | 'directory'
  children?: FileNode[]
}

export interface FileSystemState {
  rootHandle: FileSystemDirectoryHandle | null
  tree: FileNode[]
  activeFilePath: string | null
  openFilePaths: string[]
}

const [fileSystemStore, setFileSystemStore] = createStore<FileSystemState>({
  rootHandle: null,
  tree: [],
  activeFilePath: null,
  openFilePaths: [],
})

export { fileSystemStore, setFileSystemStore }
