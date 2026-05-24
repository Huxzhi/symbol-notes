import { batch } from 'solid-js'
import { uiStore, setUIStore, type Tab } from '../stores/uiStore'
import { editorStore, setEditorStore } from '../stores/editorStore'
import { getFileViewForExt, getView } from '../lib/viewRegistry'
import { writeFile } from './fileSystemService'

function generateId(): string {
  return crypto.randomUUID()
}

function getExt(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(dot).toLowerCase()
}

export function setActiveTab(id: string): void {
  setUIStore('activeTabId', id)
}

export function pinTab(id: string): void {
  setUIStore('tabs', id, 'pinned', true)
}

export function closeTab(id: string): void {
  const { tabOrder, activeTabId } = uiStore
  const idx = tabOrder.indexOf(id)
  const nextId = idx > 0 ? tabOrder[idx - 1] : (tabOrder[idx + 1] ?? null)
  const newTabs = { ...uiStore.tabs }
  delete newTabs[id]
  batch(() => {
    setUIStore('tabs', newTabs)
    setUIStore('tabOrder', tabOrder.filter(t => t !== id))
    if (activeTabId === id) setUIStore('activeTabId', nextId)
  })
  if (uiStore.activeTabId === null) {
    setEditorStore({ cmView: null, isDirty: false, outLinks: [], headings: [] })
  }
}

/**
 * Return the tab ID to use for the next openFile call.
 * - newTab=true → always create a fresh ID
 * - newTab=false → reuse active tab if it is an unpinned file tab (preview replacement)
 */
function getLeaf(newTab: boolean): { id: string; isNew: boolean } {
  if (newTab) return { id: generateId(), isNew: true }
  const { activeTabId, tabs } = uiStore
  if (activeTabId) {
    const tab = tabs[activeTabId]
    if (tab && tab.path !== undefined && !tab.pinned) {
      return { id: activeTabId, isNew: false }
    }
  }
  return { id: generateId(), isNew: true }
}

/**
 * Open a file in the workspace.
 * - If already open in a tab, activate that tab.
 * - If the active tab is an unpinned file tab, replace it (preview mode).
 * - Otherwise open a new tab.
 */
export async function openFile(
  path: string,
  opts: { newTab?: boolean; pin?: boolean } = {},
): Promise<void> {
  const ext = getExt(path)
  const def = getFileViewForExt(ext)
  if (!def) return

  // Already open → just activate
  for (const [id, tab] of Object.entries(uiStore.tabs)) {
    if (tab.path === path) {
      setActiveTab(id)
      return
    }
  }

  const { id, isNew } = getLeaf(opts.newTab ?? false)

  if (!isNew) {
    // Preview replacement: save dirty content before switching
    if (editorStore.isDirty && editorStore.cmView) {
      const content = editorStore.cmView.state.doc.toString()
      const oldPath = uiStore.tabs[id]?.path
      if (oldPath) await writeFile(oldPath, content)
      setEditorStore('isDirty', false)
    }
    batch(() => {
      setUIStore('tabs', id, 'path', path)
      setUIStore('tabs', id, 'type', def.type)
    })
  } else {
    const tab: Tab = { id, type: def.type, path, pinned: opts.pin ?? false }
    batch(() => {
      setUIStore('tabs', id, tab)
      setUIStore('tabOrder', [...uiStore.tabOrder, id])
    })
  }

  setActiveTab(id)
}

/**
 * Open a plugin page tab (e.g. 'calendar').
 * If already open, activates it. Page tabs are always pinned.
 */
export function openPage(type: string): void {
  const def = getView(type)
  if (!def || def.kind !== 'page') return

  for (const [id, tab] of Object.entries(uiStore.tabs)) {
    if (tab.type === type) {
      setActiveTab(id)
      return
    }
  }

  const id = generateId()
  const tab: Tab = { id, type, pinned: true }
  batch(() => {
    setUIStore('tabs', id, tab)
    setUIStore('tabOrder', [...uiStore.tabOrder, id])
  })
  setActiveTab(id)
}
