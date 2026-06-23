# 双链上下文地基 + 多列时间轴 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把双链从扁平字符串升级为带本地上下文(标题/同行标签/锚点/位置)的结构,支撑点击精确跳转,并把焦点时间轴重做成「BFS 邻域 + 多列过滤」视图。

**Architecture:** `FileMeta.outLinks` 由 `string[]` 改为 `WikiLinkInfo[]`,只存自身文件的本地事实,不存 resolve 结果(`target name → path` 仍查询时走 `stemIndex`/`aliasIndex`)。CM6 `outLinksField` 产出上下文,`parseMarkdown` 蒸馏为 `WikiLinkInfo`。跳转用纯定位器在活文档里现找位置。时间轴用无向 BFS + 整层预算 + 列过滤。

**Tech Stack:** SolidJS、TypeScript、CodeMirror 6(`@codemirror/state`/`view`/`language`、`@lezer/markdown`)、Vitest(node 环境)。

设计依据:`docs/superpowers/specs/2026-06-23-link-context-timeline-design.md`。

## Global Constraints

- 语言:注释 / commit message / UI 文案以中文为主;变量与类型名用英文(项目惯例)。
- 应用本体是 **SolidJS**,组件用 `createSignal`/`createStore`/`<Show>`/`<For>`,**不要写 React**。
- 解析层不懂语义:`outLinksField`/`parseMarkdown` 只产结构,含义留给渲染插件。
- 测试环境 `node`(`vite.config.ts`);纯逻辑配 `__tests__`。运行:`npx vitest run <file>`。
- 提交前 `npm run build`(含 `tsc`)与 `npx vitest run` 均须通过。
- commit 信息遵循 `type(scope): 描述`,结尾加 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- 已在分支 `feat/link-context-timeline` 上;spec 已提交(`c19bef4b`)。

---

## File Structure

| 文件 | 责任 |
|---|---|
| `src/lib/cm6/wikiTarget.ts`(新) | `splitWikiTarget(raw)`:把 `[[]]` 原始目标切成 `{ base, anchor }` |
| `src/lib/cm6/headingStack.ts`(新) | 标题栈纯逻辑 `pushHeading` + `headingTextFromNode` |
| `src/lib/cm6/outLinksField.ts` | `OutLink` 增上下文字段;维护标题栈;wiki 链接按出现位置(不去重)产出 |
| `src/lib/parseMarkdown.ts` | `ParseResult.outLinks: WikiLinkInfo[]`;join 同行标签 |
| `src/stores/types.ts` | 新增 `WikiLinkInfo`;`FileMeta.outLinks: WikiLinkInfo[]` |
| `src/vault/indexStorage.ts` | store 升 `sn-meta-v3`(`CachedFields.outLinks` 元素类型随 `FileMeta` 变) |
| `src/vault/backlinks.ts` | 遍历 outLinks 处改读 `l.target`(按 target 去重喂索引) |
| `src/vault/index.ts` | `reindexFile`/`remapFileLink` 适配;`openFileAt` 工作区能力 |
| `src/lib/linkLocate.ts`(新) | `findWikiLink` / `findHeading` 纯定位器 |
| `src/stores/workspaceStore.ts` | `openFileAt` + leaf 上的 reveal 挂载/消费契约 |
| `src/plugins/links/index.tsx` | 入链点击带 reveal;按 headingPath 分组 |
| `src/plugins/timeline/selection.ts` | `buildSelection` → `buildNeighborhood`(BFS + 预算 + Edge 上下文) |
| `src/plugins/timeline/columns.ts`(新) | `assignColumns` 归列纯函数 + 类型 `Column`/`ColumnFilter` |
| `src/plugins/timeline/events.ts` | 事件聚合归列依据 |
| `src/plugins/timeline/TimelineView.tsx` | 多列渲染 + 列配置 UI;卡片带 reveal |

权威类型(后续任务引用):

```ts
// src/stores/types.ts
export interface WikiLinkInfo {
  target: string        // base + .md 归一(已剥离 anchor),== 喂索引的目标名
  alias?: string        // [[目标|别名]]
  anchor?: string       // [[目标#标题]] 的 # 后半段
  headingPath: string[] // 所属 ## 标题路径,如 ["实验记录","计划"]
  lineTags: string[]    // 与链接同一行的 #标签(不含 #)
  from: number          // 链接在本文件中的起始 offset
  to: number            // 结束 offset
}
```

---

## Phase A — 地基:数据模型 + 解析

### Task 1: `splitWikiTarget` 纯函数

把 `[[]]` 原始目标文本切成 base 与 anchor,供解析与跳转复用(DRY)。

**Files:**
- Create: `src/lib/cm6/wikiTarget.ts`
- Test: `src/lib/cm6/__tests__/wikiTarget.test.ts`

**Interfaces:**
- Produces: `splitWikiTarget(raw: string): { base: string; anchor?: string }`

- [ ] **Step 1: 写失败测试**

```ts
// src/lib/cm6/__tests__/wikiTarget.test.ts
import { describe, it, expect } from 'vitest'
import { splitWikiTarget } from '../wikiTarget'

describe('splitWikiTarget', () => {
  it('无 anchor 时原样返回 base', () => {
    expect(splitWikiTarget('复测计划')).toEqual({ base: '复测计划' })
  })
  it('切出 anchor', () => {
    expect(splitWikiTarget('复测计划#计划')).toEqual({ base: '复测计划', anchor: '计划' })
  })
  it('保留路径,只在第一个 # 切', () => {
    expect(splitWikiTarget('folder/A#标题#x')).toEqual({ base: 'folder/A', anchor: '标题#x' })
  })
  it('空 anchor 视为无 anchor', () => {
    expect(splitWikiTarget('A#')).toEqual({ base: 'A' })
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/lib/cm6/__tests__/wikiTarget.test.ts`
Expected: FAIL（`splitWikiTarget` 未定义 / 模块不存在）

- [ ] **Step 3: 实现**

```ts
// src/lib/cm6/wikiTarget.ts
/** 把 [[]] 内原始目标切成 base 与 anchor（只在第一个 # 处切，空 anchor 视为无）。 */
export function splitWikiTarget(raw: string): { base: string; anchor?: string } {
  const i = raw.indexOf('#')
  if (i < 0) return { base: raw }
  const base = raw.slice(0, i)
  const anchor = raw.slice(i + 1)
  return anchor ? { base, anchor } : { base }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/lib/cm6/__tests__/wikiTarget.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/cm6/wikiTarget.ts src/lib/cm6/__tests__/wikiTarget.test.ts
git commit -m "feat(parse): splitWikiTarget 切分双链 base/anchor

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 标题栈纯逻辑

维护"链接所在 `## 标题路径",供 `outLinksField` 调用。

**Files:**
- Create: `src/lib/cm6/headingStack.ts`
- Test: `src/lib/cm6/__tests__/headingStack.test.ts`

**Interfaces:**
- Produces:
  - `type HeadingFrame = { text: string; level: number }`
  - `pushHeading(stack: HeadingFrame[], level: number, text: string): void`（就地维护：弹出所有 `level >= 当前` 的，再压栈）
  - `headingPathOf(stack: HeadingFrame[]): string[]`

- [ ] **Step 1: 写失败测试**

```ts
// src/lib/cm6/__tests__/headingStack.test.ts
import { describe, it, expect } from 'vitest'
import { pushHeading, headingPathOf, type HeadingFrame } from '../headingStack'

describe('headingStack', () => {
  it('逐级压栈得到路径', () => {
    const s: HeadingFrame[] = []
    pushHeading(s, 1, '实验记录')
    pushHeading(s, 2, '计划')
    expect(headingPathOf(s)).toEqual(['实验记录', '计划'])
  })
  it('同级标题替换而非叠加', () => {
    const s: HeadingFrame[] = []
    pushHeading(s, 2, '计划')
    pushHeading(s, 2, '反思')
    expect(headingPathOf(s)).toEqual(['反思'])
  })
  it('更高层级弹出更深层级', () => {
    const s: HeadingFrame[] = []
    pushHeading(s, 1, 'A')
    pushHeading(s, 2, 'B')
    pushHeading(s, 1, 'C')
    expect(headingPathOf(s)).toEqual(['C'])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/lib/cm6/__tests__/headingStack.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// src/lib/cm6/headingStack.ts
export type HeadingFrame = { text: string; level: number }

/** 弹出所有 level >= 当前的（它们的管辖已结束），再压入当前标题。就地修改 stack。 */
export function pushHeading(stack: HeadingFrame[], level: number, text: string): void {
  while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
  stack.push({ text, level })
}

export function headingPathOf(stack: HeadingFrame[]): string[] {
  return stack.map(f => f.text)
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/lib/cm6/__tests__/headingStack.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/cm6/headingStack.ts src/lib/cm6/__tests__/headingStack.test.ts
git commit -m "feat(parse): 标题栈纯逻辑 pushHeading/headingPathOf

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `outLinksField` 产出上下文

让 CM6 解析每条 wiki 链接时带上 `headingPath` 与 `from/to`,且**按出现位置产出(wiki 不再去重)**;`alias` 单独存。md/URL 链接保持去重、无上下文。

**Files:**
- Modify: `src/lib/cm6/outLinksField.ts`
- Test: `src/lib/cm6/__tests__/outLinksField.test.ts`(新)

**Interfaces:**
- Consumes: `pushHeading`/`headingPathOf`/`HeadingFrame`(Task 2)
- Produces: 增强后的 `OutLink`:

```ts
export interface OutLink {
  type: 'wiki' | 'md'
  target: string          // wiki: [[]] 内原始目标文本（含 anchor，未归一）；md: url
  label: string
  alias?: string          // wiki only
  headingPath?: string[]  // wiki only
  from?: number           // wiki only：链接起始 offset
  to?: number             // wiki only：链接结束 offset
}
```

- [ ] **Step 1: 写失败测试**

```ts
// src/lib/cm6/__tests__/outLinksField.test.ts
import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { wikiLinkParser } from '../wikiLinkParser'
import { outLinksField } from '../outLinksField'

function parse(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: [GFM, wikiLinkParser] }), outLinksField],
  })
  return state.field(outLinksField)
}

describe('outLinksField 上下文', () => {
  it('记录 headingPath 与位置', () => {
    const links = parse('# 实验记录\n## 计划\n见 [[复测计划]] 后续')
    const wiki = links.filter(l => l.type === 'wiki')
    expect(wiki).toHaveLength(1)
    expect(wiki[0].target).toBe('复测计划')
    expect(wiki[0].headingPath).toEqual(['实验记录', '计划'])
    expect(typeof wiki[0].from).toBe('number')
    expect(wiki[0].to).toBeGreaterThan(wiki[0].from!)
  })

  it('同一目标出现两次 → 两条（不去重）', () => {
    const links = parse('[[A]] 又 [[A]]')
    expect(links.filter(l => l.type === 'wiki')).toHaveLength(2)
  })

  it('别名单独存', () => {
    const links = parse('[[复测计划|计划详情]]')
    const w = links.find(l => l.type === 'wiki')!
    expect(w.target).toBe('复测计划')
    expect(w.alias).toBe('计划详情')
  })

  it('首个标题前的链接 headingPath 为空', () => {
    const links = parse('开头就 [[A]]')
    expect(links.find(l => l.type === 'wiki')!.headingPath).toEqual([])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/lib/cm6/__tests__/outLinksField.test.ts`
Expected: FAIL（`headingPath` undefined / 去重导致只有 1 条）

- [ ] **Step 3: 实现**

在 `src/lib/cm6/outLinksField.ts` 顶部加导入并改写 `OutLink` 接口与 `extractOutLinks`。`OutLink` 接口替换为上面 Interfaces 里的版本。`extractOutLinks` 改为:

```ts
import { syntaxTree } from '@codemirror/language'
import { StateField } from '@codemirror/state'
import type { EditorState } from '@codemirror/state'
import { pushHeading, headingPathOf, type HeadingFrame } from './headingStack'

// （OutLink 接口见 Interfaces）

const HEADING_RE = /^(#{1,6})\s+(.*)$/

function extractOutLinks(state: EditorState): OutLink[] {
  const links: OutLink[] = []
  const seenMd = new Set<string>()
  const stack: HeadingFrame[] = []

  syntaxTree(state).iterate({
    from: 0,
    to: state.doc.length,
    enter(node) {
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') return false

      if (/^ATXHeading[1-6]$/.test(node.name)) {
        const line = state.doc.lineAt(node.from).text
        const m = HEADING_RE.exec(line)
        if (m) pushHeading(stack, m[1].length, m[2].trim())
        return false
      }

      if (node.name === 'WikiLink') {
        const c = node.node.cursor()
        let target = '', alias = ''
        if (c.firstChild()) {
          do {
            if (c.name === 'WikiLinkTarget') target = state.doc.sliceString(c.from, c.to)
            else if (c.name === 'WikiLinkAlias') alias = state.doc.sliceString(c.from, c.to)
          } while (c.nextSibling())
        }
        if (target) {
          links.push({
            type: 'wiki',
            target,
            label: alias || target,
            alias: alias || undefined,
            headingPath: headingPathOf(stack),
            from: node.from,
            to: node.to,
          })
        }
        return false
      }

      if (node.name === 'Autolink') {
        let url = state.doc.sliceString(node.from, node.to)
        if (url.startsWith('<') && url.endsWith('>')) url = url.slice(1, -1)
        if (url && !seenMd.has(url)) {
          seenMd.add(url)
          links.push({ type: 'md', target: url, label: url })
        }
        return false
      }

      if (node.name === 'Link' || node.name === 'Image') {
        const c = node.node.cursor()
        let url = '', urlFrom = -1, labelText = ''
        if (c.firstChild()) {
          do {
            if (c.name === 'URL') { url = state.doc.sliceString(c.from, c.to); urlFrom = c.from }
          } while (c.nextSibling())
        }
        if (url) {
          if (urlFrom > node.from + 1) {
            const labelStart = node.name === 'Image' ? node.from + 2 : node.from + 1
            labelText = state.doc.sliceString(labelStart, urlFrom - 2).trim()
          }
          if (!seenMd.has(url)) {
            seenMd.add(url)
            links.push({ type: 'md', target: url, label: labelText || url })
          }
        }
        return false
      }
    },
  })

  return links
}
```

`outLinksField` 的 `StateField.define` 不变（仍 `create: extractOutLinks` / `update` 重算）。

> 说明：标题文本用 `doc.lineAt(node.from).text` + 正则取，简单稳；Setext 标题在本项目少见，v1 只处理 ATX。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/lib/cm6/__tests__/outLinksField.test.ts`
Expected: PASS

- [ ] **Step 5: 类型检查（OutLink 改动不破坏面板/runtime）**

Run: `npm run build`
Expected: tsc 通过（新增字段均为可选，`LeafRuntimeState.outLinks: OutLink[]` 与面板兼容）

- [ ] **Step 6: 提交**

```bash
git add src/lib/cm6/outLinksField.ts src/lib/cm6/__tests__/outLinksField.test.ts
git commit -m "feat(parse): outLinksField 产出 headingPath/位置，wiki 不去重

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 模型翻转 —— `FileMeta.outLinks: WikiLinkInfo[]`

把 `parseMarkdown` 蒸馏出 `WikiLinkInfo`（含 `lineTags` join），翻转 `FileMeta`/`CachedFields` 类型，并把所有读 `outLinks` 当 `string[]` 的地方改读 `l.target`。这是原子改动，跨多文件一次编译通过。

**Files:**
- Modify: `src/stores/types.ts`（加 `WikiLinkInfo`，改 `FileMeta.outLinks`）
- Modify: `src/lib/parseMarkdown.ts`
- Modify: `src/vault/indexStorage.ts`（store 升 `sn-meta-v3`）
- Modify: `src/vault/backlinks.ts`
- Modify: `src/vault/index.ts`
- Modify: `src/plugins/timeline/selection.ts`（读 `l.target`，保持 1 跳行为，Task 8 再重做）
- Test: `src/lib/__tests__/parseMarkdown.test.ts`（补 lineTags 用例）

**Interfaces:**
- Consumes: `OutLink`（Task 3）、`splitWikiTarget`（Task 1）、`TagMatch`（`inlineTagsField`，含 `from`）
- Produces: `ParseResult.outLinks: WikiLinkInfo[]`；`FileMeta.outLinks: WikiLinkInfo[]`

- [ ] **Step 1: 写失败测试（lineTags + 结构）**

在 `src/lib/__tests__/parseMarkdown.test.ts` 追加：

```ts
import { describe, it, expect } from 'vitest'
import { parseMarkdown } from '../parseMarkdown'

describe('parseMarkdown WikiLinkInfo', () => {
  it('outLinks 是结构数组，归一 target 并切 anchor', () => {
    const r = parseMarkdown('## 计划\n[[复测计划#步骤|看这里]] #想法')
    expect(r.outLinks).toHaveLength(1)
    const l = r.outLinks[0]
    expect(l.target).toBe('复测计划.md')
    expect(l.anchor).toBe('步骤')
    expect(l.alias).toBe('看这里')
    expect(l.headingPath).toEqual(['计划'])
    expect(l.lineTags).toEqual(['想法'])     // 同行标签
    expect(typeof l.from).toBe('number')
  })

  it('不同行的标签不计入 lineTags', () => {
    const r = parseMarkdown('[[A]]\n#别处')
    expect(r.outLinks[0].lineTags).toEqual([])
  })

  it('已带 .md 的目标不重复加后缀', () => {
    const r = parseMarkdown('[[folder/B.md]]')
    expect(r.outLinks[0].target).toBe('folder/B.md')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/lib/__tests__/parseMarkdown.test.ts`
Expected: FAIL（`outLinks[0]` 仍是字符串，无 `.target`/`.lineTags`）

- [ ] **Step 3: 改 `types.ts`**

在 `src/stores/types.ts` 加 `WikiLinkInfo`（见上文权威类型），并把 `FileMeta.outLinks: string[]` 改为：

```ts
  outLinks: WikiLinkInfo[]
```

- [ ] **Step 4: 改 `parseMarkdown.ts`**

```ts
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { wikiLinkParser } from './cm6/wikiLinkParser'
import { outLinksField } from './cm6/outLinksField'
import { inlineTagsField } from './cm6/inlineTagsField'
import { listsField } from './cm6/listsField'
import { splitWikiTarget } from './cm6/wikiTarget'
import type { ListItem, WikiLinkInfo } from '../stores/types'

export interface ParseResult {
  outLinks: WikiLinkInfo[]
  inlineTags: string[]
  lists: ListItem[]
}

const EXTENSIONS = [
  markdown({ extensions: [GFM, wikiLinkParser] }),
  outLinksField,
  inlineTagsField,
  listsField,
]

function extractResult(state: EditorState): ParseResult {
  const tagMatches = state.field(inlineTagsField)
  const lineOfTag = new Map<number, string[]>()
  for (const t of tagMatches) {
    const ln = state.doc.lineAt(t.from).number
    const arr = lineOfTag.get(ln) ?? []
    arr.push(t.tag)
    lineOfTag.set(ln, arr)
  }

  const outLinks: WikiLinkInfo[] = state.field(outLinksField)
    .filter(l => l.type === 'wiki')
    .map(l => {
      const { base, anchor } = splitWikiTarget(l.target)
      const target = base.endsWith('.md') ? base : `${base}.md`
      const ln = l.from != null ? state.doc.lineAt(l.from).number : -1
      return {
        target,
        alias: l.alias,
        anchor,
        headingPath: l.headingPath ?? [],
        lineTags: lineOfTag.get(ln) ?? [],
        from: l.from ?? 0,
        to: l.to ?? 0,
      }
    })

  return {
    outLinks,
    inlineTags: state.field(inlineTagsField).map(m => m.tag),
    lists: state.field(listsField),
  }
}

// One-shot parse — creates a fresh EditorState each call.
export function parseMarkdown(content: string): ParseResult {
  return extractResult(EditorState.create({ doc: content, extensions: EXTENSIONS }))
}

// Reusable parser — initialises extensions once, replaces doc via transaction.
export function createMarkdownParser(): { parse(content: string): ParseResult } {
  let state = EditorState.create({ doc: '', extensions: EXTENSIONS })
  return {
    parse(content: string): ParseResult {
      state = state.update({
        changes: { from: 0, to: state.doc.length, insert: content },
      }).state
      return extractResult(state)
    },
  }
}
```

- [ ] **Step 5: 改 `indexStorage.ts`（升 store 版本）**

把 `parsedMetaStore` 一行改为：

```ts
// v3: outLinks 由 string[] 升级为 WikiLinkInfo[]，旧缓存失效以触发重解析
const parsedMetaStore = createStore('sn-meta-v3', 'cache')
```

`CachedFields` 是 `Pick<FileMeta, ... 'outLinks' ...>`，类型随 `FileMeta` 自动更新，无需手改。

- [ ] **Step 6: 改 `backlinks.ts`（读 `l.target`，按 target 去重喂索引）**

`buildLinkMaps` 内层循环改为按唯一 target：

```ts
  for (const [src, meta] of Object.entries(files)) {
    for (const target of new Set(meta.outLinks.map(l => l.target))) {
      const resolved = resolveLink(target, stemIndex, files, aliasIndex)
      if (resolved) (backlinkMap[resolved] ??= []).push(src)
      else (unresolvedMap[target] ??= []).push(src)
    }
  }
```

`buildLinkMaps` 的入参类型从 `{ outLinks: string[] }` 改为 `{ outLinks: { target: string }[] }`（或直接 `Pick<FileMeta,'outLinks'>`）。`removeFileBacklinks` 内 `for (const t of file.outLinks)` 改为：

```ts
  for (const t of new Set(file.outLinks.map(l => l.target))) {
```

`applyFileBacklinks(path, prevOutLinks, nextOutLinks)` 签名**保持 `string[]`**（它只需 target），由调用方传 target 数组（见 Step 7）。

- [ ] **Step 7: 改 `vault/index.ts`**

`reindexFile` 里调用 `applyFileBacklinks` 处改为传 target 数组：

```ts
  applyFileBacklinks(
    path,
    (prev?.outLinks ?? []).map(l => l.target),
    fields.outLinks.map(l => l.target),
  )
```

`remapFileLink` 改为映射对象：

```ts
  const nextOutLinks = prevOutLinks.map(l =>
    l.target === oldTarget ? { ...l, target: newTarget } : l,
  )
  setVaultStore('files', filePath, 'outLinks', nextOutLinks)
  applyFileBacklinks(
    filePath,
    prevOutLinks.map(l => l.target),
    nextOutLinks.map(l => l.target),
  )
```

`createFile`/`createFolder`/`renameFile`/`moveFile`/`moveFolder` 里的初始化对象 `outLinks: []` **无需改**（`[]` 对 `WikiLinkInfo[]` 合法）。`removeVaultEntry` 调 `removeFileBacklinks(path, file)`，`file.outLinks` 现为结构数组，已在 Step 6 适配。

- [ ] **Step 8: 改 `timeline/selection.ts`（先只读 `l.target`，保持 1 跳）**

`buildSelection` 里 `for (const target of files[focus].outLinks)` 改为：

```ts
  for (const l of files[focus].outLinks) {
    const r = resolve(l.target)
    if (r && r in files) { paths.add(r); addEdge(focus, r) }
  }
```

入参类型 `files: Record<string, Pick<FileMeta, 'outLinks'>>` 不变（`outLinks` 现为结构数组）。Task 8 会整体重做本文件。

- [ ] **Step 9: 全量类型检查 + 测试**

Run: `npm run build && npx vitest run`
Expected: tsc 通过；既有测试 + 新增 parseMarkdown/outLinksField 测试全绿。
（若有遗漏的 `outLinks` 字符串读取点，tsc 会精确报位置，逐个改成 `l.target`。）

- [ ] **Step 10: 提交**

```bash
git add -A
git commit -m "feat(vault): FileMeta.outLinks 升级为 WikiLinkInfo[]

- 解析产出含 headingPath/anchor/lineTags/位置
- 索引读 l.target，缓存升 sn-meta-v3
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase B — 点击跳转

### Task 5: 纯定位器 `findWikiLink` / `findHeading`

**Files:**
- Create: `src/lib/linkLocate.ts`
- Test: `src/lib/__tests__/linkLocate.test.ts`

**Interfaces:**
- Produces:
  - `findWikiLink(doc: string, targetStem: string, headingPathHint?: string[]): { from: number; to: number } | null`
  - `findHeading(doc: string, text: string): { from: number; to: number } | null`

- [ ] **Step 1: 写失败测试**

```ts
// src/lib/__tests__/linkLocate.test.ts
import { describe, it, expect } from 'vitest'
import { findWikiLink, findHeading } from '../linkLocate'

describe('findWikiLink', () => {
  it('定位 [[stem]] 本身的范围', () => {
    const doc = '前文 [[复测计划]] 后文'
    const r = findWikiLink(doc, '复测计划')!
    expect(doc.slice(r.from, r.to)).toBe('[[复测计划]]')
  })
  it('容忍别名与锚点', () => {
    const doc = 'x [[复测计划#步骤|看]] y'
    const r = findWikiLink(doc, '复测计划')!
    expect(doc.slice(r.from, r.to)).toBe('[[复测计划#步骤|看]]')
  })
  it('多处命中用 headingPath 消歧', () => {
    const doc = '## 计划\n[[A]]\n## 反思\n[[A]]'
    const r = findWikiLink(doc, 'A', ['反思'])!
    // 命中「反思」段下那个 A（第二个）
    expect(r.from).toBeGreaterThan(doc.indexOf('## 反思'))
  })
  it('无命中返回 null', () => {
    expect(findWikiLink('无链接', 'A')).toBeNull()
  })
})

describe('findHeading', () => {
  it('定位 ATX 标题行', () => {
    const doc = '正文\n## 计划\n更多'
    const r = findHeading(doc, '计划')!
    expect(doc.slice(r.from, r.to)).toBe('## 计划')
  })
  it('无命中返回 null', () => {
    expect(findHeading('# 别的', '计划')).toBeNull()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/lib/__tests__/linkLocate.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// src/lib/linkLocate.ts
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 在 doc 里找 [[stem...]]，stem 后可接 #anchor / |alias / 直接 ]]。
 *  多处命中且给了 headingPathHint：优先选其上方最近 ATX 标题文本匹配 hint 末项的那处。 */
export function findWikiLink(
  doc: string,
  targetStem: string,
  headingPathHint?: string[],
): { from: number; to: number } | null {
  const re = new RegExp(`\\[\\[${escapeRe(targetStem)}(?:#[^\\]|]*)?(?:\\|[^\\]]*)?\\]\\]`, 'g')
  const hits: { from: number; to: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(doc)) !== null) hits.push({ from: m.index, to: m.index + m[0].length })
  if (hits.length === 0) return null
  if (hits.length === 1 || !headingPathHint?.length) return hits[0]

  const wantHeading = headingPathHint[headingPathHint.length - 1]
  for (const h of hits) {
    const before = doc.slice(0, h.from)
    const lastHeading = [...before.matchAll(/^#{1,6}\s+(.*)$/gm)].pop()
    if (lastHeading && lastHeading[1].trim() === wantHeading) return h
  }
  return hits[0]
}

/** 找文本匹配的 ATX 标题行，返回该行（去尾空白）的范围。 */
export function findHeading(doc: string, text: string): { from: number; to: number } | null {
  const re = /^(#{1,6}\s+(.*))$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(doc)) !== null) {
    if (m[2].trim() === text.trim()) {
      return { from: m.index, to: m.index + m[1].trimEnd().length }
    }
  }
  return null
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/lib/__tests__/linkLocate.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/linkLocate.ts src/lib/__tests__/linkLocate.test.ts
git commit -m "feat(jump): findWikiLink/findHeading 纯定位器

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `openFileAt` + reveal 挂载/消费

给工作区加"打开文件并定位"能力。reveal 挂到目标 leaf 运行时,编辑器组件就绪后消费一次。

**Files:**
- Modify: `src/stores/types.ts`（`RevealRequest` 类型、`LeafRuntimeState.pendingReveal`）
- Modify: `src/stores/workspaceStore.ts`（`openFileAt` + reveal 读写）
- Modify: 编辑器组件（消费 reveal）—— 先定位文件

**Interfaces:**
- Consumes: `findWikiLink`/`findHeading`（Task 5）
- Produces:
  - `type RevealRequest = { kind: 'wikilink'; targetStem: string; headingPath?: string[] } | { kind: 'heading'; text: string }`
  - `workspaceActions.openFileAt(path: string, reveal: RevealRequest): void`
  - `workspaceActions.takePendingReveal(leafId: string): RevealRequest | null`

- [ ] **Step 1: 定位编辑器组件与现有 openFile**

Run: `rg -n "openFile\b|leafInstances|cmView" src/stores/workspaceStore.ts | head -30`
Run: `rg -ln "EditorView\(|cmView|new EditorView" src/components src/plugins | head`
Expected: 找到 `workspaceActions.openFile` 实现，及创建 `EditorView` 的编辑器组件（记其路径，下面 Step 5 用）。

- [ ] **Step 2: 加类型**

`src/stores/types.ts`：

```ts
export type RevealRequest =
  | { kind: 'wikilink'; targetStem: string; headingPath?: string[] }
  | { kind: 'heading'; text: string }
```

`LeafRuntimeState` 增一字段：

```ts
  pendingReveal?: RevealRequest | null
```

（`import type { ... }` 处补 `RevealRequest` 若需要。）

- [ ] **Step 3: `openFileAt` + take（workspaceStore）**

参照现有 `openFile` 实现新增（`openFile` 怎么定位/激活 leaf，就复用其路径）：

```ts
  openFileAt(path: string, reveal: RevealRequest): void {
    workspaceActions.openFile(path)                 // 复用现有打开/激活逻辑
    const leafId = workspaceActions.activeLeafId()  // 打开后的活动 leaf
    if (leafId) setLeafInstance(leafId, 'pendingReveal', reveal)
  },
  takePendingReveal(leafId: string): RevealRequest | null {
    const r = leafInstances[leafId]?.pendingReveal ?? null
    if (r) setLeafInstance(leafId, 'pendingReveal', null)
    return r
  },
```

> `setLeafInstance` / `leafInstances` 用本文件已有的运行时 store 写法（与 `cmView`/`isDirty` 同处）。若访问器名不同，按本文件实际命名对齐。

- [ ] **Step 4: 单测 take 语义**

```ts
// 在 workspaceStore 既有测试文件追加（若无则建 src/stores/__tests__/reveal.test.ts）
// 仅验证 takePendingReveal 取后即清：设置 → 取到 → 再取为 null。
```

Run: `npx vitest run src/stores/__tests__/reveal.test.ts`
Expected: PASS（如 workspaceStore 难以脱离 DOM 测，可跳过本步，改由 Step 6 手动验证并在提交信息注明）

- [ ] **Step 5: 编辑器组件消费 reveal**

在编辑器组件里,`EditorView` 创建完成且 doc 就绪后(Solid 的 `onMount` 之后、view 赋值处),消费一次:

```tsx
import { findWikiLink, findHeading } from '../../lib/linkLocate' // 按实际相对路径
import { EditorView } from '@codemirror/view'

// view 创建后：
const reveal = workspaceActions.takePendingReveal(props.leafId)
if (reveal) {
  const doc = view.state.doc.toString()
  const pos =
    reveal.kind === 'heading'
      ? findHeading(doc, reveal.text)
      : findWikiLink(doc, reveal.targetStem, reveal.headingPath)
  if (pos) {
    view.dispatch({
      selection: { anchor: pos.from, head: pos.to },
      effects: EditorView.scrollIntoView(pos.from, { y: 'center' }),
    })
  }
}
```

> leaf id 在编辑器组件里的取法按现有 props 命名（同 `cmView` 回写处用的那个 id）。

- [ ] **Step 6: 验证**

Run: `npm run build`
Expected: 通过。手动验证留到 Task 7 接线后一起做。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat(jump): openFileAt + leaf pendingReveal 消费

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: 三处接线（面板 / 编辑器 wikilink / 时间轴卡片）

**Files:**
- Modify: `src/plugins/links/index.tsx`（入链带 reveal + 按 headingPath 分组）
- Modify: `src/lib/cm6/livePreviewExtension.ts` 或 wikilink 点击处（编辑器点击分发 reveal）
- Modify: `src/plugins/timeline/TimelineView.tsx`（反链卡 reveal）—— Task 9 会重写本文件,这里先接最小逻辑或并入 Task 9

**Interfaces:**
- Consumes: `openFileAt`（Task 6）、`backlinkMap`、源文件 `FileMeta.outLinks`

- [ ] **Step 1: 反链面板入链带 reveal**

`src/plugins/links/index.tsx` 入链 `<For>` 的 `onClick` 改为：先从 `ctx.vault` 取 focus 与该 source 的 outLink 上下文，再 `openFileAt`。

```tsx
onClick={() => {
  const focusPath = ctx.workspace.activeFilePath()
  if (!focusPath) return
  const focusStem = focusPath.split('/').pop()!.replace(/\.md$/, '')
  const srcMeta = ctx.vault.getFile(path)            // path = 该入链来源
  const hit = srcMeta?.outLinks.find(
    l => ctx.vault.resolveLink(l.target) === focusPath,
  )
  ctx.workspace.openFileAt(path, {
    kind: 'wikilink',
    targetStem: focusStem,
    headingPath: hit?.headingPath,
  })
}}
```

> 确认 `ctx.vault` 暴露了 `getFile`/`resolveLink`/`openFileAt`（`PluginContext`）。若 `openFileAt` 未在 ctx 暴露，先在 pluginRegistry 的 `ctx.workspace` 上转发。

- [ ] **Step 2: 入链按 headingPath 分组（可选展示增强）**

把 `backlinks()` 的渲染从平铺改为按来源 outLink 的 `headingPath[0]`（或末项）分组的小标题 + 列表。分组纯计算可抽到 `links/groupBacklinks.ts` 并配测试：

```ts
// 输入 [{ path, headingPath }]，输出 Map<groupLabel, path[]>
// groupLabel = headingPath.at(-1) ?? '（无标题）'
```

- [ ] **Step 3: 编辑器 wikilink 点击**

在 wikilink 装饰/点击处（`livePreviewExtension.ts` 的 `.cm-wikilink` 或现有点击监听）：取点击处 WikiLink 的 target 文本 → `splitWikiTarget` → resolve base → 有 anchor 则 `openFileAt(targetPath, { kind:'heading', text: anchor })`，否则现有 `openFile`。

```ts
import { splitWikiTarget } from './wikiTarget'
// 命中 WikiLink 后：
const { base, anchor } = splitWikiTarget(rawTargetText)
const targetPath = resolveLink(/* base→path，用 vault 的 resolve */)
if (targetPath) {
  if (anchor) workspaceActions.openFileAt(targetPath, { kind: 'heading', text: anchor })
  else workspaceActions.openFile(targetPath)
}
```

> 若当前 wikilink 点击逻辑尚不存在，则在此新增一个 `EditorView.domEventHandlers({ click })` 或 mousedown 处理：用 `view.posAtCoords` 命中 `syntaxTree` 的 `WikiLink` 节点取其 target。

- [ ] **Step 4: 验证**

Run: `npm run build`
Expected: 通过。

手动验证（开发服):
Run: `npm run dev`
- 点反链面板入链 → 打开源文件并选中那条 `[[focus]]`。
- 正文点 `[[目标#标题]]` → 打开目标并滚到该标题。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(jump): 反链面板/编辑器 wikilink 接入精确跳转

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase C — 多列时间轴

### Task 8: `buildNeighborhood`（BFS + 预算 + Edge 上下文）

**Files:**
- Modify: `src/plugins/timeline/selection.ts`
- Test: `src/plugins/timeline/__tests__/selection.test.ts`（改写/补 BFS 用例）

**Interfaces:**
- Consumes: `FileMeta.outLinks`（`WikiLinkInfo[]`）、`backlinkMap`、`resolve`
- Produces:

```ts
export type Edge = {
  from: string
  to: string
  dir: 'out' | 'in'
  headingPath: string[]
  lineTags: string[]
}
export interface Neighborhood { notes: { path: string; hop: number }[]; edges: Edge[] }
export function buildNeighborhood(
  focus: string,
  files: Record<string, Pick<FileMeta, 'outLinks'>>,
  backlinkMap: Record<string, string[]>,
  resolve: (target: string) => string | null,
  opts: { maxFiles: number },
): Neighborhood
```

- [ ] **Step 1: 写失败测试**

```ts
// src/plugins/timeline/__tests__/selection.test.ts
import { describe, it, expect } from 'vitest'
import { buildNeighborhood } from '../selection'
import type { WikiLinkInfo } from '../../../stores/types'

const link = (target: string, ctx: Partial<WikiLinkInfo> = {}): WikiLinkInfo => ({
  target, headingPath: [], lineTags: [], from: 0, to: 0, ...ctx,
})

describe('buildNeighborhood', () => {
  const files = {
    'A.md': { outLinks: [link('B.md', { headingPath: ['计划'] })] },
    'B.md': { outLinks: [link('C.md')] },
    'C.md': { outLinks: [] as WikiLinkInfo[] },
    'D.md': { outLinks: [link('A.md', { lineTags: ['想法'] })] },
  }
  const backlinkMap = { 'A.md': ['D.md'], 'B.md': ['A.md'], 'C.md': ['B.md'] }
  const resolve = (t: string) => (t in files ? t : null)

  it('从 focus 无向 BFS，记录 hop 与方向/上下文', () => {
    const n = buildNeighborhood('A.md', files, backlinkMap, resolve, { maxFiles: 99 })
    const paths = n.notes.map(x => x.path).sort()
    expect(paths).toEqual(['A.md', 'B.md', 'C.md', 'D.md'])
    expect(n.notes.find(x => x.path === 'A.md')!.hop).toBe(0)
    expect(n.notes.find(x => x.path === 'C.md')!.hop).toBe(2)
    const ab = n.edges.find(e => e.from === 'A.md' && e.to === 'B.md')!
    expect(ab.dir).toBe('out')
    expect(ab.headingPath).toEqual(['计划'])
    const da = n.edges.find(e => e.from === 'D.md' && e.to === 'A.md')!
    expect(da.dir).toBe('in')
    expect(da.lineTags).toEqual(['想法'])
  })

  it('整层预算：超过 maxFiles 后不再扩下一层', () => {
    const n = buildNeighborhood('A.md', files, backlinkMap, resolve, { maxFiles: 2 })
    // 第 0 层 {A}=1 < 2，扩第 1 层 {B,D} → 累计 3 ≥ 2，停止；C 不应进入
    expect(n.notes.map(x => x.path).sort()).toEqual(['A.md', 'B.md', 'D.md'])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/plugins/timeline/__tests__/selection.test.ts`
Expected: FAIL（`buildNeighborhood` 未导出）

- [ ] **Step 3: 实现**

替换 `src/plugins/timeline/selection.ts` 内容（保留 `Edge` 导出名给 events/UI 用）：

```ts
import type { FileMeta, WikiLinkInfo } from '../../stores/types'

export type Edge = {
  from: string
  to: string
  dir: 'out' | 'in'
  headingPath: string[]
  lineTags: string[]
}
export interface Neighborhood {
  notes: { path: string; hop: number }[]
  edges: Edge[]
}

export function buildNeighborhood(
  focus: string,
  files: Record<string, Pick<FileMeta, 'outLinks'>>,
  backlinkMap: Record<string, string[]>,
  resolve: (target: string) => string | null,
  opts: { maxFiles: number },
): Neighborhood {
  if (!(focus in files)) return { notes: [], edges: [] }

  const hop = new Map<string, number>([[focus, 0]])
  const edges: Edge[] = []
  const seenEdge = new Set<string>()
  const addEdge = (e: Edge) => {
    const key = `${e.from} ${e.to} ${e.dir}`
    if (seenEdge.has(key)) return
    seenEdge.add(key)
    edges.push(e)
  }

  let frontier = [focus]
  let depth = 0
  while (frontier.length && hop.size < opts.maxFiles) {
    const next: string[] = []
    for (const cur of frontier) {
      // 出边：cur 的 outLinks
      for (const l of files[cur]?.outLinks ?? []) {
        const t = resolve(l.target)
        if (!t || !(t in files)) continue
        addEdge({ from: cur, to: t, dir: 'out', headingPath: l.headingPath, lineTags: l.lineTags })
        if (!hop.has(t)) { hop.set(t, depth + 1); next.push(t) }
      }
      // 入边：谁链接了 cur
      for (const src of backlinkMap[cur] ?? []) {
        if (!(src in files)) continue
        const l = files[src].outLinks.find(x => resolve(x.target) === cur)
        addEdge({
          from: src, to: cur, dir: 'in',
          headingPath: l?.headingPath ?? [], lineTags: l?.lineTags ?? [],
        })
        if (!hop.has(src)) { hop.set(src, depth + 1); next.push(src) }
      }
    }
    depth++
    if (hop.size >= opts.maxFiles) break   // 整层扩完后判断，不切半层
    frontier = next
  }

  return { notes: [...hop].map(([path, h]) => ({ path, hop: h })), edges }
}
```

> 注：本轮把整层 `frontier` 全部扩完(含其所有边)再判断预算,符合"遍历结束后超过 N 就不再遍历"。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/plugins/timeline/__tests__/selection.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/plugins/timeline/selection.ts src/plugins/timeline/__tests__/selection.test.ts
git commit -m "feat(timeline): buildNeighborhood 无向 BFS + 整层预算 + Edge 上下文

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: `assignColumns` 归列纯函数

**Files:**
- Create: `src/plugins/timeline/columns.ts`
- Test: `src/plugins/timeline/__tests__/columns.test.ts`

**Interfaces:**
- Consumes: `Edge`（Task 8）
- Produces:

```ts
export type ColumnFilter =
  | { by: 'heading'; value: string }
  | { by: 'tag'; value: string }
  | { by: 'direction'; value: 'out' | 'in' }
  | null
export type Column = { filter: ColumnFilter; priority: number; repeat: boolean }
// noteIds 已按时间排序传入；返回与 columns 等长的二维数组
export function assignColumns(
  noteIds: string[],
  edgesByNote: Map<string, Edge[]>,
  columns: Column[],
): string[][]
```

- [ ] **Step 1: 写失败测试**

```ts
// src/plugins/timeline/__tests__/columns.test.ts
import { describe, it, expect } from 'vitest'
import { assignColumns, type Column } from '../columns'
import type { Edge } from '../selection'

const e = (over: Partial<Edge>): Edge => ({
  from: 'x', to: 'y', dir: 'out', headingPath: [], lineTags: [], ...over,
})

describe('assignColumns', () => {
  const edges = new Map<string, Edge[]>([
    ['B.md', [e({ headingPath: ['计划'] })]],
    ['C.md', [e({ lineTags: ['想法'], dir: 'in' })]],
  ])
  const notes = ['B.md', 'C.md']

  it('null 过滤列收全部', () => {
    const cols: Column[] = [{ filter: null, priority: 0, repeat: false }]
    expect(assignColumns(notes, edges, cols)).toEqual([['B.md', 'C.md']])
  })

  it('按标题过滤', () => {
    const cols: Column[] = [
      { filter: { by: 'heading', value: '计划' }, priority: 0, repeat: false },
      { filter: null, priority: 1, repeat: false },
    ]
    const [c0, c1] = assignColumns(notes, edges, cols)
    expect(c0).toEqual(['B.md'])
    expect(c1).toEqual(['C.md'])   // B 被高优先级收走，不重复
  })

  it('repeat=true 允许重复', () => {
    const cols: Column[] = [
      { filter: { by: 'heading', value: '计划' }, priority: 0, repeat: false },
      { filter: null, priority: 1, repeat: true },
    ]
    const [, c1] = assignColumns(notes, edges, cols)
    expect(c1).toEqual(['B.md', 'C.md'])
  })

  it('按方向过滤', () => {
    const cols: Column[] = [{ filter: { by: 'direction', value: 'in' }, priority: 0, repeat: false }]
    expect(assignColumns(notes, edges, cols)).toEqual([['C.md']])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/plugins/timeline/__tests__/columns.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// src/plugins/timeline/columns.ts
import type { Edge } from './selection'

export type ColumnFilter =
  | { by: 'heading'; value: string }
  | { by: 'tag'; value: string }
  | { by: 'direction'; value: 'out' | 'in' }
  | null

export type Column = { filter: ColumnFilter; priority: number; repeat: boolean }

function matches(filter: ColumnFilter, edges: Edge[]): boolean {
  if (filter === null) return true
  return edges.some(e => {
    if (filter.by === 'heading') return e.headingPath.includes(filter.value)
    if (filter.by === 'tag') return e.lineTags.includes(filter.value)
    return e.dir === filter.value
  })
}

/** 每个 note 按 priority 升序找第一个匹配列归入；repeat 列额外把所有匹配项也收一份。 */
export function assignColumns(
  noteIds: string[],
  edgesByNote: Map<string, Edge[]>,
  columns: Column[],
): string[][] {
  const order = columns
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.priority - b.c.priority)
  const out: string[][] = columns.map(() => [])

  for (const note of noteIds) {
    const edges = edgesByNote.get(note) ?? []
    let claimed = false
    for (const { c, i } of order) {
      if (!matches(c.filter, edges)) continue
      if (c.repeat) { out[i].push(note); continue }
      if (!claimed) { out[i].push(note); claimed = true }
    }
  }
  return out
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/plugins/timeline/__tests__/columns.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/plugins/timeline/columns.ts src/plugins/timeline/__tests__/columns.test.ts
git commit -m "feat(timeline): assignColumns 优先级归列 + repeat

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: 时间轴多列渲染 + 列配置 UI

把 `TimelineView` 接到 `buildNeighborhood` + `assignColumns`,渲染 N 列,顶部提供 `maxFiles` 与列配置,卡片接 reveal。

**Files:**
- Modify: `src/plugins/timeline/events.ts`（产 `edgesByNote` + 事件保留 path/date/title/tags）
- Modify: `src/plugins/timeline/TimelineView.tsx`

**Interfaces:**
- Consumes: `buildNeighborhood`/`Edge`（Task 8）、`assignColumns`/`Column`（Task 9）、`openFileAt`（Task 6）

- [ ] **Step 1: `events.ts` 产出按 note 的边映射**

在 `events.ts` 增一个纯函数（保留现有 `deriveEvents`，新增）：

```ts
import type { Edge } from './selection'
export function edgesByNote(edges: Edge[]): Map<string, Edge[]> {
  const m = new Map<string, Edge[]>()
  for (const e of edges) {
    for (const p of [e.from, e.to]) {
      const arr = m.get(p) ?? []; arr.push(e); m.set(p, arr)
    }
  }
  return m
}
```

`deriveEvents` 改为接受 `Neighborhood`（`{ notes, edges }`）而非旧 `SelectionResult`：用 `notes.map(n => n.path)` 取代旧 `selection.paths`，其余（按 `created` 排序、title、tags）不变。

- [ ] **Step 2: `TimelineView.tsx` 多列**

核心改动（保留首图/首段 `createResource` 逻辑不变）：

```tsx
import { createMemo, createSignal, For, Show } from 'solid-js'
import { vaultStore, getStemIndex, getAliasIndex } from '../../vault'
import { resolveLink } from '../../vault/backlinks'
import { workspaceActions } from '../../stores/workspaceStore'
import { buildNeighborhood } from './selection'
import { deriveEvents, edgesByNote } from './events'
import { assignColumns, type Column } from './columns'

// 顶部状态：
const [maxFiles, setMaxFiles] = createSignal(20)
const [columns, setColumns] = createSignal<Column[]>([{ filter: null, priority: 0, repeat: false }])

const neighborhood = createMemo(() => {
  const f = focus(); if (!f) return { notes: [], edges: [] }
  const files = vaultStore.files
  const resolve = (t: string) => resolveLink(t, getStemIndex(), files, getAliasIndex())
  return buildNeighborhood(f, files, vaultStore.backlinkMap, resolve, { maxFiles: maxFiles() })
})

const events = createMemo(() => deriveEvents(neighborhood(), vaultStore.files))
const cols = createMemo(() => {
  const evs = events()
  const byNote = edgesByNote(neighborhood().edges)
  const buckets = assignColumns(evs.map(e => e.path), byNote, columns())
  const byPath = new Map(evs.map(e => [e.path, e]))
  return buckets.map(ids => ids.map(id => byPath.get(id)!).filter(Boolean))
})
```

渲染:`<For each={cols()}>` 外层并排列,每列内 `<For each={col}>` 复用现有卡片；卡片 `onClick`:

```tsx
onClick={() => {
  if (ev.path === focus()) { workspaceActions.openFile(ev.path); return }
  const focusPath = focus()
  const focusStem = focusPath.split('/').pop()!.replace(/\.md$/, '')
  const srcMeta = vaultStore.files[ev.path]
  const isBacklink = srcMeta?.outLinks.some(
    l => resolveLink(l.target, getStemIndex(), vaultStore.files, getAliasIndex()) === focusPath,
  )
  if (isBacklink) {
    const hit = srcMeta!.outLinks.find(
      l => resolveLink(l.target, getStemIndex(), vaultStore.files, getAliasIndex()) === focusPath,
    )
    workspaceActions.openFileAt(ev.path, { kind: 'wikilink', targetStem: focusStem, headingPath: hit?.headingPath })
  } else {
    workspaceActions.openFile(ev.path)
  }
}}
```

列配置 UI(顶部):一个 `maxFiles` 数字输入(`onInput` → `setMaxFiles(+e.currentTarget.value)`),一组列控件(选 `filter.by` + value、priority、repeat、增删列),用 `setColumns` 更新。可选项来源:从 `neighborhood().edges` 收集所有 `headingPath`/`lineTags` 值做下拉。配置存进 viewState(`props.viewState`)以便随 leaf 持久化——若现成 setter 不存在,用 `workspaceActions` 现有的 viewState 更新方法（参照 `focus` 的读取处）。

- [ ] **Step 3: 类型检查 + 测试**

Run: `npm run build && npx vitest run`
Expected: 全绿。

- [ ] **Step 4: 手动验证**

Run: `npm run dev`
- 焦点笔记 → 时间轴出现多列;调 `maxFiles` 变多/变少;
- 加一个"标题=计划"的列 → 相关项进该列;repeat 切换看是否重复;
- 点反链卡 → 打开源文件并选中 `[[focus]]`。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(timeline): 多列渲染 + 列配置 + BFS 预算 + 卡片精确跳转

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 收尾

- [ ] **全量回归**

Run: `npm run build && npx vitest run`
Expected: 全绿。

- [ ] **完成开发分支**：用 superpowers:finishing-a-development-branch 决定合并/PR/清理。

---

## Self-Review 记录

- **Spec 覆盖**:§1 数据模型→Task 4;§2 解析→Task 1/2/3/4;§3 索引→Task 4;§4 跳转→Task 5/6/7;§5 时间轴→Task 8/9/10。无遗漏。
- **占位符**:无 TBD/TODO;每个 code step 给出完整代码。
- **类型一致**:`WikiLinkInfo`(Task 4)、`OutLink` 增字段(Task 3)、`Edge`(Task 8)、`Column`/`ColumnFilter`(Task 9)、`RevealRequest`(Task 6)在引用处签名一致。
- **已知前置确认点**(实现时先 `rg` 核对,已在对应 step 标注):`ctx.vault.getFile/resolveLink/openFileAt` 是否在 `PluginContext` 暴露(Task 7 Step 1);编辑器组件路径与 leafId props 名(Task 6 Step 1);`leafInstances`/`setLeafInstance` 实际命名(Task 6 Step 3);viewState 持久化 setter(Task 10 Step 2)。
