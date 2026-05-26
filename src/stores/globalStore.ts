import { createStore } from 'solid-js/store'
import { loadFromStorage } from '../lib/localStorage'
import type {
  GlobalState, SettingsState, ThemeId, WorkspaceLayout, WorkspaceLeaf,
  WorkspaceNode, WorkspaceRoot,
} from './types'

export const ROOT_TABS_ID = 'root-tabs'
export const DEFAULT_LAYOUT_ID = 'default'

const initialLayout: WorkspaceLayout = {
  id: DEFAULT_LAYOUT_ID,
  name: '默认',
  root: {
    left: {
      id: 'left-root',
      width: 190,
      collapsed: false,
      children: [{
        type: 'tabs',
        id: 'left-tabs',
        activeLeafId: 'leaf-files',
        children: [
          { type: 'leaf', id: 'leaf-files', viewState: { type: 'files', state: {} }, pinned: false },
          { type: 'leaf', id: 'leaf-calendar-panel', viewState: { type: 'calendar-panel', state: {} }, pinned: false },
        ],
      }],
    },
    main: { type: 'tabs', id: ROOT_TABS_ID, activeLeafId: null, children: [] },
    right: {
      id: 'right-root',
      width: 200,
      collapsed: false,
      children: [{
        type: 'tabs',
        id: 'right-tabs',
        activeLeafId: 'leaf-links',
        children: [
          { type: 'leaf', id: 'leaf-links',   viewState: { type: 'links',   state: {} }, pinned: false },
          { type: 'leaf', id: 'leaf-outline', viewState: { type: 'outline', state: {} }, pinned: false },
          { type: 'leaf', id: 'leaf-tags',    viewState: { type: 'tags',    state: {} }, pinned: false },
        ],
      }],
    },
  },
  activeLeafId: null,
}

const savedWs = loadFromStorage<{ layouts: WorkspaceLayout[]; activeLayoutId: string }>(
  'sn-workspace',
  { layouts: [initialLayout], activeLayoutId: DEFAULT_LAYOUT_ID },
  (v) =>
    typeof v === 'object' &&
    v !== null &&
    Array.isArray((v as Record<string, unknown>).layouts) &&
    typeof (v as Record<string, unknown>).activeLayoutId === 'string',
)

const savedSettings = loadFromStorage<SettingsState>('sn-settings', {
  theme: 'dark',
  customCSS: '',
  autoTimestamps: true,
  showOtherFiles: true,
})

const [globalStore, setGlobalStore] = createStore<GlobalState>({
  cache: {
    files: {},
    backlinkMap: {},
    tagMap: {},
  },
  workspace: {
    layouts: savedWs.layouts,
    activeLayoutId: savedWs.activeLayoutId,
  },
  settings: savedSettings,
})

export function activeLayout(): WorkspaceLayout {
  return globalStore.workspace.layouts.find(
    l => l.id === globalStore.workspace.activeLayoutId,
  )!
}

export function activeRoot(): WorkspaceRoot {
  return activeLayout().root
}

export function findLeafInTree(
  node: WorkspaceNode,
  leafId: string,
): WorkspaceLeaf | null {
  if (node.type === 'leaf') return node.id === leafId ? node : null
  if (node.type === 'tabs') return node.children.find(l => l.id === leafId) ?? null
  for (const child of node.children) {
    const found = findLeafInTree(child, leafId)
    if (found) return found
  }
  return null
}

export function findLeafInRoot(
  root: WorkspaceRoot,
  leafId: string,
): WorkspaceLeaf | null {
  for (const child of root.left.children) {
    const found = findLeafInTree(child, leafId)
    if (found) return found
  }
  const mainFound = findLeafInTree(root.main, leafId)
  if (mainFound) return mainFound
  for (const child of root.right.children) {
    const found = findLeafInTree(child, leafId)
    if (found) return found
  }
  return null
}

export function activeFilePath(): string | null {
  const layout = activeLayout()
  if (!layout.activeLeafId) return null
  const leaf = findLeafInTree(layout.root.main, layout.activeLeafId)
  return (leaf?.viewState.state.file as string | undefined) ?? null
}

export { globalStore, setGlobalStore }

// Alias for consumers that imported ThemeId from here indirectly
export type { ThemeId }
