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
import { setRuntimeStore } from '../stores/runtimeStore'
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
    setGlobalStore('workspace', 'theme', theme)
    localStorage.setItem('sn-theme', JSON.stringify(theme))
  },

  setCustomCSS(css: string): void {
    setGlobalStore('workspace', 'customCSS', css)
    localStorage.setItem('sn-customCSS', JSON.stringify(css))
  },

  toggleSettings(): void {
    setGlobalStore('workspace', 'showSettings', v => !v)
  },

  setAutoTimestamps(value: boolean): void {
    setGlobalStore('workspace', 'autoTimestamps', value)
    localStorage.setItem('sn-autoTimestamps', JSON.stringify(value))
  },

  setShowOtherFiles(value: boolean): void {
    setGlobalStore('workspace', 'showOtherFiles', value)
    localStorage.setItem('sn-showOtherFiles', JSON.stringify(value))
  },
}
