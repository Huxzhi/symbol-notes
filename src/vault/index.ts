// vault 公共门面:字节 + files 状态 + 文件系统访问。
// 其余职责已拆为兄弟模块:metadata/(解析+派生索引)、fileManager/(写操作)、
// loader/(扫描+生命周期)、config/(vault 配置)。
export { vaultStore, setVaultStore, vaultFs, setVaultFs, isIndexing } from './store'
export {
  getFile,
  getFileMtime,
  initFileIO,
  invalidateFile,
  isReady,
  readFile,
  writeFile,
} from './fs/io'
