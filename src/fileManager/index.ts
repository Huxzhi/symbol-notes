// fileManager 公共门面:链接感知的写操作(落盘 → 增量索引 → 改反链)。
export {
  fileActions,
  reindexFile,
  removeVaultEntry,
  remapFileLink,
} from './fileActions'
