# Symbol Notes Phase 1 — Design Spec

**Date:** 2026-05-20  
**Scope:** 第一阶段 — 读取本地文件夹、解析 Markdown、渲染和编辑

---

## 1. 技术栈

| 层次 | 选择 |
|------|------|
| 框架 | SolidJS + TypeScript |
| 构建 | Vite + vite-plugin-pwa |
| 编辑器 | CodeMirror 6（@codemirror/view、@codemirror/state） |
| Markdown | @codemirror/lang-markdown + @codemirror/language-data |
| 主题 | 自定义深色 CodeMirror 主题（不使用 one-dark 包） |
| 样式 | 纯 Tailwind CSS |
| 存储 | File System Access API + idb-keyval（IndexedDB 持久化句柄） |
| Frontmatter | 自实现浏览器可运行的 YAML 子集解析器 |
| 图标 | Lucide |

---

## 2. 布局（Obsidian 风格）

```
┌──────┬──────────────┬────────────────────────────────┬─────────────┐
│      │              │ Tab 栏                          │             │
│      │              ├────────────────────────────────│             │
│Ribbon│  左侧边栏    │ Properties（内嵌文档顶部）      │  右侧边栏   │
│      │  文件树      │ ─────────────────────────────  │  链接/大纲  │
│      │  （可隐藏）  │ CodeMirror Live Preview 编辑区 │  /标签 tabs │
│      │              │                                │  （可隐藏） │
│      │              ├────────────────────────────────┴─────────────┤
│      │              │ 状态栏（字数、行列、保存状态）               │
└──────┴──────────────┴──────────────────────────────────────────────┘
```

- **Ribbon**：最左侧图标竖排栏（文件、搜索、图谱、设置）
- **左侧边栏**：可折叠文件树，当前文件高亮，显示嵌套目录
- **Tab 栏**：支持多文件同时打开，点击切换，可关闭
- **Properties 块**：内嵌在编辑区文档顶部，圆角卡片，字段行内可直接编辑，高度随字段数量自动撑开，可折叠，带"+ 添加字段"按钮
- **编辑区**：CodeMirror Live Preview（光标离开后内联渲染粗体/斜体/链接），`[[wikilink]]` 蓝色虚线下划线高亮
- **右侧边栏**：可折叠，三个 tab — 链接（出链/入链）、大纲、标签
- **状态栏**：字数、段落数、行列位置、保存状态

---

## 3. 架构：Domain Stores

### 3.1 目录结构

```
src/
├── stores/
│   ├── fileSystemStore.ts
│   ├── editorStore.ts
│   └── knowledgeStore.ts
├── services/
│   ├── fileSystemService.ts
│   ├── frontmatterService.ts
│   └── knowledgeService.ts
├── components/
│   ├── Ribbon.tsx
│   ├── Sidebar.tsx
│   ├── TabBar.tsx
│   ├── PropertiesPanel.tsx
│   ├── Editor.tsx
│   ├── RightPanel.tsx
│   └── StatusBar.tsx
├── lib/
│   └── parseFrontmatter.ts
└── App.tsx
```

### 3.2 Store 结构

**`fileSystemStore`**
```ts
{
  rootHandle: FileSystemDirectoryHandle | null,
  tree: FileNode[],          // { name, path, kind: 'file'|'dir', children? }
  activeFilePath: string | null,
  openFilePaths: string[],   // Tab 栏已打开文件列表
}
```

**`editorStore`**
```ts
{
  content: string,           // 当前文件完整原始内容（含 frontmatter）
  isDirty: boolean,
  cmView: EditorView | null,
}
```

**`knowledgeStore`**
```ts
{
  index: Record<string, FileMetadata>,
  // FileMetadata: { path, frontmatter, outLinks: string[], tags: string[] }
  backlinkMap: Record<string, string[]>,
  // backlinkMap['A'] = ['B', 'C'] 表示 B、C 都 [[link]] 了 A
  tagMap: Record<string, string[]>,
  // tagMap['semiotics'] = ['index.md', 'symbols.md']
}
```

### 3.3 数据流

```
File System Access API
    ↓ fileSystemService.openDirectory()
fileSystemStore（tree, rootHandle）
    ↓ 用户点击文件
fileSystemService.readFile()
    ↓
editorStore.content（原始内容）
    ↓                        ↓
PropertiesPanel           Editor（CodeMirror）
frontmatterService.parse() 正文（去掉 frontmatter 块）
    ↓ 编辑
frontmatterService.serialize()
    ↓
fileSystemService.writeFile() ──→ knowledgeService.reindex(filePath)
                                         ↓
                                   knowledgeStore（增量更新）
                                         ↓
                                   RightPanel（出链/入链/标签）
```

---

## 4. 关键实现

### 4.1 Frontmatter 解析器（`lib/parseFrontmatter.ts`）

自实现，无外部依赖，支持：
- 字符串、数字、布尔值
- 数组（`[a, b]` 行内 或 `- item` 多行）
- 嵌套对象（一级）

接口：
```ts
parseFrontmatter(raw: string): { frontmatter: Record<string, unknown>, body: string }
serializeFrontmatter(data: Record<string, unknown>, body: string): string
```

### 4.2 CodeMirror 配置

```ts
extensions: [
  markdown({ codeLanguages: languages }),
  syntaxHighlighting(customDarkHighlightStyle),
  EditorView.theme({ /* 字体、行高、背景、光标 */ }),
  wikiLinkExtension(),   // 自定义 MatchDecorator，[[link]] 高亮
  EditorView.updateListener.of(onUpdate),  // 同步 isDirty
]
```

### 4.3 面板显隐

`App.tsx` 持有 `showLeft` / `showRight` 两个 signal，用 Tailwind `hidden` 类控制，`transition-all` 做折叠动画，不卸载 DOM 以保持 CodeMirror 实例存活。

### 4.4 IndexedDB 持久化

```ts
// 打开目录后
await set('rootHandle', directoryHandle)   // idb-keyval

// PWA 重新打开时
const handle = await get('rootHandle')
if (handle) await handle.requestPermission({ mode: 'readwrite' })
```

### 4.5 knowledgeStore 索引策略

- **初始化**：打开目录后全量扫描所有 `.md` 文件，解析 frontmatter 和 `[[wikilink]]`，构建完整 `index`、`backlinkMap`、`tagMap`
- **增量更新**：每次保存文件后，只重新解析该文件并更新对应条目，不重扫全库

---

## 5. 第一阶段成功标准

- [ ] 用户可选择本地文件夹，文件树正确展示嵌套结构
- [ ] 点击 `.md` 文件在 Tab 中打开，CodeMirror 加载内容
- [ ] Frontmatter 字段在 Properties 块中可读、可编辑、可增删
- [ ] 编辑内容后 Ctrl+S 写回原始文件，frontmatter 正确序列化
- [ ] 右侧面板正确显示出链、入链、标签
- [ ] 刷新 PWA 后自动恢复上次打开的目录（idb-keyval）
- [ ] 左右侧边栏可独立隐藏/显示

---

## 6. 不在第一阶段范围内

- 全文搜索
- 知识图谱可视化
- 插件系统
- 多窗口/分屏编辑
- 移动端适配
