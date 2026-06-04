import { createSignal } from 'solid-js'

export type FileOp =
  | { type: 'create-file' | 'create-folder'; prefix: string }
  | { type: 'rename'; path: string }
  | null

export const [fileOp, setFileOp] = createSignal<FileOp>(null)

export function beginCreate(mode: 'file' | 'folder', prefix = ''): void {
  setFileOp({ type: mode === 'file' ? 'create-file' : 'create-folder', prefix })
}

export function beginRename(path: string): void {
  setFileOp({ type: 'rename', path })
}

export function cancelOp(): void {
  setFileOp(null)
}
