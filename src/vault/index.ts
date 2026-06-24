// vault 层公共门面（barrel）：只 re-export 各模块的公共 API，本身不含实现。
// 分层一览：
//   store        —— 单一真实来源（vaultStore）+ 连接句柄 + 扫描状态
//   fs/          —— 文件系统访问（port + LocalAdapter + io 缓存）
//   indexStorage —— IndexedDB 缓存（stat / 解析 meta）
//   parse/       —— 字节 → FileMeta 字段（纯逻辑）
//   indexes/     —— 跨文件派生索引（backlinks / tags / tasks / calendar）
//   scan         —— FS 扫描 + 后台批量解析管线
//   fileTree     —— 纯结构树
//   fileActions  —— 写操作编排（CRUD / reindex），唯一写入口
//   lifecycle    —— 接入 vault：连接 / 配置编排 / 扫描+建索引

// ── 单一真实来源状态（store） ───────────────────────────────────────────────────
export { vaultStore, setVaultStore, vaultFs, setVaultFs, isIndexing } from './store'

// ── 接入生命周期（连接 / 配置 / 扫描管线） ─────────────────────────────────────
export {
  openVault,
  restoreVault,
  scanPhase1,
  parseAndIndex,
  scanAndIndex,
  vaultConfigActions,
} from './lifecycle'
export type { ScanMid } from './lifecycle'

// ── 写操作（CRUD / reindex） ────────────────────────────────────────────────────
export {
  fileActions,
  reindexFile,
  removeVaultEntry,
  remapFileLink,
} from './fileActions'

// ── 文件系统 IO（供 EditorViewer / pluginRegistry / 测试等） ────────────────────
export {
  getFile,
  getFileMtime,
  initFileIO,
  invalidateFile,
  isReady,
  readFile,
  writeFile,
} from './fs/io'

// ── 链接解析与 stem/alias 索引 ─────────────────────────────────────────────────
export {
  buildLinkMaps,
  buildStemIndex,
  buildAliasIndex,
  resolveLink,
  getStemIndex,
  getAliasIndex,
  resolveNewFile,
} from './indexes/backlinks'

// ── 解析辅助（供外部按文件名推日期） ───────────────────────────────────────────
export { extractDateFromName } from './parse/extract'

// ── Vault 配置（供设置页读取状态） ─────────────────────────────────────────────
export { vaultConfigMeta } from './vaultConfig'
