import { createStore } from 'solid-js/store'
import type { GlobalState, ThemeId, WorkspaceNode, WorkspaceLeaf } from './types'

function saved<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw !== null ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export const ROOT_TABS_ID = 'root-tabs'

const initialMain: WorkspaceNode = {
  type: 'tabs',
  id: ROOT_TABS_ID,
  activeLeafId: null,
  children: [],
}

const [globalStore, setGlobalStore] = createStore<GlobalState>({
  fs: {
    tree: [],
  },
  knowledge: {
    index: {},
    backlinkMap: {},
    tagMap: {},
    isIndexing: false,
  },
  workspace: {
    main: initialMain,
    left: {
      type: 'split',
      direction: 'horizontal',
      width: 190,
      collapsed: false,
      children: [],
    },
    right: {
      type: 'split',
      direction: 'horizontal',
      width: 200,
      collapsed: false,
      children: [],
    },
    activeLeafId: null,
    leftPanelView: 'files',
    rightPanelView: 'links',
    theme: saved<ThemeId>('sn-theme', 'dark'),
    customCSS: saved<string>('sn-customCSS', ''),
    showSettings: false,
    autoTimestamps: saved<boolean>('sn-autoTimestamps', true),
    showOtherFiles: saved<boolean>('sn-showOtherFiles', true),
  },
})

/** Derived: path of the active file leaf, or null. */
export function activeFilePath(): string | null {
  const { activeLeafId } = globalStore.workspace
  if (!activeLeafId) return null
  const leaf = findLeafInTree(globalStore.workspace.main, activeLeafId)
  return (leaf?.viewState.state.file as string | undefined) ?? null
}

/** Find a WorkspaceLeaf by id anywhere in the main tree. */
export function findLeafInTree(
  node: WorkspaceNode,
  leafId: string,
): WorkspaceLeaf | null {
  if (node.type === 'leaf') return node.id === leafId ? node : null
  if (node.type === 'tabs') {
    return node.children.find(l => l.id === leafId) ?? null
  }
  for (const child of node.children) {
    const found = findLeafInTree(child, leafId)
    if (found) return found
  }
  return null
}

export { globalStore, setGlobalStore }
