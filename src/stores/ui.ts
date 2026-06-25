// 统一的全局命令式 overlay 层:toast / confirm 弹窗 / 冲突弹窗。
// 这些是「任意处(含领域层 loader)可触发、根部单宿主渲染」的展示态,故必须是全局单例
//(无法塞进某个组件)。命令走 ui.*();宿主组件读 *State 响应式代理。
import { createSignal } from 'solid-js'
import { createStore } from 'solid-js/store'

// ── Toasts ──────────────────────────────────────────────────────────────────

export type ToastLevel = 'info' | 'error' | 'warn'
export interface Toast {
  id: number
  msg: string
  level: ToastLevel
  requireClick: boolean
  duration: number
}

const [toastState, setToastState] = createStore<{ items: Toast[] }>({ items: [] })
let _id = 0

function toast(
  msg: string,
  opts?: { level?: ToastLevel; requireClick?: boolean; duration?: number },
): number {
  const id = _id++
  const item: Toast = {
    id,
    msg,
    level: opts?.level ?? 'info',
    requireClick: opts?.requireClick ?? false,
    duration: opts?.duration ?? 3000,
  }
  setToastState('items', (prev) => [...prev, item])
  if (!item.requireClick) setTimeout(() => dismissToast(id), item.duration)
  return id
}

/** 更新已存在 toast 的文案（进度类常驻 toast）；id 不存在则忽略。 */
function updateToast(id: number, msg: string): void {
  setToastState('items', (t) => t.id === id, 'msg', msg)
}

function dismissToast(id: number): void {
  setToastState('items', (prev) => prev.filter((t) => t.id !== id))
}

function error(msg: string, opts?: { requireClick?: boolean; duration?: number }): void {
  toast(msg, { ...opts, level: 'error' })
}

function warn(msg: string, opts?: { requireClick?: boolean; duration?: number }): void {
  toast(msg, { ...opts, level: 'warn' })
}

// ── Confirm 弹窗 ───────────────────────────────────────────────────────────────

export interface ModalButton {
  label: string
  variant?: 'primary' | 'danger' | 'ghost'
  onClick: () => void
}
interface ModalState {
  open: boolean
  title: string
  message: string
  buttons: ModalButton[]
}

const [modalState, setModalState] = createStore<ModalState>({
  open: false,
  title: '',
  message: '',
  buttons: [],
})

function confirm(opts: Omit<ModalState, 'open'>): void {
  setModalState({ ...opts, open: true })
}
function closeConfirm(): void {
  setModalState('open', false)
}

// ── 冲突弹窗 ───────────────────────────────────────────────────────────────────

interface ConflictState {
  open: boolean
  filename: string
  editorContent: string
  diskContent: string
  onChoice: (choice: 'overwrite' | 'reload' | 'cancel') => void
}

const [conflictState, setConflictState] = createStore<ConflictState>({
  open: false,
  filename: '',
  editorContent: '',
  diskContent: '',
  onChoice: () => {},
})

function conflict(opts: Omit<ConflictState, 'open'>): void {
  setConflictState({ ...opts, open: true })
}
function closeConflict(): void {
  setConflictState('open', false)
}

// ── App 外壳:设置面板开关 ───────────────────────────────────────────────────
// 由设置 ribbon(模块级注册的 app 插件)切换、App 外壳渲染,故同属全局展示态。
const [settingsOpen, setSettingsOpen] = createSignal(false)

// 宿主组件读这些响应式代理(ConfirmModal / ToastContainer / ConflictModal / App)。
export { toastState, modalState, conflictState, settingsOpen }

// 任意处触发的命令式 API。
export const ui = {
  toast,
  updateToast,
  dismissToast,
  error,
  warn,
  confirm,
  closeConfirm,
  conflict,
  closeConflict,
  toggleSettings: () => setSettingsOpen((v) => !v),
  closeSettings: () => setSettingsOpen(false),
}
