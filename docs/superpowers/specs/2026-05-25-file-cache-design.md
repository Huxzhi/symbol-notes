# fileCache + fileMap 设计文档

**日期**: 2026-05-25
**状态**: 已批准

## 目标

1. 启动时由 `indexService` 直接扫描 vault，与 `fsActions` 解耦
2. GlobalStore 用扁平的 `fileMap` 替换递归 `fs.tree`，FilePanel 从中渲染层级视图
3. 通过 `fileStatCache`（size + mtime）在第二次加载时跳过未变化文件的内容读取

## 数据结构

### FileMapEntry（新增类型）

```ts
interface FileMapEntry {
  name: string
  path: string
  kind: 'file' | 'directory'
  parent: string | null   // 根目录下的条目为 null
}
```

### FsState（修改）

```ts
// 之前
interface FsState {
  tree: FileNode[]
}

// 之后
interface FsState {
  fileMap: Record<string, FileMapEntry>
}
```

FilePanel 从 `fileMap` 按 `parent` 字段推导层级，不需要递归 children。

### 三层缓存（fileCacheService）

```
fileCacheService
├── contentCache   Map<path, string>               内存，文件内容（已有）
├── fileStatMap    Map<path, {size, mtime, hash}>  内存 + IDB 'file-stat-cache'（新增）
└── metadataCache  IDB 'file-meta-cache'           hash → parsed fields（已有）
```

## 职责边界

| 模块 | 职责 |
|------|------|
| `fileCacheService` | 文件内容 I/O、fileStatMap（内存+IDB）、metadataCache（IDB） |
| `indexService` | 启动扫描、buildFileMap、stat 比对、知识索引构建、更新 globalStore |
| `fsActions` | 新建/删除/重命名文件和文件夹，直接更新 globalStore fileMap |
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
1. loadFileCache()
     从 IDB 热身 fileStatMap（path → {size, mtime, hash}）

2. buildFileMap(rootHandle)
     遍历目录树，对每个文件节点：
       handle.getFile() → size + mtime（不读内容）
       与 fileStatMap 比对 → 分为两组：
         unchanged: size+mtime 匹配 → 沿用缓存 hash
         changed:   不匹配或无缓存 → 需要读内容
     返回：
       fileMap: Record<string, FileMapEntry>
       unchanged: Map<path, hash>
       changed: string[]

3. setGlobalStore('fs', 'fileMap', fileMap)

4. Phase 1（逐文件，idle 调度）
     unchanged 文件：
       getCachedMeta(hash) → 写 knowledge.index（不读文件内容）
     changed 文件：
       readFile(path) → hashContent → 解析 frontmatter/links/tags
       → setFileStatEntry(path, {size, mtime, hash})
       → setCachedMeta(hash, parsed)
       → 写 knowledge.index

5. Phase 2
     buildBacklinkMap / buildTagMap → 更新 globalStore

6. pruneFileStatCache(activePaths)
   pruneCache(activeHashes)
```

**第二次加载效果**：绝大多数文件 stat 命中 + metadataCache 命中，全程不读文件内容。

## fileCacheService 新增 API

```ts
interface FileStatEntry {
  size: number
  mtime: number   // File.lastModified
  hash: string
}

export async function loadFileCache(): Promise<void>
export function getFileStatEntry(path: string): FileStatEntry | undefined
export async function setFileStatEntry(path: string, entry: FileStatEntry): Promise<void>
export function invalidateFileStat(path: string): void
export async function pruneFileStatCache(activePaths: Set<string>): Promise<void>
```

`writeFile` 末尾调用 `invalidateFileStat(path)`。

## fsActions 精简

**删除**：
- `readFile` / `writeFile` / `loadFileContent`（调用方直接用 fileCacheService）
- `buildTree`（移入 indexService，改名 buildFileMap）
- `openDirectory` / `restoreDirectory`（移入 appActions）

**保留，更新 fileMap 而非重建树**：

| 操作 | fileMap 变更 |
|------|-------------|
| `createFile(name)` | `setGlobalStore('fs', 'fileMap', name, entry)` 添加新条目 |
| `createDirectory(name)` | 添加目录条目 |
| `deleteFile(path)` | `invalidateFileStat(path)` + 删除 fileMap 条目 |
| `renameFile(oldPath, newName)` | `invalidateFileStat(oldPath)` + 删除旧条目 + 添加新条目 + `reindexFile(newPath)` |

不需要重建整个 fileMap，直接操作对应条目。

## IDB Store 结构

| Store 名称 | 键 | 值 | 用途 |
|-----------|----|----|------|
| `file-meta-cache` | hash (string) | CachedFields | 内容解析结果（已有） |
| `file-stat-cache` | path (string) | FileStatEntry | size/mtime/hash（新增） |

两个 store 均在 `symbol-notes` 数据库下。

## 边界情况

- **外部修改文件**：mtime 变化 → stat 不匹配 → 走 changed 分支，重新读取更新缓存
- **文件重命名**：旧路径 invalidate，新路径作为 changed 文件处理
- **文件删除**：`pruneFileStatCache(activePaths)` 清理 IDB 孤立条目
- **首次打开**：fileStatMap 为空，所有文件走 changed 分支，行为与现有逻辑相同
