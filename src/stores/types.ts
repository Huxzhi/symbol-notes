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

// Sidebar container (not in WorkspaceNode union — carries width/collapsed)
export interface SidebarSplit {
  id: string
  width: number
  collapsed: boolean
  children: WorkspaceNode[]  // flat list of tabs groups (stacked vertically)
}

// Root of the entire workspace tree
export interface WorkspaceRoot {
  left: SidebarSplit
  main: WorkspaceNode
  right: SidebarSplit
}

// One switchable workspace snapshot
export interface WorkspaceLayout {
  id: string
  name: string
  root: WorkspaceRoot
  activeLeafId: string | null
}

// ── Theme ───────────────────────────────────────────────────────────────────

export type ThemeId = 'dark' | 'light' | 'nord'

// ── File system ─────────────────────────────────────────────────────────────

export interface FileMapEntry {
  name: string
  path: string
  kind: 'file' | 'directory'
  parent: string | null
  size?: number
  mtime?: number
}

// ── Knowledge ───────────────────────────────────────────────────────────────

export interface FileMetadata {
  path: string
  frontmatter: Record<string, unknown>
  outLinks: string[]
  tags: string[]
  aliases: string[]
}

// ── Global store shape ──────────────────────────────────────────────────────

export interface FsState {
  fileMap: Record<string, FileMapEntry>
}

export interface KnowledgeState {
  index: Record<string, FileMetadata>
  backlinkMap: Record<string, string[]>
  tagMap: Record<string, string[]>
  isIndexing: boolean
}

export interface WorkspaceState {
  layouts: WorkspaceLayout[]
  activeLayoutId: string
  theme: ThemeId
  customCSS: string
  showSettings: boolean
  autoTimestamps: boolean
  showOtherFiles: boolean
}

export interface GlobalState {
  fs: FsState
  knowledge: KnowledgeState
  workspace: WorkspaceState
}

// ── Runtime store shape (non-serializable) ──────────────────────────────────

export interface LeafRuntimeState {
  cmView: EditorView | null
  isDirty: boolean
  outLinks: OutLink[]
  headings: Heading[]
}

export interface RuntimeState {
  rootHandle: FileSystemDirectoryHandle | null
  leafInstances: Record<string, LeafRuntimeState>
}

// ── View registry ───────────────────────────────────────────────────────────

export interface ViewComponentProps {
  leafId: string
  isActive: boolean
  viewState: Record<string, unknown>
}
