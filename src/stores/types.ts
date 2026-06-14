import type { EditorView } from '@codemirror/view'
import type { OutLink } from '../lib/cm6/outLinksField'
import type { Heading } from '../lib/cm6/headingsField'
import type { CustomTheme, ThemeMode } from '../lib/theme'

export type { CustomTheme, ThemeMode }

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

export interface ListItem {
  text: string                    // 列表标记后、剥掉前导 token（复选框/信号字符）的正文；仍含 [k:: v]
  visual: string                  // text 再去掉 [k:: v] 内联字段后的纯展示文本
  line: number                    // 0-based 起始行
  lineCount: number               // 该列表项跨的物理行数（≥1）
  symbol: string                  // 列表标记原文：'-' / '*' / '+'，或有序 '1.' / '2.' / '1)'
  signifier: string | null        // 前导单个 ASCII 标点（* = ~ ! & …）；无则 null
  status: string | null           // 复选框字符 ' '/'x'/'X'/'/'/'>' …；非复选框为 null
  checked: boolean                // status === 'x' || status === 'X'
  task: boolean                   // status !== null
  fields: Record<string, string>  // [k:: v] 内联字段（key/val 均 trim）
  tags: string[]                  // 行内 #标签（不含 #）
}

// ── File cache ───────────────────────────────────────────────────────────────
// Single source of truth per path. Populated in two phases:
//   Phase 1 (FS scan): name/path/kind/parent/size/mtime/hash
//   Phase 2 (content index): frontmatter/outLinks/tags/aliases/created/updated/tasks

/** 结构树节点（stat 信息）。fileTree 是结构的唯一真实来源，扫描时构建。 */
export interface TreeNode {
  name: string
  path: string
  kind: 'file' | 'directory'
  parent: string | null
  size: number
  mtime: number
  children?: TreeNode[]   // 仅 directory
}

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
  etags: string[]
  tags: string[]
  aliases: string[]
  created: string        // YYYY-MM-DD: frontmatter.created → mtime (never null)
  updated: string | null // YYYY-MM-DD: frontmatter.updated → null if absent
  dated: string          // YYYY-MM-DD: frontmatter.dated → created (never null)
  lists: ListItem[]      // 全部列表项；task===true 为任务子集
}

/** 列表项 + 所属文件路径（日历/任务跨文件展示用）。 */
export type Task = ListItem & { path: string }

/** 某一天聚合的日历条目：dated/created/updated 存文件路径，tasks/entries 存带 path 的列表项。 */
export interface DateBucket {
  dated: string[]
  created: string[]
  updated: string[]
  tasks: Task[]
  entries: Task[]
}

export interface VaultState {
  files: Record<string, FileMeta>
  backlinkMap: Record<string, string[]>
  unresolvedMap: Record<string, string[]>
  tagMap: Record<string, string[]>
  taskMap: Record<string, ListItem[]>
  /** 按日期(YYYY-MM-DD)增量维护的日历聚合，单文件改动只动受影响日期。 */
  calendarByDate: Record<string, DateBucket>
}

// ── Settings ─────────────────────────────────────────────────────────────────

export interface SettingsState {
  theme: string                 // 预设或自定义主题 id
  customThemes: CustomTheme[]
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
  history?: string[]      // 内存中的文件历史（不持久化）；oldest→newest
  historyIndex?: number   // 当前在 history 中的位置；空时缺省视为 -1
}


// ── View registry ─────────────────────────────────────────────────────────────

export interface ViewComponentProps {
  leafId: string
  isActive: boolean
  viewState: Record<string, unknown>
}
