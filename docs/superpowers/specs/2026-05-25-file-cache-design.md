# fileCache + fileMap 设计文档

**日期**: 2026-05-25
**状态**: 已批准

## 目标

1. 启动时由 `indexService` 直接扫描 vault，与 `fsActions` 解耦
2. GlobalStore 用扁平的 `fileMap` 替换递归 `fs.tree`，FilePanel 从中渲染层级视图
3. `fileMap` 条目带 `size?` / `mtime?`，兼作内存 stat 缓存；IDB 额外存 `hash`，第二次加载时跳过未变化文件的内容读取

## 数据结构

### FileMapEntry（新增类型）

```ts
interface FileMapEntry {
  name: string
  path: string
  kind: 'file' | 'directory'
  parent: string | null   // 根目录下的条目为 null
  size?: number           // 文件节点有值，目录节点无
  mtime?: number          // File.lastModified
}
```

FilePanel 按 `parent` 字段推导层级，不需要递归 children。
`size` / `mtime` 由 indexService 扫描时填入，无需单独维护内存 Map。

### FsState（修改）

```ts
// 之前
interface FsState { tree: FileNode[] }

// 之后
interface FsState { fileMap: Record<string, FileMapEntry> }
```

### 缓存结构

```
fileCacheService
├── contentCache   Map<path, string>          内存，文件内容（已有）
└── metadataCache  IDB 'file-meta-cache'      hash → parsed fields（已有）

IDB 'file-stat-cache'                         path → {size, mtime, hash}（新增）
  └─ 仅持久化用，启动时一次性加载为临时 Map，不作常驻内存镜像
     hash 不放入 fileMap（属于缓存关注点，非 UI 状态）
```

## 职责边界

| 模块 | 职责 |
|------|------|
| `fileCacheService` | 文件内容 I/O、IDB file-stat-cache 读写、metadataCache 读写 |
| `indexService` | 启动扫描（buildFileMap）、stat 比对、知识索引构建、更新 globalStore |
| `fsActions` | 新建/删除/重命名文件和文件夹，直接增删 globalStore fileMap 条目 |
| `appActions` | vault 打开/恢复（设置 runtimeStore.rootHandle，调用 indexService） |
| 调用方（EditorPane 等） | 直接调用 `fileCacheService` 的 `readFile` / `writeFile` |

## 启动流程（与 fsActions 无关）

```
App 启动
  → appActions.restoreVault()
      ├── 从 IDB 恢复 rootHandle → setRuntimeStore('rootHandle', handle)
      └── indexService.scanAndIndex()

用户手动打开目录
  → appActions.openVault()
      ├── showDirectoryPicker → handle → setRuntimeStore('rootHandle', handle)
      └── indexService.scanAndIndex()
```

## indexService.scanAndIndex() 完整流程

```
1. 从 IDB 'file-stat-cache' 加载为临时 Map idbStats (path → {size, mtime, hash})
   （仅在本次 scanAndIndex 内使用，不持久化为模块级变量）

2. buildFileMap(rootHandle, idbStats)
     遍历目录树，对每个文件节点：
       handle.getFile() → size + mtime（不读内容）
       与 idbStats 比对：
         unchanged: size+mtime 匹配 → 沿用 idbStats[path].hash
         changed:   不匹配或无缓存 → 需要读内容
     返回：
       fileMap: Record<string, FileMapEntry>   （含 size/mtime）
       unchanged: Map<path, hash>
       changed: string[]

3. setGlobalStore('fs', 'fileMap', fileMap)
   （fileMap 此后即为内存 stat 来源，FilePanel 可直接读取 size/mtime）

4. Phase 1（逐文件，idle 调度）
     unchanged 文件：
       getCachedMeta(hash) → 写 knowledge.index（不读文件内容）
     changed 文件：
       readFile(path) → hashContent → 解析 frontmatter/links/tags
       → setFileStatEntry(path, {size, mtime, hash})   写入 IDB
       → setCachedMeta(hash, parsed)
       → 写 knowledge.index

5. Phase 2
     buildBacklinkMap / buildTagMap → 更新 globalStore

6. pruneFileStatCache(activePaths)   清理 IDB 孤立条目
   pruneCache(activeHashes)
```

**第二次加载效果**：绝大多数文件 stat 命中 → 跳过 readFile，全程不读文件内容。

## fileCacheService 新增 API

```ts
// IDB file-stat-cache（无常驻内存镜像）
interface FileStatEntry { size: number; mtime: number; hash: string }

// 启动时一次性批量读取（返回值供 indexService 局部使用）
export async function loadAllFileStats(): Promise<Map<string, FileStatEntry>>

// changed 文件索引完成后写入 IDB
export async function setFileStatEntry(path: string, entry: FileStatEntry): Promise<void>

// 文件删除/重命名旧路径时从 IDB 移除
export async function deleteFileStatEntry(path: string): Promise<void>

// 全量扫描后清理孤立条目
export async function pruneFileStatCache(activePaths: Set<string>): Promise<void>
```

`writeFile` 末尾调用 `deleteFileStatEntry(path)`，确保下次扫描对该文件重新 stat。

## fsActions 精简

**删除**：
- `readFile` / `writeFile` / `loadFileContent`（调用方直接用 fileCacheService）
- `buildTree`（移入 indexService，改名 buildFileMap）
- `openDirectory` / `restoreDirectory`（移入 appActions）

**保留，直接操作 fileMap 条目**：

| 操作 | fileMap 变更 |
|------|-------------|
| `createFile(name)` | 添加新条目（size/mtime 暂不填，下次扫描补全） |
| `createDirectory(name)` | 添加目录条目 |
| `deleteFile(path)` | 删除 fileMap 条目 + `deleteFileStatEntry(path)` |
| `renameFile(oldPath, newName)` | 删除旧条目 + `deleteFileStatEntry(oldPath)` + 添加新条目 + `reindexFile(newPath)` |

## IDB Store 结构

| Store 名称 | 键 | 值 | 用途 |
|-----------|----|----|------|
| `file-meta-cache` | hash (string) | CachedFields | 内容解析结果（已有） |
| `file-stat-cache` | path (string) | FileStatEntry | size/mtime/hash（新增） |

## 边界情况

- **外部修改文件**：mtime 变化 → stat 不匹配 → 走 changed 分支，重新读取更新缓存
- **文件重命名**：旧路径删除 IDB 条目，新路径作为 changed 文件处理
- **文件删除**：`pruneFileStatCache(activePaths)` 兜底清理 IDB 孤立条目
- **首次打开**：idbStats 为空，所有文件走 changed 分支，行为与现有逻辑相同
