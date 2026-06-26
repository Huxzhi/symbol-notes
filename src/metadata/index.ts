// metadata 公共门面:解析缓存 + 派生索引。
// 链接解析 / uniqueFileLookup·alias 索引 + 按文件名抽取日期。索引的增量维护
// (applyFile*/build*/removeFile*)是内部 API,由 fileManager / loader 直接 import 子模块使用。
export {
  buildLinkMaps,
  buildAliasIndex,
  resolveLink,
  getAliasIndex,
  resolveNewFile,
} from './indexes/backlinks'
// 「文件名→文件」高速查找表(metadata 直接管理):自动补全 / 链接解析消歧。
export {
  uniqueFileLookup,
  buildUniqueFileLookup,
} from './uniqueFileLookup'
export { extractDateFromName } from './parse/extract'

// 派生索引的响应式 store(只读消费:服务 / 插件)。写入只走本层 indexes/*。
export { metadataStore } from './store'

// 每文件解析内容的读取 + 合并视图。
export { fileCache, getFile, allFiles } from './cache'
