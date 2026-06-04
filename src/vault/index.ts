// State & connection signal
export { vaultFs, setVaultFs, vaultStore, setVaultStore, vaultActions, getStemIndex, invalidateStemIndex } from './state'

// Scan
export { isIndexing } from './scan'

// File CRUD
export { fileActions } from './actions'

// Connection lifecycle
export { openVault, restoreVault } from './connection'

// Low-level IO exposed for components that need direct access
// (EditorViewer conflict detection + auto-timestamps, ImageViewer, embedExtension)
export { readFile, writeFile, getFileMtime, invalidateFile, getFile } from './io'
