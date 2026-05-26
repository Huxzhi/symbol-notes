import { get, set } from 'idb-keyval'

declare global {
  interface Window {
    showDirectoryPicker: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
  }
  interface FileSystemDirectoryHandle {
    requestPermission: (options?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>
  }
}
import { setGlobalStore } from '../stores/globalStore'
import { runtimeStore, setRuntimeStore } from '../stores/runtimeStore'
import { clearContentCache } from '../services/fileCacheService'
import { clearEmbedUrlCache } from '../lib/embedExtension'
import type { ThemeId } from '../stores/types'

export const appActions = {
  async openVault(): Promise<void> {
    clearEmbedUrlCache()
    clearContentCache()
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
    await set('rootHandle', handle)
    setRuntimeStore('rootHandle', handle)
    const { workspaceActions } = await import('./workspaceActions')
    workspaceActions.clearAllLeaves()
    const { scanAndIndex } = await import('../services/indexService')
    await scanAndIndex()
  },

  async restoreVault(): Promise<void> {
    const handle = await get<FileSystemDirectoryHandle>('rootHandle')
    if (!handle) return
    try {
      const perm = await handle.requestPermission({ mode: 'readwrite' })
      if (perm !== 'granted') return
      clearContentCache()
      setRuntimeStore('rootHandle', handle)
      const { scanAndIndex } = await import('../services/indexService')
      await scanAndIndex()
    } catch { /* handle invalidated */ }
  },

  setTheme(theme: ThemeId): void {
    setGlobalStore('settings', 'theme', theme)
  },

  setCustomCSS(css: string): void {
    setGlobalStore('settings', 'customCSS', css)
  },

  toggleSettings(): void {
    setRuntimeStore('showSettings', v => !v)
  },

  setAutoTimestamps(value: boolean): void {
    setGlobalStore('settings', 'autoTimestamps', value)
  },

  setShowOtherFiles(value: boolean): void {
    setGlobalStore('settings', 'showOtherFiles', value)
  },

  isSettingsOpen(): boolean {
    return runtimeStore.showSettings
  },
}
