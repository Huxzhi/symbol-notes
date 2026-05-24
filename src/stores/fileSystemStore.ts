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
}

const [fileSystemStore, setFileSystemStore] = createStore<FileSystemState>({
  rootHandle: null,
  tree: [],
})

export { fileSystemStore, setFileSystemStore }
