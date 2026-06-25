// loader 公共门面:接入 vault 的加载编排(连接 / 配置编排 / 扫描+建索引 / 进度)。
// 依赖方向最高:用 vault 读盘、用 metadata 建索引。
export {
  openVault,
  restoreVault,
  scanPhase1,
  parseAndIndex,
  scanAndIndex,
  vaultConfigActions,
} from './lifecycle'
export type { ScanMid } from './lifecycle'
export { loadProgress } from './loadProgress'
