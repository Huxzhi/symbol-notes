import type { EditorView } from '@codemirror/view'
import type { OutLink } from '../lib/outLinksField'
import type { Heading } from '../lib/headingsField'

// ── Workspace tree ──────────────────────────────────────────────────────────

export interface ViewState {
  type: string
  state: Record<string, unknown>
}

export interface WorkspaceSplit {
  type: 'split'
  id: string
  direction: 'horizontal' | 'vertical'
  children: WorkspaceNode[]
}

export interface WorkspaceTabs {
  type: 'tabs'
  id: string
  activeLeafId: string | null
  children: WorkspaceLeaf[]
}

export interface WorkspaceLeaf {
  type: 'leaf'
  id: string
  viewState: ViewState
  pinned: boolean
}

export type WorkspaceNode = WorkspaceSplit | WorkspaceTabs | WorkspaceLeaf

export interface SidebarSplit {
  id: string
  width: number
  collapsed: boolean
  children: WorkspaceNode[]
}

export interface WorkspaceRoot {
  left: SidebarSplit
  main: WorkspaceNode
  right: SidebarSplit
}

export interface WorkspaceLayout {
  id: string
  name: string
  root: WorkspaceRoot
  activeLeafId: string | null
}

// ── Theme ───────────────────────────────────────────────────────────────────

export type ThemeId = 'dark' | 'light' | 'nord'

// ── File cache ───────────────────────────────────────────────────────────────
// Single source of truth per path. Populated in two phases:
//   Phase 1 (FS scan): name/path/kind/parent/size/mtime/hash
//   Phase 2 (content index): frontmatter/outLinks/tags/aliases

export interface FileMeta {
  name: string
  path: string
  kind: 'file' | 'directory'
  parent: string | null
  size: number
  mtime: number
  hash: string           // djb2 content hash; '' until content is indexed
  frontmatter: Record<string, unknown>
  outLinks: string[]
  tags: string[]
  aliases: string[]
}

export interface CacheState {
  files: Record<string, FileMeta>
  backlinkMap: Record<string, string[]>
  tagMap: Record<string, string[]>
}

// ── Settings ─────────────────────────────────────────────────────────────────

export interface SettingsState {
  theme: ThemeId
  customCSS: string
  autoTimestamps: boolean
  showOtherFiles: boolean
}

// ── Workspace ─────────────────────────────────────────────────────────────────

export interface WorkspaceState {
  layouts: WorkspaceLayout[]
  activeLayoutId: string
}

// ── Runtime store (non-serializable + ephemeral UI) ───────────────────────────

export interface LeafRuntimeState {
  cmView: EditorView | null
  isDirty: boolean
  outLinks: OutLink[]
  headings: Heading[]
}

export type FileOp =
  | { type: 'create-file' | 'create-folder'; prefix: string }
  | { type: 'rename'; path: string }
  | null

export interface RuntimeState {
  rootHandle: FileSystemDirectoryHandle | null
  leafInstances: Record<string, LeafRuntimeState>
  fileOp: FileOp
  isIndexing: boolean
  showSettings: boolean
}

// ── View registry ─────────────────────────────────────────────────────────────

export interface ViewComponentProps {
  leafId: string
  isActive: boolean
  viewState: Record<string, unknown>
}
