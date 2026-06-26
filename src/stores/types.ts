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

/** 一条 wiki 链接的本地事实（只关于所在文件自身，不存 resolve 后的 path）。 */
export interface WikiLinkInfo {
  target: string        // base + .md 归一（已剥离 anchor），== 喂索引的目标名
  alias?: string        // [[目标|别名]]
  anchor?: string       // [[目标#标题]] 的 # 后半段
  headingPath: string[] // 所属 ## 标题路径，如 ["实验记录","计划"]
  lineTags: string[]    // 与链接同一行的 #标签（不含 #）
  from: number          // 链接在本文件中的起始 offset
  to: number            // 结束 offset
}

/** 结构树节点（纯结构，无 stat）。fileTree 是结构的唯一真实来源，扫描时构建；
 *  size/mtime 等 stat 归扁平的 fileMeta。 */
export interface TreeNode {
  name: string
  path: string
  kind: 'file' | 'directory'
  parent: string | null
  children?: TreeNode[]   // 仅 directory
}

/** 文件身份 + stat(vault 拥有)。扫描即就位,内容编辑不动它 → 文件树不重渲染。 */
export interface FileEntry {
  name: string
  path: string
  kind: 'file' | 'directory'
  parent: string | null
  size: number
  mtime: number
  hash: string           // content hash (two-variant djb2, 64-bit); '' until indexed
}

/** 解析内容(metadata 拥有,path 键)。内容编辑/重命名时由 metadata 重算。 */
export interface FileCache {
  frontmatter: Record<string, unknown>
  outLinks: WikiLinkInfo[]
  etags: string[]
  tags: string[]
  aliases: string[]
  created: string        // YYYY-MM-DD: frontmatter.created → mtime (never null)
  updated: string | null // YYYY-MM-DD: frontmatter.updated → null if absent
  dated: string          // YYYY-MM-DD: frontmatter.dated → created (never null)
  lists: ListItem[]      // 全部列表项；task===true 为任务子集
}

/** 合并视图:需要同时读 stat 与解析内容的消费方用(经 getFile(path) 取)。 */
export type FileMeta = FileEntry & FileCache

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

/** vault 拥有的状态:fileMap(仅身份+stat)。 */
export interface VaultState {
  files: Record<string, FileEntry>
}

/** metadata 拥有的状态:每文件解析内容 + 从内容派生的跨文件索引。 */
export interface MetadataState {
  /** path → 解析内容(frontmatter/outLinks/tags/lists…)。 */
  cache: Record<string, FileCache>
  /** src path → 解析后的正向目标路径(去重)。反向链接的真实来源。 */
  resolvedMap: Record<string, string[]>
  backlinkMap: Record<string, string[]>
  unresolvedMap: Record<string, string[]>
  tagMap: Record<string, string[]>
  taskMap: Record<string, ListItem[]>
  /** 按日期(YYYY-MM-DD)增量维护的日历聚合，单文件改动只动受影响日期。 */
  calendarByDate: Record<string, DateBucket>
  /** 进行中的解析/索引任务数(>0 即后台忙)。初始加载与单文件 reindex 都计数。 */
  inProgressTaskCount: number
  /** 首次完整 parse+index 完成后置 true(此后恒为 true)。 */
  initialized: boolean
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

/** 主题三件套：落 .symbol-notes/theme.json（随 vault）。 */
export type ThemeSettings = Pick<SettingsState, 'theme' | 'customThemes' | 'customCSS'>
/** 非主题配置：落 .symbol-notes/settings.json。 */
export type VaultSettings = Pick<SettingsState, 'pluginStates' | 'autoTimestamps' | 'showOtherFiles'>

// ── Workspace ─────────────────────────────────────────────────────────────────

export interface WorkspaceState {
  layouts: Record<string, WorkspaceLayout>
  activeLayoutId: string
}


// ── Runtime store (non-serializable + ephemeral UI) ───────────────────────────

/** 打开文件后在编辑器里精确定位的请求（一次性消费）。 */
export type RevealRequest =
  | { kind: 'wikilink'; targetStem: string; headingPath?: string[] } // 在源文档里找 [[focus]]
  | { kind: 'heading'; text: string }                               // 在目标文档里找 ## 标题

export interface LeafRuntimeState {
  cmView: EditorView | null
  isDirty: boolean
  outLinks: OutLink[]
  headings: Heading[]
  history?: string[]      // 内存中的文件历史（不持久化）；oldest→newest
  historyIndex?: number   // 当前在 history 中的位置；空时缺省视为 -1
  pendingReveal?: RevealRequest | null  // 编辑器挂载/激活后消费一次
}


// ── View registry ─────────────────────────────────────────────────────────────

export interface ViewComponentProps {
  leafId: string
  isActive: boolean
  viewState: Record<string, unknown>
}
