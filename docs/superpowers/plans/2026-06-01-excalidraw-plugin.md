# Excalidraw 插件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以插件形式集成 Excalidraw 绘图编辑器，支持打开和编辑 Obsidian 兼容的 `.excalidraw.md` 文件（parsed/compressed 双模式），以及从 Ribbon 和文件树右键新建绘图文件。

**Architecture:** 修复 `canAcceptFile` 签名为传完整路径，实现三层结构：格式层（`excalidrawFormat.ts`）解析/序列化 Obsidian 格式，视图层（`ExcalidrawViewer.tsx`）动态挂载 React Excalidraw 组件，插件层（`index.tsx`）注册视图/ribbon/上下文菜单。

**Tech Stack:** `@excalidraw/excalidraw`（React 组件，动态 import）、`lz-string`（LZ 压缩）、`react@18` + `react-dom@18`（动态 import）、SolidJS、Vite

---

## File Map

| 操作 | 路径 | 职责 |
|------|------|------|
| 新建 | `src/plugins/excalidraw/excalidrawFormat.ts` | 解析/序列化 Obsidian `.excalidraw.md` 格式（parsed + compressed） |
| 新建 | `src/plugins/excalidraw/__tests__/excalidrawFormat.test.ts` | 格式层单元测试 |
| 新建 | `src/plugins/excalidraw/ExcalidrawViewer.tsx` | SolidJS 视图组件，挂载 React Excalidraw |
| 新建 | `src/plugins/excalidraw/index.tsx` | 插件注册：视图 + ribbon + 目录右键菜单 |
| 修改 | `src/lib/pluginRegistry.ts` | `canAcceptFile(ext)` → `canAcceptFile(path)`；`getFileViewForExt` → `getFileViewForPath` |
| 修改 | `src/lib/__tests__/viewRegistry.test.ts` | 更新测试以适配新签名 |
| 修改 | `src/stores/workspaceStore.ts` | 两处调用点：删除 `ext` 局部变量，传 `path` |
| 修改 | `src/plugins/files/FilesPanel.tsx` | `canOpen` 传 `path`；`displayName` 处理 `.excalidraw.md` |
| 修改 | `src/plugins/editor/index.tsx` | 排除 `.excalidraw.md` |
| 修改 | `src/App.tsx` | 注册 `ExcalidrawPlugin` |

---

## Task 1: 安装依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装运行时依赖**

```bash
cd /home/huxzhi/4-code/symbol-notes
npm install react@^18 react-dom@^18 @excalidraw/excalidraw lz-string
```

Expected: 新增四个包到 `dependencies`

- [ ] **Step 2: 安装类型定义**

```bash
npm install -D @types/react@^18 @types/react-dom@^18 @types/lz-string
```

Expected: 新增三个包到 `devDependencies`

- [ ] **Step 3: 验证 TypeScript 编译**

```bash
npx tsc --noEmit
```

Expected: 无报错输出

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add react, excalidraw, lz-string dependencies"
```

---

## Task 2: 修复文件路由（canAcceptFile 签名）

**Files:**
- Modify: `src/lib/pluginRegistry.ts:11-18,55-60`
- Modify: `src/stores/workspaceStore.ts:330,378`
- Modify: `src/plugins/files/FilesPanel.tsx:12,20-33,140`
- Modify: `src/plugins/editor/index.tsx:19`

- [ ] **Step 1: 修改 `pluginRegistry.ts`**

在 `src/lib/pluginRegistry.ts` 中：

将 `FileViewDef` 接口的 `canAcceptFile` 参数从 `ext` 改为 `path`：
```typescript
export interface FileViewDef {
  kind: 'file'
  type: string
  getDisplayText(path: string): string
  getIcon?(): JSX.Element
  canAcceptFile(path: string): boolean   // was: (ext: string)
  component: Component<ViewComponentProps>
}
```

将 `getFileViewForExt` 函数重命名为 `getFileViewForPath`（函数体不变）：
```typescript
export function getFileViewForPath(path: string): FileViewDef | undefined {
  for (const def of _viewRegistry().values()) {
    if (def.kind === 'file' && def.canAcceptFile(path)) return def as FileViewDef
  }
  return undefined
}
```

删除旧的 `getFileViewForExt` 函数。

- [ ] **Step 2: 修改 `workspaceStore.ts` — 两处调用**

第 1 处（`openFile` 方法，约第 330 行）：
```typescript
// 删除:
const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
const def = getFileViewForExt(ext)
// 改为:
const def = getFileViewForPath(path)
```

第 2 处（约第 378 行，另一个 openFile 变体），同样删除 `ext` 局部变量，改为 `getFileViewForPath(path)`。

同时更新 import：将 `getFileViewForExt` 改为 `getFileViewForPath`。

- [ ] **Step 3: 修改 `FilesPanel.tsx`**

更新 import（第 12 行）：
```typescript
import { getFileViewForPath } from '../../lib/pluginRegistry'
```

更新 `displayName` 函数，处理复合扩展名：
```typescript
function displayName(name: string): string {
  if (name.endsWith('.excalidraw.md')) return name.slice(0, -14)
  return name.endsWith('.md') ? name.slice(0, -3) : name
}
```

更新 `canOpen` 函数，传路径而非文件名：
```typescript
function canOpen(path: string): boolean {
  return getFileViewForPath(path) !== undefined
}
```

在 `FileTreeNode` 组件中，两处 `canOpen` 调用从 `props.entry.name` 改为 `props.entry.path`：
```typescript
if (!canOpen(props.entry.path)) return
```
（两处 `onClick` 和 `onDblClick` 中各改一次）

删除 `const MD_EXT = '.md'` 和已无用的 `isOtherFile` 依赖（`isOtherFile` 本身不改，它仍用于控制颜色）。

- [ ] **Step 4: 修改 `editor/index.tsx`**

```typescript
canAcceptFile: (p) => p.endsWith('.md') && !p.endsWith('.excalidraw.md'),
```

- [ ] **Step 5: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无报错

- [ ] **Step 6: Commit**

```bash
git add src/lib/pluginRegistry.ts src/stores/workspaceStore.ts src/plugins/files/FilesPanel.tsx src/plugins/editor/index.tsx
git commit -m "refactor: canAcceptFile takes full path to support compound extensions"
```

---

## Task 3: 更新 viewRegistry 测试

**Files:**
- Modify: `src/lib/__tests__/viewRegistry.test.ts`

- [ ] **Step 1: 更新测试文件**

将测试文件中所有 `getFileViewForExt` 替换为 `getFileViewForPath`，并将测试中的 ext 参数改为完整路径（或带扩展名的文件名）：

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerView,
  getView,
  getFileViewForPath,
  _clearViewRegistryForTest,
} from '../pluginRegistry'

beforeEach(() => _clearViewRegistryForTest())

const makeFileDef = (type: string, match: string) => ({
  kind: 'file' as const,
  type,
  getDisplayText: (p: string) => p.split('/').pop()!,
  canAcceptFile: (p: string) => p.endsWith(match),
  component: (() => null) as any,
})

describe('getView', () => {
  it('returns undefined for unregistered type', () => {
    expect(getView('markdown')).toBeUndefined()
  })
  it('returns the registered def', () => {
    const def = makeFileDef('markdown', '.md')
    registerView(def)
    expect(getView('markdown')).toBe(def)
  })
})

describe('getFileViewForPath', () => {
  it('returns undefined when no match', () => {
    expect(getFileViewForPath('notes/file.xyz')).toBeUndefined()
  })
  it('matches by extension', () => {
    const def = makeFileDef('markdown', '.md')
    registerView(def)
    expect(getFileViewForPath('notes/file.md')).toBe(def)
    expect(getFileViewForPath('notes/file.png')).toBeUndefined()
  })
  it('compound extension takes priority when registered first', () => {
    const excalidrawDef = makeFileDef('excalidraw', '.excalidraw.md')
    const mdDef = makeFileDef('markdown', '.md')
    registerView(excalidrawDef)
    registerView(mdDef)
    expect(getFileViewForPath('drawing.excalidraw.md')).toBe(excalidrawDef)
    expect(getFileViewForPath('notes/file.md')).toBe(mdDef)
  })
  it('ignores page defs', () => {
    registerView({
      kind: 'page',
      type: 'calendar',
      getDisplayText: () => '日历',
      component: (() => null) as any,
    })
    expect(getFileViewForPath('file.md')).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行测试**

```bash
npx vitest run src/lib/__tests__/viewRegistry.test.ts
```

Expected: 全部 pass

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/viewRegistry.test.ts
git commit -m "test: update viewRegistry tests for getFileViewForPath"
```

---

## Task 4: 实现 excalidrawFormat.ts（TDD）

**Files:**
- Create: `src/plugins/excalidraw/__tests__/excalidrawFormat.test.ts`
- Create: `src/plugins/excalidraw/excalidrawFormat.ts`

- [ ] **Step 1: 创建测试文件**

```bash
mkdir -p src/plugins/excalidraw/__tests__
```

新建 `src/plugins/excalidraw/__tests__/excalidrawFormat.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import LZString from 'lz-string'
import {
  parseExcalidrawMd,
  serializeExcalidrawMd,
  EMPTY_EXCALIDRAW_MD,
  type ExcalidrawData,
} from '../excalidrawFormat'

const SAMPLE_DATA: ExcalidrawData = {
  type: 'excalidraw',
  version: 2,
  source: 'symbol-notes',
  elements: [],
  appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
  files: {},
}

const PARSED_FILE = `---
excalidraw-plugin: parsed
tags: [excalidraw]
---
==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this panel. ⚠==

# Text Elements

%%
# Drawing
\`\`\`json
${JSON.stringify(SAMPLE_DATA)}
\`\`\`
%%
`

describe('parseExcalidrawMd — parsed mode', () => {
  it('extracts data and mode', () => {
    const result = parseExcalidrawMd(PARSED_FILE)
    expect(result.mode).toBe('parsed')
    expect(result.data.type).toBe('excalidraw')
    expect(result.data.elements).toEqual([])
    expect(result.data.appState.viewBackgroundColor).toBe('#ffffff')
  })

  it('throws on missing frontmatter', () => {
    expect(() => parseExcalidrawMd('no frontmatter here')).toThrow()
  })

  it('throws on missing %% block', () => {
    const broken = `---\nexcalidraw-plugin: parsed\n---\nno drawing block`
    expect(() => parseExcalidrawMd(broken)).toThrow()
  })
})

describe('parseExcalidrawMd — compressed mode', () => {
  it('decompresses and extracts data', () => {
    const compressed = LZString.compressToBase64(JSON.stringify(SAMPLE_DATA))
    const file = `---
excalidraw-plugin: compressed
tags: [excalidraw]
---
==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this panel. ⚠==

# Text Elements

%%
# Drawing
\`\`\`compressed-json
${compressed}
\`\`\`
%%
`
    const result = parseExcalidrawMd(file)
    expect(result.mode).toBe('compressed')
    expect(result.data.type).toBe('excalidraw')
    expect(result.data.elements).toEqual([])
  })
})

describe('serializeExcalidrawMd', () => {
  it('roundtrip: parsed mode', () => {
    const serialized = serializeExcalidrawMd(SAMPLE_DATA, 'parsed')
    const reparsed = parseExcalidrawMd(serialized)
    expect(reparsed.mode).toBe('parsed')
    expect(reparsed.data).toEqual(SAMPLE_DATA)
  })

  it('roundtrip: compressed mode', () => {
    const serialized = serializeExcalidrawMd(SAMPLE_DATA, 'compressed')
    const reparsed = parseExcalidrawMd(serialized)
    expect(reparsed.mode).toBe('compressed')
    expect(reparsed.data).toEqual(SAMPLE_DATA)
  })

  it('writes text elements from data', () => {
    const dataWithText: ExcalidrawData = {
      ...SAMPLE_DATA,
      elements: [
        { id: 'abc123', type: 'text', text: 'Hello world', x: 0, y: 0 },
        { id: 'def456', type: 'rectangle', x: 0, y: 0 },
      ],
    }
    const serialized = serializeExcalidrawMd(dataWithText, 'parsed')
    expect(serialized).toContain('abc123:: Hello world')
    expect(serialized).not.toContain('def456')
  })

  it('uses compressed-json block for compressed mode', () => {
    const serialized = serializeExcalidrawMd(SAMPLE_DATA, 'compressed')
    expect(serialized).toContain('```compressed-json')
    expect(serialized).toContain('excalidraw-plugin: compressed')
  })
})

describe('EMPTY_EXCALIDRAW_MD', () => {
  it('is valid and parses as parsed mode', () => {
    const result = parseExcalidrawMd(EMPTY_EXCALIDRAW_MD)
    expect(result.mode).toBe('parsed')
    expect(result.data.elements).toEqual([])
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run src/plugins/excalidraw/__tests__/excalidrawFormat.test.ts
```

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `excalidrawFormat.ts`**

新建 `src/plugins/excalidraw/excalidrawFormat.ts`：

```typescript
import LZString from 'lz-string'

export type ExcalidrawMode = 'parsed' | 'compressed'

export interface ExcalidrawElement {
  id: string
  type: string
  text?: string
  [key: string]: unknown
}

export interface ExcalidrawData {
  type: 'excalidraw'
  version: number
  source?: string
  elements: ExcalidrawElement[]
  appState: Record<string, unknown>
  files: Record<string, unknown>
}

export interface ParseResult {
  data: ExcalidrawData
  mode: ExcalidrawMode
}

const FRONTMATTER_MODE_RE = /^---[\s\S]*?excalidraw-plugin:\s*(parsed|compressed)/
const PARSED_BLOCK_RE = /%%[\s\S]*?```json\s*\n([\s\S]*?)\n```[\s\S]*?%%/
const COMPRESSED_BLOCK_RE = /%%[\s\S]*?```compressed-json\s*\n([\s\S]*?)\n```[\s\S]*?%%/

export function parseExcalidrawMd(content: string): ParseResult {
  const modeMatch = FRONTMATTER_MODE_RE.exec(content)
  if (!modeMatch) throw new Error('Not a valid Excalidraw file: missing excalidraw-plugin frontmatter')
  const mode = modeMatch[1] as ExcalidrawMode

  let jsonStr: string
  if (mode === 'parsed') {
    const m = PARSED_BLOCK_RE.exec(content)
    if (!m) throw new Error('Missing ```json block in Excalidraw file')
    jsonStr = m[1]
  } else {
    const m = COMPRESSED_BLOCK_RE.exec(content)
    if (!m) throw new Error('Missing ```compressed-json block in Excalidraw file')
    const decompressed = LZString.decompressFromBase64(m[1])
    if (!decompressed) throw new Error('Failed to decompress Excalidraw data')
    jsonStr = decompressed
  }

  const data = JSON.parse(jsonStr) as ExcalidrawData
  return { data, mode }
}

function buildTextElements(elements: ExcalidrawElement[]): string {
  return elements
    .filter((el) => el.type === 'text' && el.text)
    .map((el) => `${el.id}:: ${el.text}`)
    .join('\n')
}

export function serializeExcalidrawMd(data: ExcalidrawData, mode: ExcalidrawMode): string {
  const textElements = buildTextElements(data.elements)
  const drawingBlock =
    mode === 'parsed'
      ? `\`\`\`json\n${JSON.stringify(data)}\n\`\`\``
      : `\`\`\`compressed-json\n${LZString.compressToBase64(JSON.stringify(data))}\n\`\`\``

  return `---
excalidraw-plugin: ${mode}
tags: [excalidraw]
---
==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this panel. ⚠==

# Text Elements
${textElements}

%%
# Drawing
${drawingBlock}
%%
`
}

export const EMPTY_EXCALIDRAW_DATA: ExcalidrawData = {
  type: 'excalidraw',
  version: 2,
  source: 'symbol-notes',
  elements: [],
  appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
  files: {},
}

export const EMPTY_EXCALIDRAW_MD = serializeExcalidrawMd(EMPTY_EXCALIDRAW_DATA, 'parsed')
```

- [ ] **Step 4: 运行测试，确认全部通过**

```bash
npx vitest run src/plugins/excalidraw/__tests__/excalidrawFormat.test.ts
```

Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/excalidraw/excalidrawFormat.ts src/plugins/excalidraw/__tests__/excalidrawFormat.test.ts
git commit -m "feat: add excalidrawFormat parser/serializer with parsed+compressed support"
```

---

## Task 5: 实现 ExcalidrawViewer.tsx

**Files:**
- Create: `src/plugins/excalidraw/ExcalidrawViewer.tsx`

- [ ] **Step 1: 新建组件文件**

新建 `src/plugins/excalidraw/ExcalidrawViewer.tsx`：

```tsx
import { createEffect, on, onCleanup, onMount } from 'solid-js'
import { readFile, writeFile } from '../../services/fileIO'
import { setRuntimeStore } from '../../stores/runtimeStore'
import type { ViewComponentProps } from '../../stores/types'
import {
  parseExcalidrawMd,
  serializeExcalidrawMd,
  type ExcalidrawData,
  type ExcalidrawMode,
} from './excalidrawFormat'

export function ExcalidrawViewer(props: ViewComponentProps) {
  const filePath = () => props.viewState.file as string | undefined

  let container!: HTMLDivElement
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let reactRoot: any = null
  let currentMode: ExcalidrawMode = 'parsed'
  let currentData: ExcalidrawData | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let localDirty = false

  function setDirty(dirty: boolean) {
    localDirty = dirty
    if (props.isActive) {
      setRuntimeStore('leafInstances', props.leafId, (prev) => ({
        cmView: null,
        isDirty: dirty,
        outLinks: [],
        headings: [],
        ...(prev ?? {}),
        isDirty: dirty,
      }))
    }
  }

  async function doSave(): Promise<void> {
    const p = filePath()
    if (!p || !currentData) return
    await writeFile(p, serializeExcalidrawMd(currentData, currentMode))
    setDirty(false)
  }

  function scheduleSave() {
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void doSave()
    }, 1000)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleChange(elements: any[], appState: any, files: any) {
    currentData = {
      type: 'excalidraw',
      version: 2,
      source: 'symbol-notes',
      elements,
      appState: {
        gridSize: appState.gridSize ?? null,
        viewBackgroundColor: appState.viewBackgroundColor ?? '#ffffff',
      },
      files: files ?? {},
    }
    setDirty(true)
    scheduleSave()
  }

  onMount(async () => {
    const p = filePath()
    if (!p) return

    let data: ExcalidrawData
    let mode: ExcalidrawMode
    try {
      const content = await readFile(p)
      const parsed = parseExcalidrawMd(content)
      data = parsed.data
      mode = parsed.mode
    } catch (err) {
      container.textContent = `[绘图文件加载失败: ${err instanceof Error ? err.message : String(err)}]`
      return
    }

    currentData = data
    currentMode = mode

    try {
      const [{ createRoot }, { createElement }, { Excalidraw }] = await Promise.all([
        import('react-dom/client'),
        import('react'),
        import('@excalidraw/excalidraw'),
      ])
      reactRoot = createRoot(container)
      reactRoot.render(
        createElement(Excalidraw as any, {
          initialData: {
            elements: data.elements,
            appState: data.appState,
            files: data.files,
          },
          onChange: handleChange,
        }),
      )
    } catch (err) {
      container.textContent = `[绘图组件加载失败: ${err instanceof Error ? err.message : String(err)}]`
    }
  })

  onCleanup(() => {
    if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
    reactRoot?.unmount()
    reactRoot = null
  })

  // Ctrl+S 保存（window 级别监听，isActive 时生效）
  onMount(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!props.isActive) return
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
        void doSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    onCleanup(() => window.removeEventListener('keydown', onKeyDown))
  })

  // 切换 tab 时自动保存
  createEffect(on(
    () => props.isActive,
    (isActive, prevIsActive) => {
      if (prevIsActive && !isActive && localDirty) {
        if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
        void doSave()
      }
    },
  ))

  return (
    <div class="flex-1 w-full overflow-hidden" style={{ height: '100%' }}>
      <div ref={container} class="w-full h-full" />
    </div>
  )
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无报错（`any` cast 处理了 React 类型兼容问题）

- [ ] **Step 3: Commit**

```bash
git add src/plugins/excalidraw/ExcalidrawViewer.tsx
git commit -m "feat: add ExcalidrawViewer SolidJS component with React mount"
```

---

## Task 6: 实现 excalidraw/index.tsx 插件注册

**Files:**
- Create: `src/plugins/excalidraw/index.tsx`

Context: 插件需要注册三样东西：
1. `file` 视图（`.excalidraw.md` 和 `.excalidraw` 扩展名）
2. Ribbon 图标（`PenLine`，点击在根目录新建）
3. `directory` 上下文菜单（右键文件夹 → 在该目录新建）

创建文件的逻辑：调用 `fileActions.createFile(name)` + `writeFile(path, EMPTY_EXCALIDRAW_MD)` + `workspaceActions.openFile(path)`。

- [ ] **Step 1: 新建插件文件**

新建 `src/plugins/excalidraw/index.tsx`：

```tsx
import { PenLine } from 'lucide-solid'
import { definePlugin } from '../../lib/pluginRegistry'
import { fileActions } from '../../stores/runtimeStore'
import { vaultStore } from '../../stores/vaultStore'
import { workspaceActions } from '../../stores/workspaceStore'
import { writeFile } from '../../services/fileIO'
import { EMPTY_EXCALIDRAW_MD } from './excalidrawFormat'
import { ExcalidrawViewer } from './ExcalidrawViewer'

function getUniqueName(dirPath: string | null): string {
  const prefix = dirPath ? `${dirPath}/` : ''
  if (!vaultStore.files[`${prefix}Untitled.excalidraw.md`]) return 'Untitled.excalidraw.md'
  for (let i = 1; i <= 99; i++) {
    const name = `Untitled ${i}.excalidraw.md`
    if (!vaultStore.files[`${prefix}${name}`]) return name
  }
  return `Untitled ${Date.now()}.excalidraw.md`
}

async function createExcalidrawFile(dirPath: string | null): Promise<void> {
  const name = getUniqueName(dirPath)
  const fullName = dirPath ? `${dirPath}/${name}` : name
  const path = await fileActions.createFile(fullName)
  if (!path) return
  await writeFile(path, EMPTY_EXCALIDRAW_MD)
  workspaceActions.openFile(path)
}

export const ExcalidrawPlugin = definePlugin({
  id: 'excalidraw',
  name: 'Excalidraw',
  description: 'Excalidraw 绘图编辑器',
  defaultEnabled: true,
  setup(ctx) {
    ctx.view({
      kind: 'file',
      type: 'excalidraw',
      getDisplayText: (p) => {
        const name = p.split('/').pop() ?? p
        if (name.endsWith('.excalidraw.md')) return name.slice(0, -14)
        if (name.endsWith('.excalidraw')) return name.slice(0, -11)
        return name
      },
      canAcceptFile: (p) => p.endsWith('.excalidraw.md') || p.endsWith('.excalidraw'),
      component: ExcalidrawViewer,
    })

    ctx.ribbon({
      id: 'new-excalidraw',
      title: '新建 Excalidraw 绘图',
      getIcon: () => <PenLine size={18} />,
      onClick: () => void createExcalidrawFile(null),
    })

    ctx.contextMenu('directory', (d) => {
      const dirPath = d.path ?? null
      return [
        { label: '新建 Excalidraw 绘图', action: () => void createExcalidrawFile(dirPath) },
      ]
    })
  },
})
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无报错

- [ ] **Step 3: Commit**

```bash
git add src/plugins/excalidraw/index.tsx
git commit -m "feat: add Excalidraw plugin registration with ribbon and context menu"
```

---

## Task 7: 注册插件并验证

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 在 `App.tsx` 中注册插件**

在 `src/App.tsx` 中，在其他插件 import 后添加：
```typescript
import { ExcalidrawPlugin } from './plugins/excalidraw'
```

在 `registerPlugin(EditorPlugin)` 之前添加（需在 EditorPlugin 前注册，因为 `getFileViewForPath` 返回第一个匹配项，Excalidraw 插件的 `canAcceptFile` 比 EditorPlugin 更具体）：
```typescript
registerPlugin(ExcalidrawPlugin)
registerPlugin(EditorPlugin)  // 已有，不动
```

- [ ] **Step 2: 运行全部测试**

```bash
npx vitest run
```

Expected: 全部 PASS

- [ ] **Step 3: 启动开发服务器验证功能**

```bash
npm run dev
```

验证清单：
- [ ] 左侧 Ribbon 出现 `PenLine` 图标
- [ ] 点击 Ribbon 图标，创建 `Untitled.excalidraw.md` 并在主区域打开 Excalidraw 编辑器
- [ ] 在文件树中右键文件夹，菜单出现"新建 Excalidraw 绘图"
- [ ] 绘图后切换 tab，StatusBar 显示"已保存"
- [ ] 普通 `.md` 文件仍用 EditorViewer 打开（不受影响）

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: register ExcalidrawPlugin in App"
```

---

## 自检结果

**Spec coverage:**
- [x] 文件路由修复（Task 2）
- [x] parsed 模式解析/序列化（Task 4）
- [x] compressed 模式解析/序列化（Task 4）
- [x] Text Elements 区域生成（Task 4，`buildTextElements`）
- [x] ExcalidrawViewer 生命周期（Task 5）
- [x] debounce 1s 自动保存（Task 5，`scheduleSave`）
- [x] Ctrl+S 立即保存（Task 5）
- [x] 切换 tab 自动保存（Task 5）
- [x] 错误处理（Task 5）
- [x] Ribbon 新建（Task 6）
- [x] 目录右键菜单新建（Task 6）
- [x] 唯一文件名生成（Task 6，`getUniqueName`）
- [x] 依赖安装（Task 1）
- [x] 插件注册顺序（Task 7，Excalidraw 在 Editor 前）

**类型一致性：**
- `ExcalidrawData` 在 `excalidrawFormat.ts` 定义，`ExcalidrawViewer.tsx` 从同一文件导入
- `ExcalidrawMode` 同上
- `EMPTY_EXCALIDRAW_MD` 从 `excalidrawFormat.ts` 导出，`index.tsx` 导入使用
- `parseExcalidrawMd` 返回 `ParseResult { data, mode }`，Viewer 解构使用

**已知限制（不在本次范围）：**
- `![[drawing.excalidraw.md]]` 嵌入预览暂不实现
- `fileActions.createFile` 内部只添加 `.md` 如果缺少，`.excalidraw.md` 本身已有 `.md` 所以正确处理
