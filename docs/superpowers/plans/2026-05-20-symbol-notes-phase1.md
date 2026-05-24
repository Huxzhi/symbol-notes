---
created: 2026-05-20 22:40
updated: 2026-05-20 22:40
---

# Symbol Notes Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建基于 Obsidian 布局的本地 Markdown 知识库 PWA，支持目录选取、文件树、frontmatter 编辑、CodeMirror Live Preview 编辑、出链/入链知识图谱属性面板。

**Architecture:** 三个 SolidJS domain store（fileSystemStore / editorStore / knowledgeStore）+ service 函数层处理副作用。Frontmatter 解析器自实现（无外部 YAML 依赖），CodeMirror 6 做 Live Preview 内联渲染。

**Tech Stack:** SolidJS 1.x + TypeScript + Vite + vite-plugin-pwa + Tailwind CSS v4 + CodeMirror 6 + idb-keyval + Lucide Solid + Vitest

---

## 文件结构总览

```
symbol-notes/
├── public/
│   ├── icon-192.png          # PWA 图标（占位，需替换）
│   └── icon-512.png
├── src/
│   ├── lib/
│   │   ├── parseFrontmatter.ts   # YAML 子集解析/序列化
│   │   ├── cmTheme.ts            # CodeMirror 自定义深色主题
│   │   └── wikiLinkExtension.ts  # [[wikilink]] MatchDecorator
│   ├── stores/
│   │   ├── fileSystemStore.ts    # 目录句柄、文件树、当前文件
│   │   ├── editorStore.ts        # 文件内容、脏状态、CM 实例
│   │   └── knowledgeStore.ts     # 链接图、标签索引
│   ├── services/
│   │   ├── fileSystemService.ts  # 打开目录、读写文件、idb-keyval
│   │   ├── frontmatterService.ts # 薄封装，re-export parseFrontmatter
│   │   └── knowledgeService.ts   # 扫描全库、提取链接、增量更新
│   ├── components/
│   │   ├── Ribbon.tsx            # 最左侧图标栏
│   │   ├── Sidebar.tsx           # 左侧文件树
│   │   ├── TabBar.tsx            # 顶部文件 Tab
│   │   ├── PropertiesPanel.tsx   # frontmatter 键值编辑器
│   │   ├── Editor.tsx            # CodeMirror 封装
│   │   ├── RightPanel.tsx        # 链接/大纲/标签三 tab 面板
│   │   └── StatusBar.tsx         # 底部状态栏
│   ├── App.tsx                   # 布局骨架 + 面板显隐 signal
│   ├── index.css                 # @import "tailwindcss"
│   └── index.tsx                 # 入口
├── src/__tests__/
│   ├── parseFrontmatter.test.ts
│   └── knowledgeService.test.ts
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## Task 1: 项目脚手架

**Files:**
- Create: `vite.config.ts`
- Create: `src/index.css`
- Create: `src/index.tsx`
- Create: `src/App.tsx`（占位）

- [ ] **Step 1: 初始化 Vite + SolidJS + TypeScript**

```bash
cd /home/huxzhi/4-code/symbol-notes
npm create vite@latest . -- --template solid-ts
```

回答覆盖提示时输入 `y`。

- [ ] **Step 2: 安装所有依赖**

```bash
npm install
npm install idb-keyval lucide-solid
npm install @codemirror/view @codemirror/state @codemirror/lang-markdown @codemirror/language @codemirror/language-data @lezer/highlight
npm install -D @tailwindcss/vite tailwindcss vitest
```

- [ ] **Step 3: 配置 vite.config.ts**

完整替换 `vite.config.ts`：

```ts
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solidjs'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    solid(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Symbol Notes',
        short_name: 'SymNotes',
        description: '基于符号学的个人知识管理',
        theme_color: '#0f0f1c',
        background_color: '#0f0f1c',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
  },
})
```

安装 PWA 插件：

```bash
npm install -D vite-plugin-pwa
```

- [ ] **Step 4: 配置 Tailwind + 入口 CSS**

`src/index.css`（完整替换）：

```css
@import "tailwindcss";

* {
  box-sizing: border-box;
}

html, body, #root {
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
}
```

`src/index.tsx`（完整替换）：

```tsx
import { render } from 'solid-js/web'
import './index.css'
import App from './App'

render(() => <App />, document.getElementById('root')!)
```

- [ ] **Step 5: 创建占位 App.tsx 并验证启动**

`src/App.tsx`：

```tsx
export default function App() {
  return <div class="h-full bg-[#0f0f1c] text-white flex items-center justify-center">Symbol Notes</div>
}
```

```bash
npm run dev
```

Expected: 浏览器打开 `http://localhost:5173`，显示深色背景 "Symbol Notes" 文字，无报错。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: scaffold Vite + SolidJS + Tailwind + PWA project"
```

---

## Task 2: Frontmatter 解析器（TDD）

**Files:**
- Create: `src/lib/parseFrontmatter.ts`
- Create: `src/__tests__/parseFrontmatter.test.ts`

- [ ] **Step 1: 写失败测试**

`src/__tests__/parseFrontmatter.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { parseFrontmatter, serializeFrontmatter } from '../lib/parseFrontmatter'

describe('parseFrontmatter', () => {
  it('parses basic string values', () => {
    const raw = `---\ntitle: Hello\ndate: 2026-05-20\n---\nBody`
    const { frontmatter, body } = parseFrontmatter(raw)
    expect(frontmatter.title).toBe('Hello')
    expect(frontmatter.date).toBe('2026-05-20')
    expect(body).toBe('Body')
  })

  it('parses inline arrays', () => {
    const { frontmatter } = parseFrontmatter('---\ntags: [a, b, c]\n---\n')
    expect(frontmatter.tags).toEqual(['a', 'b', 'c'])
  })

  it('parses multiline arrays', () => {
    const { frontmatter } = parseFrontmatter('---\ntags:\n  - semiotics\n  - index\n---\n')
    expect(frontmatter.tags).toEqual(['semiotics', 'index'])
  })

  it('parses booleans', () => {
    const { frontmatter } = parseFrontmatter('---\ndraft: true\npublished: false\n---\n')
    expect(frontmatter.draft).toBe(true)
    expect(frontmatter.published).toBe(false)
  })

  it('returns empty frontmatter when no --- block', () => {
    const { frontmatter, body } = parseFrontmatter('No frontmatter')
    expect(frontmatter).toEqual({})
    expect(body).toBe('No frontmatter')
  })

  it('handles empty frontmatter block', () => {
    const { frontmatter, body } = parseFrontmatter('---\n---\nBody')
    expect(frontmatter).toEqual({})
    expect(body).toBe('Body')
  })
})

describe('serializeFrontmatter', () => {
  it('wraps body with frontmatter block', () => {
    const result = serializeFrontmatter({ title: 'Hello' }, 'Body')
    expect(result).toBe('---\ntitle: Hello\n---\nBody')
  })

  it('serializes arrays as multiline', () => {
    const result = serializeFrontmatter({ tags: ['a', 'b'] }, '')
    expect(result).toBe('---\ntags:\n  - a\n  - b\n---\n')
  })

  it('returns body only when frontmatter is empty', () => {
    expect(serializeFrontmatter({}, 'Body')).toBe('Body')
  })

  it('round-trips correctly', () => {
    const original = '---\ntitle: Test\ntags:\n  - a\n  - b\n---\nContent'
    const { frontmatter, body } = parseFrontmatter(original)
    const result = serializeFrontmatter(frontmatter, body)
    expect(result).toBe(original)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run src/__tests__/parseFrontmatter.test.ts
```

Expected: FAIL — "Cannot find module '../lib/parseFrontmatter'"

- [ ] **Step 3: 实现 parseFrontmatter.ts**

`src/lib/parseFrontmatter.ts`：

```ts
export interface ParsedFile {
  frontmatter: Record<string, unknown>
  body: string
}

export function parseFrontmatter(raw: string): ParsedFile {
  if (!raw.startsWith('---')) return { frontmatter: {}, body: raw }
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return { frontmatter: {}, body: raw }
  const yamlStr = raw.slice(4, end)
  const body = raw.slice(end + 4).replace(/^\n/, '')
  return { frontmatter: parseYamlSubset(yamlStr), body }
}

function parseYamlSubset(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = yaml.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) { i++; continue }
    const key = line.slice(0, colonIdx).trim()
    if (!key) { i++; continue }
    const rest = line.slice(colonIdx + 1).trim()
    if (rest === '') {
      const items: string[] = []
      i++
      while (i < lines.length && /^\s+-\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s+-\s*/, '').trim())
        i++
      }
      result[key] = items
    } else if (rest.startsWith('[') && rest.endsWith(']')) {
      result[key] = rest.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean)
      i++
    } else {
      result[key] = parseScalar(rest)
      i++
    }
  }
  return result
}

function parseScalar(value: string): unknown {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null' || value === '~') return null
  const num = Number(value)
  if (value !== '' && !isNaN(num)) return num
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

export function serializeFrontmatter(
  frontmatter: Record<string, unknown>,
  body: string,
): string {
  if (Object.keys(frontmatter).length === 0) return body
  const yaml = Object.entries(frontmatter)
    .map(([k, v]) => {
      if (Array.isArray(v)) {
        if (v.length === 0) return `${k}: []`
        return `${k}:\n${v.map(item => `  - ${item}`).join('\n')}`
      }
      const s = String(v)
      if (s.includes(':') || s.includes('#')) return `${k}: "${s.replace(/"/g, '\\"')}"`
      return `${k}: ${s}`
    })
    .join('\n')
  return `---\n${yaml}\n---\n${body}`
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run src/__tests__/parseFrontmatter.test.ts
```

Expected: 所有测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/parseFrontmatter.ts src/__tests__/parseFrontmatter.test.ts
git commit -m "feat: add frontmatter YAML parser with TDD"
```

---

## Task 3: 三个 Domain Stores

**Files:**
- Create: `src/stores/fileSystemStore.ts`
- Create: `src/stores/editorStore.ts`
- Create: `src/stores/knowledgeStore.ts`

- [ ] **Step 1: fileSystemStore**

`src/stores/fileSystemStore.ts`：

```ts
import { createStore } from 'solid-js/store'

export interface FileNode {
  name: string
  path: string
  kind: 'file' | 'directory'
  children?: FileNode[]
}

export interface FileSystemState {
  rootHandle: FileSystemDirectoryHandle | null
  tree: FileNode[]
  activeFilePath: string | null
  openFilePaths: string[]
}

const [fileSystemStore, setFileSystemStore] = createStore<FileSystemState>({
  rootHandle: null,
  tree: [],
  activeFilePath: null,
  openFilePaths: [],
})

export { fileSystemStore, setFileSystemStore }
```

- [ ] **Step 2: editorStore**

`src/stores/editorStore.ts`：

```ts
import { createStore } from 'solid-js/store'
import type { EditorView } from '@codemirror/view'

export interface EditorState {
  content: string
  isDirty: boolean
  cmView: EditorView | null
}

const [editorStore, setEditorStore] = createStore<EditorState>({
  content: '',
  isDirty: false,
  cmView: null,
})

export { editorStore, setEditorStore }
```

- [ ] **Step 3: knowledgeStore**

`src/stores/knowledgeStore.ts`：

```ts
import { createStore } from 'solid-js/store'

export interface FileMetadata {
  path: string
  frontmatter: Record<string, unknown>
  outLinks: string[]
  tags: string[]
}

export interface KnowledgeState {
  index: Record<string, FileMetadata>
  backlinkMap: Record<string, string[]>
  tagMap: Record<string, string[]>
}

const [knowledgeStore, setKnowledgeStore] = createStore<KnowledgeState>({
  index: {},
  backlinkMap: {},
  tagMap: {},
})

export { knowledgeStore, setKnowledgeStore }
```

- [ ] **Step 4: Commit**

```bash
git add src/stores/
git commit -m "feat: add three domain stores (fileSystem, editor, knowledge)"
```

---

## Task 4: File System Service

**Files:**
- Create: `src/services/fileSystemService.ts`

- [ ] **Step 1: 实现 fileSystemService.ts**

`src/services/fileSystemService.ts`：

```ts
import { get, set } from 'idb-keyval'
import { fileSystemStore, setFileSystemStore, type FileNode } from '../stores/fileSystemStore'
import { editorStore, setEditorStore } from '../stores/editorStore'
import { parseFrontmatter, serializeFrontmatter } from '../lib/parseFrontmatter'
import { reindexFile } from './knowledgeService'

const DB_KEY = 'rootHandle'

export async function openDirectory(): Promise<void> {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
  await set(DB_KEY, handle)
  setFileSystemStore({ rootHandle: handle, activeFilePath: null, openFilePaths: [] })
  setFileSystemStore('tree', await buildTree(handle))
}

export async function restoreDirectory(): Promise<void> {
  const handle = await get<FileSystemDirectoryHandle>(DB_KEY)
  if (!handle) return
  const perm = await handle.requestPermission({ mode: 'readwrite' })
  if (perm !== 'granted') return
  setFileSystemStore({ rootHandle: handle })
  setFileSystemStore('tree', await buildTree(handle))
}

async function buildTree(
  dirHandle: FileSystemDirectoryHandle,
  path = '',
): Promise<FileNode[]> {
  const nodes: FileNode[] = []
  for await (const [name, handle] of dirHandle.entries()) {
    if (name.startsWith('.')) continue
    const nodePath = path ? `${path}/${name}` : name
    if (handle.kind === 'directory') {
      const children = await buildTree(handle as FileSystemDirectoryHandle, nodePath)
      nodes.push({ name, path: nodePath, kind: 'directory', children })
    } else if (name.endsWith('.md')) {
      nodes.push({ name, path: nodePath, kind: 'file' })
    }
  }
  return nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

async function getFileHandle(path: string): Promise<FileSystemFileHandle> {
  const { rootHandle } = fileSystemStore
  if (!rootHandle) throw new Error('No root directory')
  const parts = path.split('/')
  let dir: FileSystemDirectoryHandle = rootHandle
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i])
  }
  return dir.getFileHandle(parts[parts.length - 1])
}

export async function openFile(path: string): Promise<void> {
  const handle = await getFileHandle(path)
  const file = await handle.getFile()
  const content = await file.text()
  setEditorStore({ content, isDirty: false })
  setFileSystemStore('activeFilePath', path)
  if (!fileSystemStore.openFilePaths.includes(path)) {
    setFileSystemStore('openFilePaths', [...fileSystemStore.openFilePaths, path])
  }
}

export async function saveCurrentFile(): Promise<void> {
  const { rootHandle, activeFilePath } = fileSystemStore
  const { content, cmView } = editorStore
  if (!rootHandle || !activeFilePath) return

  const { frontmatter } = parseFrontmatter(content)
  const body = cmView?.state.doc.toString() ?? parseFrontmatter(content).body
  const newContent = serializeFrontmatter(frontmatter, body)

  const handle = await getFileHandle(activeFilePath)
  const writable = await handle.createWritable()
  await writable.write(newContent)
  await writable.close()

  setEditorStore({ content: newContent, isDirty: false })
  await reindexFile(activeFilePath, newContent)
}

export function closeFile(path: string): void {
  const paths = fileSystemStore.openFilePaths.filter(p => p !== path)
  setFileSystemStore('openFilePaths', paths)
  if (fileSystemStore.activeFilePath === path) {
    const next = paths[paths.length - 1] ?? null
    setFileSystemStore('activeFilePath', next)
    if (next) openFile(next)
    else setEditorStore({ content: '', isDirty: false })
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/fileSystemService.ts
git commit -m "feat: add file system service (open, read, write, persist)"
```

---

## Task 5: Knowledge Service（TDD）

**Files:**
- Create: `src/services/knowledgeService.ts`
- Create: `src/__tests__/knowledgeService.test.ts`

- [ ] **Step 1: 写失败测试**

`src/__tests__/knowledgeService.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { extractLinks, extractTags, buildBacklinkMap } from '../services/knowledgeService'

describe('extractLinks', () => {
  it('extracts [[wikilinks]]', () => {
    expect(extractLinks('See [[符号与象征]] and [[索引]]')).toEqual(['符号与象征', '索引'])
  })

  it('extracts [[link|alias]] target only', () => {
    expect(extractLinks('[[target|显示名]]')).toEqual(['target'])
  })

  it('deduplicates repeated links', () => {
    expect(extractLinks('[[a]] and [[a]]')).toEqual(['a'])
  })

  it('returns empty array when no links', () => {
    expect(extractLinks('No links')).toEqual([])
  })
})

describe('extractTags', () => {
  it('extracts tags from frontmatter string', () => {
    expect(extractTags('semiotics, index')).toEqual(['semiotics', 'index'])
  })

  it('extracts tags from array', () => {
    expect(extractTags(['a', 'b'])).toEqual(['a', 'b'])
  })

  it('returns empty array for missing tags', () => {
    expect(extractTags(undefined)).toEqual([])
  })
})

describe('buildBacklinkMap', () => {
  it('builds reverse index', () => {
    const index = {
      'a.md': { path: 'a.md', frontmatter: {}, outLinks: ['b.md'], tags: [] },
      'b.md': { path: 'b.md', frontmatter: {}, outLinks: [], tags: [] },
    }
    const map = buildBacklinkMap(index)
    expect(map['b.md']).toEqual(['a.md'])
    expect(map['a.md']).toEqual([])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run src/__tests__/knowledgeService.test.ts
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: 实现 knowledgeService.ts**

`src/services/knowledgeService.ts`：

```ts
import { knowledgeStore, setKnowledgeStore } from '../stores/knowledgeStore'
import { fileSystemStore } from '../stores/fileSystemStore'
import { parseFrontmatter } from '../lib/parseFrontmatter'
import type { FileMetadata } from '../stores/knowledgeStore'

export function extractLinks(content: string): string[] {
  const matches = [...content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)]
  return [...new Set(matches.map(m => m[1].trim()))]
}

export function extractTags(raw: unknown): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === 'string') return raw.split(',').map(s => s.trim()).filter(Boolean)
  return []
}

export function buildBacklinkMap(
  index: Record<string, FileMetadata>,
): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  for (const path of Object.keys(index)) {
    if (!map[path]) map[path] = []
  }
  for (const [path, meta] of Object.entries(index)) {
    for (const link of meta.outLinks) {
      if (!map[link]) map[link] = []
      if (!map[link].includes(path)) map[link].push(path)
    }
  }
  return map
}

function buildTagMap(
  index: Record<string, FileMetadata>,
): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  for (const [path, meta] of Object.entries(index)) {
    for (const tag of meta.tags) {
      if (!map[tag]) map[tag] = []
      map[tag].push(path)
    }
  }
  return map
}

async function readAllFiles(
  dirHandle: FileSystemDirectoryHandle,
  path = '',
): Promise<Array<{ path: string; content: string }>> {
  const results: Array<{ path: string; content: string }> = []
  for await (const [name, handle] of dirHandle.entries()) {
    if (name.startsWith('.')) continue
    const nodePath = path ? `${path}/${name}` : name
    if (handle.kind === 'directory') {
      const sub = await readAllFiles(handle as FileSystemDirectoryHandle, nodePath)
      results.push(...sub)
    } else if (name.endsWith('.md')) {
      const file = await (handle as FileSystemFileHandle).getFile()
      results.push({ path: nodePath, content: await file.text() })
    }
  }
  return results
}

export async function scanDirectory(): Promise<void> {
  const { rootHandle } = fileSystemStore
  if (!rootHandle) return
  const files = await readAllFiles(rootHandle)
  const index: Record<string, FileMetadata> = {}
  for (const { path, content } of files) {
    const { frontmatter, body } = parseFrontmatter(content)
    index[path] = {
      path,
      frontmatter,
      outLinks: extractLinks(body),
      tags: extractTags(frontmatter.tags),
    }
  }
  const backlinkMap = buildBacklinkMap(index)
  const tagMap = buildTagMap(index)
  setKnowledgeStore({ index, backlinkMap, tagMap })
}

export async function reindexFile(path: string, content: string): Promise<void> {
  const { frontmatter, body } = parseFrontmatter(content)
  const meta: FileMetadata = {
    path,
    frontmatter,
    outLinks: extractLinks(body),
    tags: extractTags(frontmatter.tags),
  }
  const newIndex = { ...knowledgeStore.index, [path]: meta }
  setKnowledgeStore('index', path, meta)
  setKnowledgeStore('backlinkMap', buildBacklinkMap(newIndex))
  setKnowledgeStore('tagMap', buildTagMap(newIndex))
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run src/__tests__/knowledgeService.test.ts
```

Expected: 所有测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/services/knowledgeService.ts src/__tests__/knowledgeService.test.ts
git commit -m "feat: add knowledge service with TDD (link extraction, backlink graph)"
```

---

## Task 6: App 布局骨架

**Files:**
- Modify: `src/App.tsx`
- Create: `src/components/Ribbon.tsx`
- Create: `src/components/StatusBar.tsx`

- [ ] **Step 1: App.tsx 布局骨架**

`src/App.tsx`：

```tsx
import { createSignal, onMount, Show } from 'solid-js'
import { Ribbon } from './components/Ribbon'
import { Sidebar } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { PropertiesPanel } from './components/PropertiesPanel'
import { Editor } from './components/Editor'
import { RightPanel } from './components/RightPanel'
import { StatusBar } from './components/StatusBar'
import { restoreDirectory, scanDirectory } from './services/fileSystemService'
import { fileSystemStore } from './stores/fileSystemStore'

export default function App() {
  const [showLeft, setShowLeft] = createSignal(true)
  const [showRight, setShowRight] = createSignal(true)

  onMount(async () => {
    await restoreDirectory()
    if (fileSystemStore.rootHandle) {
      await scanDirectory()
    }
  })

  return (
    <div class="h-full flex flex-col bg-[#0f0f1c] text-white overflow-hidden">
      <div class="flex flex-1 overflow-hidden">
        <Ribbon onToggleLeft={() => setShowLeft(v => !v)} onToggleRight={() => setShowRight(v => !v)} />
        <div class={`transition-all duration-200 overflow-hidden ${showLeft() ? 'w-[190px]' : 'w-0'}`}>
          <Sidebar />
        </div>
        <div class="flex-1 flex flex-col overflow-hidden">
          <TabBar />
          <div class="flex-1 flex flex-col overflow-hidden">
            <PropertiesPanel />
            <Editor />
          </div>
        </div>
        <div class={`transition-all duration-200 overflow-hidden ${showRight() ? 'w-[200px]' : 'w-0'}`}>
          <RightPanel />
        </div>
      </div>
      <StatusBar />
    </div>
  )
}
```

- [ ] **Step 2: Ribbon.tsx**

`src/components/Ribbon.tsx`：

```tsx
import { FolderOpen, Search, Network, Settings, PanelLeft, PanelRight } from 'lucide-solid'
import { openDirectory, scanDirectory } from '../services/fileSystemService'

interface Props {
  onToggleLeft: () => void
  onToggleRight: () => void
}

export function Ribbon(props: Props) {
  async function handleOpen() {
    await openDirectory()
    await scanDirectory()
  }

  return (
    <div class="w-9 bg-[#0d0d1a] border-r border-[#1e1e35] flex flex-col items-center py-2 gap-1.5 shrink-0">
      <button onClick={handleOpen} class="p-1.5 text-[#6c63ff] hover:bg-[#1e1e35] rounded cursor-pointer" title="打开文件夹">
        <FolderOpen size={18} />
      </button>
      <button class="p-1.5 text-[#555] hover:bg-[#1e1e35] rounded cursor-pointer" title="搜索">
        <Search size={18} />
      </button>
      <button class="p-1.5 text-[#555] hover:bg-[#1e1e35] rounded cursor-pointer" title="知识图谱">
        <Network size={18} />
      </button>
      <div class="flex-1" />
      <button onClick={props.onToggleLeft} class="p-1.5 text-[#555] hover:bg-[#1e1e35] rounded cursor-pointer" title="切换左栏">
        <PanelLeft size={18} />
      </button>
      <button onClick={props.onToggleRight} class="p-1.5 text-[#555] hover:bg-[#1e1e35] rounded cursor-pointer" title="切换右栏">
        <PanelRight size={18} />
      </button>
      <button class="p-1.5 text-[#555] hover:bg-[#1e1e35] rounded cursor-pointer" title="设置">
        <Settings size={18} />
      </button>
    </div>
  )
}
```

- [ ] **Step 3: StatusBar.tsx**

`src/components/StatusBar.tsx`：

```tsx
import { createMemo } from 'solid-js'
import { editorStore } from '../stores/editorStore'
import { parseFrontmatter } from '../lib/parseFrontmatter'

export function StatusBar() {
  const stats = createMemo(() => {
    const { body } = parseFrontmatter(editorStore.content)
    const words = body.trim() ? body.trim().split(/\s+/).length : 0
    const lines = editorStore.cmView?.state.doc.lines ?? 0
    return { words, lines }
  })

  return (
    <div class="h-6 bg-[#0d0d1a] border-t border-[#1e1e35] px-3 flex items-center gap-4 text-[10px] text-[#444] shrink-0">
      <span>{stats().words} 字</span>
      <span>{stats().lines} 行</span>
      <div class="flex-1" />
      <span class={editorStore.isDirty ? 'text-[#6c63ff]' : ''}>
        {editorStore.isDirty ? '未保存' : '已保存'}
      </span>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/components/Ribbon.tsx src/components/StatusBar.tsx
git commit -m "feat: add App layout skeleton, Ribbon, StatusBar"
```

---

## Task 7: Sidebar 文件树

**Files:**
- Create: `src/components/Sidebar.tsx`

- [ ] **Step 1: 实现 Sidebar.tsx**

`src/components/Sidebar.tsx`：

```tsx
import { For, Show } from 'solid-js'
import { fileSystemStore } from '../stores/fileSystemStore'
import { openFile } from '../services/fileSystemService'
import type { FileNode } from '../stores/fileSystemStore'

function FileTreeNode(props: { node: FileNode; depth: number }) {
  const isActive = () => fileSystemStore.activeFilePath === props.node.path

  return (
    <div>
      <div
        class={`flex items-center gap-1 py-0.5 text-[11px] cursor-pointer hover:bg-[#1e1e35] select-none
          ${isActive() ? 'bg-[#1e1e35] border-l-2 border-[#6c63ff] text-white' : 'text-[#888] border-l-2 border-transparent'}`}
        style={{ 'padding-left': `${6 + props.depth * 14}px` }}
        onClick={() => { if (props.node.kind === 'file') openFile(props.node.path) }}
      >
        <span class="text-[9px] text-[#555]">
          {props.node.kind === 'directory' ? '▸' : '◻'}
        </span>
        <span class={isActive() ? 'text-[#6c63ff]' : ''}>{props.node.name}</span>
      </div>
      <Show when={props.node.kind === 'directory'}>
        <For each={props.node.children ?? []}>
          {(child) => <FileTreeNode node={child} depth={props.depth + 1} />}
        </For>
      </Show>
    </div>
  )
}

export function Sidebar() {
  return (
    <div class="w-[190px] h-full bg-[#111120] border-r border-[#1e1e35] flex flex-col">
      <div class="px-2.5 py-2 text-[10px] text-[#6c63ff] font-bold tracking-widest uppercase border-b border-[#1e1e35] truncate">
        {fileSystemStore.rootHandle?.name ?? '未选择文件夹'}
      </div>
      <div class="overflow-y-auto flex-1 py-1">
        <For each={fileSystemStore.tree}>
          {(node) => <FileTreeNode node={node} depth={0} />}
        </For>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: add Sidebar file tree component"
```

---

## Task 8: TabBar 文件标签页

**Files:**
- Create: `src/components/TabBar.tsx`

- [ ] **Step 1: 实现 TabBar.tsx**

`src/components/TabBar.tsx`：

```tsx
import { For } from 'solid-js'
import { fileSystemStore } from '../stores/fileSystemStore'
import { openFile, closeFile } from '../services/fileSystemService'

export function TabBar() {
  function baseName(path: string) {
    return path.split('/').pop() ?? path
  }

  return (
    <div class="h-8 bg-[#0d0d1a] border-b border-[#1e1e35] flex items-stretch shrink-0 overflow-x-auto">
      <For each={fileSystemStore.openFilePaths}>
        {(path) => {
          const isActive = () => fileSystemStore.activeFilePath === path
          return (
            <div
              class={`flex items-center gap-1.5 px-3 border-r border-[#1e1e35] cursor-pointer text-[11px] shrink-0 group
                ${isActive()
                  ? 'bg-[#0f0f1c] text-white border-b-2 border-b-[#6c63ff] -mb-px'
                  : 'text-[#555] hover:bg-[#1a1a2e]'}`}
              onClick={() => openFile(path)}
            >
              <span class="text-[9px] text-[#6c63ff]">◻</span>
              <span class="max-w-[120px] truncate">{baseName(path)}</span>
              <button
                class="text-[#333] hover:text-[#888] text-[13px] leading-none ml-0.5"
                onClick={(e) => { e.stopPropagation(); closeFile(path) }}
              >
                ×
              </button>
            </div>
          )
        }}
      </For>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/TabBar.tsx
git commit -m "feat: add TabBar with open/close tab support"
```

---

## Task 9: PropertiesPanel Frontmatter 编辑器

**Files:**
- Create: `src/components/PropertiesPanel.tsx`

- [ ] **Step 1: 实现 PropertiesPanel.tsx**

`src/components/PropertiesPanel.tsx`：

```tsx
import { For, createMemo, Show } from 'solid-js'
import { parseFrontmatter, serializeFrontmatter } from '../lib/parseFrontmatter'
import { editorStore, setEditorStore } from '../stores/editorStore'
import { fileSystemStore } from '../stores/fileSystemStore'

export function PropertiesPanel() {
  const parsed = createMemo(() => parseFrontmatter(editorStore.content))
  const fields = createMemo(() => Object.entries(parsed().frontmatter))

  function updateField(key: string, value: string) {
    const { frontmatter, body } = parsed()
    const updated = { ...frontmatter, [key]: value }
    setEditorStore('content', serializeFrontmatter(updated, body))
    setEditorStore('isDirty', true)
  }

  function deleteField(key: string) {
    const { frontmatter, body } = parsed()
    const { [key]: _, ...rest } = frontmatter as Record<string, unknown>
    setEditorStore('content', serializeFrontmatter(rest, body))
    setEditorStore('isDirty', true)
  }

  function addField() {
    const { frontmatter, body } = parsed()
    const newKey = `field${Object.keys(frontmatter).length + 1}`
    const updated = { ...frontmatter, [newKey]: '' }
    setEditorStore('content', serializeFrontmatter(updated, body))
    setEditorStore('isDirty', true)
  }

  return (
    <Show when={fileSystemStore.activeFilePath}>
      <div class="bg-[#16162a] border-b border-[#2d2d4a] px-4 py-2.5 shrink-0">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-[10px] text-[#6c63ff] font-bold tracking-widest uppercase">Properties</span>
          <button
            onClick={addField}
            class="text-[10px] text-[#a09cf7] bg-[#6c63ff22] border border-[#6c63ff44] px-2 py-0.5 rounded hover:bg-[#6c63ff33] cursor-pointer"
          >
            + 添加字段
          </button>
        </div>
        <div class="flex flex-col gap-1.5">
          <For each={fields()}>
            {([key, value]) => (
              <div class="flex items-center gap-1.5">
                <span class="text-[11px] text-[#6c63ff] font-semibold w-[64px] text-right shrink-0">{key}</span>
                <span class="text-[#3a3a5c] shrink-0">:</span>
                <input
                  class="flex-1 bg-[#1e1e35] border border-[#3a3a5c] rounded px-2 py-0.5 text-[12px] text-[#e0e0ff] font-mono focus:outline-none focus:border-[#6c63ff] min-w-0"
                  value={String(value ?? '')}
                  onInput={(e) => updateField(key, e.currentTarget.value)}
                />
                <button
                  onClick={() => deleteField(key)}
                  class="text-[#3a3a5c] hover:text-[#888] text-[12px] cursor-pointer px-1 shrink-0"
                >
                  ✕
                </button>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/PropertiesPanel.tsx
git commit -m "feat: add PropertiesPanel frontmatter key-value editor"
```

---

## Task 10: CodeMirror 主题 + WikiLink 扩展

**Files:**
- Create: `src/lib/cmTheme.ts`
- Create: `src/lib/wikiLinkExtension.ts`

- [ ] **Step 1: 实现自定义深色主题**

`src/lib/cmTheme.ts`：

```ts
import { EditorView } from '@codemirror/view'
import { HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'

export const darkTheme = EditorView.theme(
  {
    '&': { backgroundColor: '#0f0f1c', color: '#ccc', height: '100%' },
    '.cm-content': {
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: '14px',
      lineHeight: '1.8',
      padding: '20px 32px',
      caretColor: '#6c63ff',
      maxWidth: '800px',
    },
    '.cm-cursor': { borderLeftColor: '#6c63ff', borderLeftWidth: '2px' },
    '.cm-gutters': { display: 'none' },
    '.cm-selectionBackground, ::selection': { backgroundColor: '#2d2d4a !important' },
    '&.cm-focused .cm-selectionBackground': { backgroundColor: '#3a3a5c !important' },
    '.cm-line': { padding: '0' },
    '.cm-wikilink': {
      color: '#7ec8e3',
      textDecoration: 'underline',
      textDecorationStyle: 'dotted',
      cursor: 'pointer',
    },
  },
  { dark: true },
)

export const darkHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, color: '#6c63ff', fontWeight: 'bold', fontSize: '1.35em' },
  { tag: tags.heading2, color: '#9d8dff', fontWeight: 'bold', fontSize: '1.15em' },
  { tag: tags.heading3, color: '#b0a4ff', fontWeight: '600' },
  { tag: tags.heading4, color: '#c4baff' },
  { tag: tags.heading5, color: '#c4baff' },
  { tag: tags.heading6, color: '#c4baff' },
  { tag: tags.strong, color: '#ffffff', fontWeight: 'bold' },
  { tag: tags.emphasis, color: '#7ec8e3', fontStyle: 'italic' },
  { tag: tags.strikethrough, color: '#555', textDecoration: 'line-through' },
  { tag: tags.link, color: '#7ec8e3' },
  { tag: tags.url, color: '#7ec8e3' },
  { tag: tags.monospace, color: '#a09cf7', fontFamily: 'monospace' },
  { tag: tags.quote, color: '#888', fontStyle: 'italic' },
  { tag: tags.list, color: '#6c63ff' },
  { tag: tags.meta, color: '#555' },
])
```

- [ ] **Step 2: 实现 WikiLink 扩展**

`src/lib/wikiLinkExtension.ts`：

```ts
import { MatchDecorator, ViewPlugin, Decoration, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { EditorView } from '@codemirror/view'

const matcher = new MatchDecorator({
  regexp: /\[\[([^\]]+)\]\]/g,
  decoration: () => Decoration.mark({ class: 'cm-wikilink' }),
})

export const wikiLinkExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = matcher.createDeco(view)
    }
    update(update: ViewUpdate) {
      this.decorations = matcher.updateDeco(update, this.decorations)
    }
  },
  { decorations: (v) => v.decorations },
)
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/cmTheme.ts src/lib/wikiLinkExtension.ts
git commit -m "feat: add custom dark CodeMirror theme and wikilink decorator"
```

---

## Task 11: Editor 组件（CodeMirror）

**Files:**
- Create: `src/components/Editor.tsx`

- [ ] **Step 1: 实现 Editor.tsx**

`src/components/Editor.tsx`：

```tsx
import { onMount, onCleanup, createEffect } from 'solid-js'
import { EditorView } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting } from '@codemirror/language'
import { darkTheme, darkHighlightStyle } from '../lib/cmTheme'
import { wikiLinkExtension } from '../lib/wikiLinkExtension'
import { editorStore, setEditorStore } from '../stores/editorStore'
import { saveCurrentFile } from '../services/fileSystemService'
import { parseFrontmatter } from '../lib/parseFrontmatter'

export function Editor() {
  let container!: HTMLDivElement
  let view: EditorView | null = null
  let isExternalUpdate = false
  const docCompartment = new Compartment()

  onMount(() => {
    const { body } = parseFrontmatter(editorStore.content)

    view = new EditorView({
      state: EditorState.create({
        doc: body,
        extensions: [
          markdown({ codeLanguages: languages }),
          syntaxHighlighting(darkHighlightStyle),
          darkTheme,
          wikiLinkExtension,
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !isExternalUpdate) {
              setEditorStore('isDirty', true)
            }
          }),
          EditorView.domEventHandlers({
            keydown(event) {
              if ((event.ctrlKey || event.metaKey) && event.key === 's') {
                event.preventDefault()
                saveCurrentFile()
              }
            },
          }),
          EditorView.lineWrapping,
        ],
      }),
      parent: container,
    })

    setEditorStore('cmView', view)
  })

  onCleanup(() => {
    view?.destroy()
    setEditorStore('cmView', null)
  })

  createEffect(() => {
    if (!view) return
    const { body } = parseFrontmatter(editorStore.content)
    const current = view.state.doc.toString()
    if (current === body) return
    isExternalUpdate = true
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: body },
    })
    isExternalUpdate = false
  })

  return (
    <div
      ref={container}
      class="flex-1 overflow-auto bg-[#0f0f1c]"
      style={{ 'min-height': '0' }}
    />
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Editor.tsx
git commit -m "feat: add CodeMirror editor with live preview and Ctrl+S save"
```

---

## Task 12: RightPanel 知识图谱属性面板

**Files:**
- Create: `src/components/RightPanel.tsx`

- [ ] **Step 1: 实现 RightPanel.tsx**

`src/components/RightPanel.tsx`：

```tsx
import { createSignal, createMemo, For, Show } from 'solid-js'
import { fileSystemStore } from '../stores/fileSystemStore'
import { knowledgeStore } from '../stores/knowledgeStore'
import { editorStore } from '../stores/editorStore'
import { parseFrontmatter } from '../lib/parseFrontmatter'

type Tab = 'links' | 'outline' | 'tags'

interface Heading { level: number; text: string }

export function RightPanel() {
  const [activeTab, setActiveTab] = createSignal<Tab>('links')

  const currentMeta = createMemo(() => {
    const path = fileSystemStore.activeFilePath
    return path ? knowledgeStore.index[path] ?? null : null
  })

  const outLinks = createMemo(() => currentMeta()?.outLinks ?? [])

  const backlinks = createMemo(() => {
    const path = fileSystemStore.activeFilePath
    return path ? knowledgeStore.backlinkMap[path] ?? [] : []
  })

  const tags = createMemo(() => currentMeta()?.tags ?? [])

  const outline = createMemo((): Heading[] => {
    const { body } = parseFrontmatter(editorStore.content)
    return body.split('\n')
      .flatMap(line => {
        const m = line.match(/^(#{1,6})\s+(.+)/)
        return m ? [{ level: m[1].length, text: m[2] }] : []
      })
  })

  const tabs: { id: Tab; label: string }[] = [
    { id: 'links', label: '链接' },
    { id: 'outline', label: '大纲' },
    { id: 'tags', label: '标签' },
  ]

  return (
    <div class="w-[200px] h-full bg-[#111120] border-l border-[#1e1e35] flex flex-col shrink-0">
      <div class="flex border-b border-[#1e1e35] shrink-0">
        <For each={tabs}>
          {(tab) => (
            <button
              class={`flex-1 py-1.5 text-[10px] cursor-pointer transition-colors
                ${activeTab() === tab.id
                  ? 'text-[#6c63ff] border-b-2 border-[#6c63ff] -mb-px'
                  : 'text-[#555] hover:text-[#888]'}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          )}
        </For>
      </div>

      <div class="flex-1 overflow-y-auto p-2 text-[11px]">
        <Show when={activeTab() === 'links'}>
          <div class="text-[#555] text-[10px] uppercase tracking-widest mb-1.5">出链 ({outLinks().length})</div>
          <For each={outLinks()}>
            {(link) => (
              <div class="text-[#7ec8e3] py-0.5 flex items-center gap-1">
                <span class="text-[#6c63ff] text-[10px]">↗</span> {link}
              </div>
            )}
          </For>
          <div class="text-[#555] text-[10px] uppercase tracking-widest mt-3 mb-1.5">入链 ({backlinks().length})</div>
          <For each={backlinks()}>
            {(link) => (
              <div class="text-[#a09cf7] py-0.5 flex items-center gap-1">
                <span class="text-[#6c63ff] text-[10px]">↙</span> {link}
              </div>
            )}
          </For>
          <Show when={outLinks().length === 0 && backlinks().length === 0}>
            <div class="text-[#333] italic mt-1">暂无链接</div>
          </Show>
        </Show>

        <Show when={activeTab() === 'outline'}>
          <For each={outline()}>
            {(h) => (
              <div
                class="py-0.5 text-[#888] hover:text-[#ccc] cursor-pointer truncate"
                style={{ 'padding-left': `${(h.level - 1) * 10}px`, 'font-size': h.level === 1 ? '12px' : '11px' }}
              >
                {h.text}
              </div>
            )}
          </For>
          <Show when={outline().length === 0}>
            <div class="text-[#333] italic">暂无标题</div>
          </Show>
        </Show>

        <Show when={activeTab() === 'tags'}>
          <div class="flex flex-wrap gap-1.5 mt-1">
            <For each={tags()}>
              {(tag) => (
                <span class="bg-[#6c63ff22] border border-[#6c63ff44] text-[#a09cf7] text-[10px] px-2 py-0.5 rounded-full">
                  #{tag}
                </span>
              )}
            </For>
          </div>
          <Show when={tags().length === 0}>
            <div class="text-[#333] italic mt-1">暂无标签</div>
          </Show>
        </Show>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/RightPanel.tsx
git commit -m "feat: add RightPanel with links/outline/tags tabs"
```

---

## Task 13: 集成验证 + PWA 图标

**Files:**
- Create: `public/icon-192.png`（占位图标）
- Create: `public/icon-512.png`（占位图标）

- [ ] **Step 1: 生成占位 PWA 图标**

```bash
# 用 ImageMagick 生成纯色占位图标
convert -size 192x192 xc:'#6c63ff' public/icon-192.png 2>/dev/null || \
  node -e "
    const fs = require('fs');
    // 1x1 紫色 PNG base64
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const buf = Buffer.from(b64, 'base64');
    fs.writeFileSync('public/icon-192.png', buf);
    fs.writeFileSync('public/icon-512.png', buf);
    console.log('icons created');
  "
```

- [ ] **Step 2: 确认全部测试通过**

```bash
npx vitest run
```

Expected: `parseFrontmatter` 和 `knowledgeService` 两套测试全部 PASS。

- [ ] **Step 3: 启动开发服务器验证完整流程**

```bash
npm run dev
```

在浏览器中执行以下验证步骤：

1. 点击 Ribbon 的文件夹图标 → 弹出系统目录选择器
2. 选择包含 `.md` 文件的本地目录 → 左侧文件树显示文件列表
3. 点击一个 `.md` 文件 → Tab 栏出现该文件 tab，编辑区显示内容，Properties 面板显示 frontmatter 字段
4. 在 Properties 面板修改一个字段值 → 状态栏显示"未保存"
5. 按 `Ctrl+S` → 状态栏变为"已保存"
6. 右侧面板切换"链接"tab → 显示文档中的 `[[wikilink]]` 出链
7. 切换"大纲"tab → 显示文档标题层级
8. 切换"标签"tab → 显示 frontmatter 中的 tags
9. 点击 Ribbon 的 PanelLeft / PanelRight 按钮 → 侧边栏收起/展开
10. 刷新页面 → 目录自动恢复（弹出权限确认后无需重新选择）

- [ ] **Step 4: 构建验证**

```bash
npm run build
```

Expected: 无 TypeScript 错误，`dist/` 目录生成，包含 Service Worker 和 manifest。

- [ ] **Step 5: 最终 Commit**

```bash
git add public/ src/
git commit -m "feat: complete Phase 1 - local MD editor PWA with knowledge graph panel"
```

---

## 成功标准核对表

- [ ] 选择本地文件夹后文件树正确展示嵌套结构
- [ ] 点击 `.md` 文件在 Tab 中打开，CodeMirror 加载正文（不含 frontmatter 原文）
- [ ] Frontmatter 字段在 Properties 块中可读、可编辑、可增删
- [ ] 编辑内容后 Ctrl+S 写回原始文件，frontmatter 正确序列化
- [ ] 右侧面板正确显示出链、入链、大纲标题、标签
- [ ] 刷新 PWA 后自动恢复上次打开的目录
- [ ] 左右侧边栏可独立隐藏/显示（动画过渡，不卸载 CodeMirror）
