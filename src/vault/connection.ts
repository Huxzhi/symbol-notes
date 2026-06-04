import { clearEmbedUrlCache } from '../lib/cm6/embedExtension'
import { LocalAdapter } from '../services/fs/LocalAdapter'
import { initFileIO } from './io'
import { setVaultFs } from './state'

export async function openVault(): Promise<void> {
  clearEmbedUrlCache()
  const adapter = await LocalAdapter.open()
  initFileIO(adapter)
  setVaultFs(adapter)
  const { workspaceActions } = await import('../stores/workspaceStore')
  workspaceActions.clearAllLeaves()
  const { scanAndIndex } = await import('./scan')
  await scanAndIndex()
}

export async function restoreVault(): Promise<void> {
  const adapter = await LocalAdapter.restore()
  if (!adapter) return
  initFileIO(adapter)
  setVaultFs(adapter)
  const { scanAndIndex } = await import('./scan')
  await scanAndIndex()
}
