// commands —— 命令层（L3）：文件 CRUD 写操作的唯一入口，编排 vault 原语 + metadata 派生。
// 落盘 + 改 fileMap/树（vault），增量索引派生委托 metadata（updateFile/removeFile）。
// 插件经 ctx.fileManager 间接调用（见 pluginRegistry）；不要绕过 fileActions 直接 setVaultStore。
export { fileActions } from './fileActions'
