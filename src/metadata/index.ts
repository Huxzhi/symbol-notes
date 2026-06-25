// metadata 公共门面:解析缓存 + 派生索引。
// 链接解析 / stem·alias 索引 + 按文件名抽取日期。索引的增量维护(applyFile*/
// build*/removeFile*)是内部 API,由 fileManager / loader 直接 import 子模块使用。
export {
  buildLinkMaps,
  buildStemIndex,
  buildAliasIndex,
  resolveLink,
  getStemIndex,
  getAliasIndex,
  resolveNewFile,
} from './indexes/backlinks'
export { extractDateFromName } from './parse/extract'
