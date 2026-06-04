import type { EditorView } from '@codemirror/view'
import type { FileSystemAdapter } from '../services/fs/types'
import type { OutLink } from '../lib/cm6/outLinksField'
import type { Heading } from '../lib/cm6/headingsField'

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

// ── Task items ────────────────────────────────────────────────────────────────

export interface TaskItem {
  text: string                    // raw text after checkbox (includes [key::value])
  cleanText: string               // text with [key::value] removed
  checked: boolean                // status === 'x'
  status: string                  // single char: ' ' / 'x' / '/' / '>' / '-' etc.
  line: number                    // 0-based line number in file
  dueDate: string | null          // [due::YYYY-MM-DD] → dated fallback
  completedDate: string | null    // checked=true: [completion::...] → dated; checked=false: null
  fields: Record<string, string>  // all other [key::value] inline fields
}

// ── File cache ───────────────────────────────────────────────────────────────
// Single source of truth per path. Populated in two phases:
//   Phase 1 (FS scan): name/path/kind/parent/size/mtime/hash
//   Phase 2 (content index): frontmatter/outLinks/tags/aliases/created/updated/tasks

export interface FileMeta {
  name: string
  path: string
  kind: 'file' | 'directory'
  parent: string | null
  size: number
  mtime: number
  hash: string           // content hash (two-variant djb2, 64-bit); '' until indexed
  frontmatter: Record<string, unknown>
  outLinks: string[]
  tags: string[]
  aliases: string[]
  created: string        // YYYY-MM-DD: frontmatter.created → mtime (never null)
  updated: string | null // YYYY-MM-DD: frontmatter.updated → null if absent
  dated: string          // YYYY-MM-DD: frontmatter.dated → created (never null)
  tasks: TaskItem[]      // extracted task items, no path (implicit from record key)
}

export interface VaultState {
  files: Record<string, FileMeta>
  backlinkMap: Record<string, string[]>
  unresolvedMap: Record<string, string[]>
  tagMap: Record<string, string[]>
  taskMap: Record<string, TaskItem[]>
}

// ── Settings ─────────────────────────────────────────────────────────────────

export interface SettingsState {
  theme: ThemeId
  customCSS: string
  autoTimestamps: boolean
  showOtherFiles: boolean
  pluginStates: Record<string, boolean>
}

// ── Workspace ─────────────────────────────────────────────────────────────────

export interface WorkspaceState {
  layouts: Record<string, WorkspaceLayout>
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
  fs: FileSystemAdapter | null
  leafInstances: Record<string, LeafRuntimeState>
  fileOp: FileOp
  isIndexing: boolean
}

// ── View registry ─────────────────────────────────────────────────────────────

export interface ViewComponentProps {
  leafId: string
  isActive: boolean
  viewState: Record<string, unknown>
}
