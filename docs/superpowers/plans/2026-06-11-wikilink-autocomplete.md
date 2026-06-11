# Wikilink 自动补全 + 别名解析 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CM6 编辑器输入 `[[` 后弹出 CM6 自带候选框,从所有文件名和别名中模糊补全(近期修改靠前),并打通别名解析使 `[[别名]]` 能正确跳转与统计反链。

**Architecture:** 分两块。(1) 别名解析:`resolveLink` 增加可选 `aliasIndex` 参数,stem 匹配失败时回退查别名索引;在所有调用点(导航、插件 API、反链构建)传入别名索引,使别名链接落进 `backlinkMap` 的真实路径。(2) 补全:新增纯函数补全源,从 `vaultStore.files` 构建文件名+别名候选(带 mtime recency `boost`),用 CM6 自带模糊过滤,接进编辑器 extensions。

**Tech Stack:** SolidJS, CodeMirror 6 (`@codemirror/autocomplete`, `@codemirror/state`), Vitest。

测试命令统一用:`npx vitest run <file>`(本仓库无 `test` npm script)。

---

## File Structure

- `src/vault/backlinks.ts`(改)— 新增 `buildAliasIndex`;`resolveLink` 加 `aliasIndex?` 参数与别名回退;`buildLinkMaps` 构建并传入本地 aliasIndex;增量函数 `applyFileBacklinks`/`removeFileBacklinks` 传入 `getAliasIndex()`。
- `src/vault/index.ts`(改)— 新增 `_aliasIndex` 惰性缓存 + `getAliasIndex()`;在 `invalidateStemIndex()` 内一并清空别名缓存(复用现有 8 处失效调用点);re-export `buildAliasIndex`。
- `src/plugins/editor/EditorViewer.tsx`(改)— 导航 `resolveLink` 传入 `getAliasIndex()`;extensions 数组加入 `wikiLinkComplete`。
- `src/lib/pluginRegistry.ts`(改)— `vault.resolveLink` 传入 `getAliasIndex()`;删除 `backlinks()` 里失效的 `${alias}.md` 聚合。
- `src/lib/cm6/wikiLinkComplete.ts`(新)— 补全源 + 纯函数 `wikiLinkCompletionSource` / `recencyBoost` / `buildWikiInsertion`;导出 `wikiLinkComplete`。
- `src/lib/__tests__/knowledgeUtils.test.ts`(改)— 增补 `buildAliasIndex`、`resolveLink` 别名回退、`buildLinkMaps` 别名反链用例。
- `src/lib/cm6/__tests__/wikiLinkComplete.test.ts`(新)— 补全源触发/候选/boost/插入用例。

---

## Task 1: 别名索引 + resolveLink 别名回退(纯函数)

**Files:**
- Modify: `src/vault/backlinks.ts`(`resolveLink` 在 18-29 行;在其前/后新增 `buildAliasIndex`)
- Test: `src/lib/__tests__/knowledgeUtils.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/lib/__tests__/knowledgeUtils.test.ts` 顶部 import 改为(加入 `buildAliasIndex`):

```ts
import { extractDateFromName, buildStemIndex, buildAliasIndex, resolveLink, buildLinkMaps } from '../../vault'
```

在文件末尾(最后一个 `})` 之前)追加:

```ts
describe('buildAliasIndex', () => {
  it('maps lowercased alias to owning paths, skips non-md', () => {
    const idx = buildAliasIndex({
      'notes/todo.md': { aliases: ['待办', 'TODO'] },
      'work/plan.md': { aliases: ['计划'] },
      'image.png': { aliases: ['图'] },
    })
    expect(idx.get('待办')).toEqual(['notes/todo.md'])
    expect(idx.get('todo')).toEqual(['notes/todo.md']) // 小写归一
    expect(idx.get('计划')).toEqual(['work/plan.md'])
    expect(idx.has('图')).toBe(false) // 非 .md 跳过
  })

  it('collects multiple paths sharing one alias', () => {
    const idx = buildAliasIndex({
      'a.md': { aliases: ['dup'] },
      'b.md': { aliases: ['dup'] },
    })
    expect(idx.get('dup')).toEqual(['a.md', 'b.md'])
  })
})

describe('resolveLink alias fallback', () => {
  const files = {
    'notes/todo.md': { aliases: ['待办'] },
    'work/plan.md': { aliases: ['计划', 'shared'] },
    'misc.md': { aliases: ['shared'] },
  }
  const stemIndex = buildStemIndex(files)
  const aliasIndex = buildAliasIndex(files)

  it('resolves a unique alias to its file path', () => {
    expect(resolveLink('待办', stemIndex, files, aliasIndex)).toBe('notes/todo.md')
  })

  it('strips .md before alias lookup', () => {
    expect(resolveLink('计划.md', stemIndex, files, aliasIndex)).toBe('work/plan.md')
  })

  it('is case-insensitive on alias', () => {
    expect(resolveLink('待办', stemIndex, files, aliasIndex)).toBe('notes/todo.md')
    expect(resolveLink('SHARED', stemIndex, files, aliasIndex)).toBeNull() // 多义
  })

  it('returns null for ambiguous alias', () => {
    expect(resolveLink('shared', stemIndex, files, aliasIndex)).toBeNull()
  })

  it('prefers stem match over alias (no alias fallback when stem resolves)', () => {
    const f = { 'todo.md': { aliases: [] }, 'other.md': { aliases: ['todo'] } }
    expect(resolveLink('todo.md', buildStemIndex(f), f, buildAliasIndex(f))).toBe('todo.md')
  })

  it('works without aliasIndex (back-compat)', () => {
    expect(resolveLink('待办', stemIndex, files)).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/__tests__/knowledgeUtils.test.ts`
Expected: FAIL —— `buildAliasIndex is not a function` / 别名用例不通过。

- [ ] **Step 3: 实现 `buildAliasIndex` 并改造 `resolveLink`**

在 `src/vault/backlinks.ts` 中,`buildStemIndex` 之后、`resolveLink` 之前新增:

```ts
export function buildAliasIndex(
  files: Record<string, { aliases?: string[] }>,
): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const [path, meta] of Object.entries(files)) {
    if (!path.endsWith('.md')) continue
    for (const alias of meta.aliases ?? []) {
      const key = alias.toLowerCase()
      const list = index.get(key)
      if (list) list.push(path)
      else index.set(key, [path])
    }
  }
  return index
}
```

把 `resolveLink`(18-29 行)整体替换为:

```ts
export function resolveLink(
  target: string,
  stemIndex: Map<string, string[]>,
  files: Record<string, unknown>,
  aliasIndex?: Map<string, string[]>,
): string | null {
  if (target in files) return target
  const stem = target.split('/').pop()!
  const candidates = stemIndex.get(stem) ?? []
  if (candidates.length === 1) return candidates[0]
  const pathMatches = candidates.filter(c => c === target || c.endsWith('/' + target))
  if (pathMatches.length === 1) return pathMatches[0]
  if (aliasIndex) {
    const aliasKey = target.replace(/\.md$/, '').toLowerCase()
    const aliasHits = aliasIndex.get(aliasKey) ?? []
    if (aliasHits.length === 1) return aliasHits[0]
  }
  return null
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/lib/__tests__/knowledgeUtils.test.ts`
Expected: PASS(原有 resolveLink/buildStemIndex 用例 + 新增别名用例全过)。

- [ ] **Step 5: 提交**

```bash
git add src/vault/backlinks.ts src/lib/__tests__/knowledgeUtils.test.ts
git commit -m "feat(vault): alias index + alias-aware resolveLink fallback"
```

---

## Task 2: 别名索引接入所有 resolveLink 调用点

**Files:**
- Modify: `src/vault/backlinks.ts`(`buildLinkMaps` 31-48;`applyFileBacklinks` 58-80;`removeFileBacklinks` 83-95)
- Modify: `src/vault/index.ts`(缓存 75-84;re-export 650)
- Modify: `src/plugins/editor/EditorViewer.tsx`(185-186)
- Modify: `src/lib/pluginRegistry.ts`(import 16;`backlinks` 336-349;`resolveLink` 350-353)
- Test: `src/lib/__tests__/knowledgeUtils.test.ts`

- [ ] **Step 1: 写失败测试(buildLinkMaps 别名反链)**

在 `knowledgeUtils.test.ts` 末尾追加:

```ts
describe('buildLinkMaps alias resolution', () => {
  it('registers [[alias]] backlink under the real file path', () => {
    const files = {
      'notes/todo.md': { aliases: ['待办'], outLinks: [] },
      'journal.md': { aliases: [], outLinks: ['待办'] },
    }
    const { backlinkMap, unresolvedMap } = buildLinkMaps(files)
    expect(backlinkMap['notes/todo.md']).toEqual(['journal.md'])
    expect(unresolvedMap['待办']).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/__tests__/knowledgeUtils.test.ts`
Expected: FAIL —— `backlinkMap['notes/todo.md']` 为 undefined(别名仍进 unresolvedMap)。

- [ ] **Step 3a: `buildLinkMaps` 构建并传入本地 aliasIndex**

在 `src/vault/backlinks.ts` 的 `buildLinkMaps`(31-48 行)中,把:

```ts
  const stemIndex = buildStemIndex(files)
```

改为:

```ts
  const stemIndex = buildStemIndex(files)
  const aliasIndex = buildAliasIndex(files as Record<string, { aliases?: string[] }>)
```

并把该函数内的 `resolveLink(target, stemIndex, files)` 改为:

```ts
      const resolved = resolveLink(target, stemIndex, files, aliasIndex)
```

- [ ] **Step 3b: 增量反链函数传入缓存 aliasIndex**

在 `src/vault/backlinks.ts` 顶部 import(第 2 行)加入 `getAliasIndex`:

```ts
import { vaultStore, setVaultStore, getStemIndex, getAliasIndex } from './index'
```

在 `applyFileBacklinks` 中,把 `const stemIndex = getStemIndex()` 改为:

```ts
  const stemIndex = getStemIndex()
  const aliasIndex = getAliasIndex()
```

并把该函数内两处 `resolveLink(t, stemIndex, vaultStore.files)` 改为 `resolveLink(t, stemIndex, vaultStore.files, aliasIndex)`。

在 `removeFileBacklinks` 中同样:`const stemIndex = getStemIndex()` 后加 `const aliasIndex = getAliasIndex()`,并把其内 `resolveLink(t, stemIndex, vaultStore.files)` 改为 `resolveLink(t, stemIndex, vaultStore.files, aliasIndex)`。

- [ ] **Step 3c: index.ts 新增别名缓存 + 失效 + re-export**

在 `src/vault/index.ts` 中,把 `buildStemIndex`(第 11 行 import)那组导入加上 `buildAliasIndex`:

```ts
  buildStemIndex,
  buildAliasIndex,
```

把 75-84 行的 stem 缓存块替换为(新增别名缓存,并让 `invalidateStemIndex` 一并清空——复用现有全部失效调用点,保证两索引同生命周期):

```ts
let _stemIndex: Map<string, string[]> | null = null
let _aliasIndex: Map<string, string[]> | null = null

export function invalidateStemIndex(): void {
  _stemIndex = null
  _aliasIndex = null
}

export function getStemIndex(): Map<string, string[]> {
  if (!_stemIndex) _stemIndex = buildStemIndex(vaultStore.files)
  return _stemIndex
}

export function getAliasIndex(): Map<string, string[]> {
  if (!_aliasIndex) _aliasIndex = buildAliasIndex(vaultStore.files)
  return _aliasIndex
}
```

把第 650 行的 re-export 加上 `buildAliasIndex`:

```ts
export { buildLinkMaps, buildStemIndex, buildAliasIndex, resolveLink } from './backlinks'
```

- [ ] **Step 3d: EditorViewer 导航传入别名索引**

在 `src/plugins/editor/EditorViewer.tsx` 第 16 行 import 加入 `getAliasIndex`:

```ts
import { fileActions, reindexFile, vaultStore, getStemIndex, getAliasIndex, vaultFs, readFile, writeFile, getFileMtime, invalidateFile } from '../../vault'
```

把第 185-186 行:

```ts
    const stemIndex = getStemIndex()
    const resolved = resolveLink(withExt, stemIndex, vaultStore.files)
```

改为:

```ts
    const stemIndex = getStemIndex()
    const resolved = resolveLink(withExt, stemIndex, vaultStore.files, getAliasIndex())
```

- [ ] **Step 3e: pluginRegistry 传入别名索引 + 删除失效聚合**

在 `src/lib/pluginRegistry.ts` 第 16 行 import 加入 `getAliasIndex`(与 `getStemIndex` 同组导入):

```ts
  getStemIndex,
  getAliasIndex,
```

把 `backlinks(path)`(336-349 行)整体替换为(别名链接现已落进真实路径的 backlinkMap,旧的 `${alias}.md` 聚合是空转,删除):

```ts
        backlinks: (path) => [...(vaultStore.backlinkMap[path] ?? [])],
```

把第 352 行 `resolveLink(withExt, getStemIndex(), vaultStore.files)` 改为:

```ts
          return resolveLink(withExt, getStemIndex(), vaultStore.files, getAliasIndex())
```

- [ ] **Step 4: 运行测试与类型检查确认通过**

Run: `npx vitest run src/lib/__tests__/knowledgeUtils.test.ts`
Expected: PASS(含新增 buildLinkMaps 别名用例)。

Run: `npx tsc --noEmit`
Expected: 无报错(验证 EditorViewer / pluginRegistry / index 的 store 侧接线类型正确)。

- [ ] **Step 5: 提交**

```bash
git add src/vault/backlinks.ts src/vault/index.ts src/plugins/editor/EditorViewer.tsx src/lib/pluginRegistry.ts src/lib/__tests__/knowledgeUtils.test.ts
git commit -m "feat(vault): wire alias index into navigation, plugin API, and backlink building"
```

---

## Task 3: Wikilink 补全源(纯函数 + 候选源)

**Files:**
- Create: `src/lib/cm6/wikiLinkComplete.ts`
- Test: `src/lib/cm6/__tests__/wikiLinkComplete.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/lib/cm6/__tests__/wikiLinkComplete.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { CompletionContext } from '@codemirror/autocomplete'
import type { FileMeta } from '../../../stores/types'
import {
  wikiLinkCompletionSource,
  recencyBoost,
  buildWikiInsertion,
} from '../wikiLinkComplete'

function ctxAt(doc: string, pos: number) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: [GFM] })],
  })
  return new CompletionContext(state, pos, true)
}

function file(path: string, mtime: number, aliases: string[] = []): FileMeta {
  return {
    name: path.split('/').pop()!, path, kind: 'file', parent: null,
    size: 0, mtime, hash: '', frontmatter: {}, outLinks: [], etags: [],
    tags: [], aliases, created: '', updated: null, dated: '', lists: [],
  }
}

const NOW = 1_000 * 86_400_000 // 任意基准(单位 ms)
const files: Record<string, FileMeta> = {
  'notes/Todo.md': file('notes/Todo.md', NOW, ['待办']),
  'work/Plan.md': file('work/Plan.md', NOW - 10 * 86_400_000),
  'image.png': file('image.png', NOW),       // 非 md,应跳过
}

describe('recencyBoost', () => {
  it('newest → 0, older → negative, clamped at -99', () => {
    expect(recencyBoost(NOW, NOW)).toBe(0)
    expect(recencyBoost(NOW - 10 * 86_400_000, NOW)).toBe(-10)
    expect(recencyBoost(NOW - 500 * 86_400_000, NOW)).toBe(-99)
  })
})

describe('buildWikiInsertion', () => {
  it('appends ]] and anchors after it when not already closed', () => {
    expect(buildWikiInsertion('Note', '')).toEqual({ insert: 'Note]]', anchor: 6 })
  })
  it('skips appending when ]] already follows, anchor past existing ]]', () => {
    expect(buildWikiInsertion('Note', ']]')).toEqual({ insert: 'Note', anchor: 6 })
  })
})

describe('wikiLinkCompletionSource', () => {
  it('triggers after [[ and lists filenames + aliases, skipping non-md', () => {
    const doc = '[['
    const res = wikiLinkCompletionSource(ctxAt(doc, doc.length), files, NOW)
    expect(res).not.toBeNull()
    expect(res!.from).toBe(2) // 落在 [[ 之后
    const labels = res!.options.map((o) => o.label).sort()
    expect(labels).toEqual(['Plan', 'Todo', '待办'])
  })

  it('alias option carries filename as detail', () => {
    const res = wikiLinkCompletionSource(ctxAt('[[', 2), files, NOW)!
    const alias = res.options.find((o) => o.label === '待办')!
    expect(alias.detail).toBe('Todo')
  })

  it('boosts more-recently-modified files higher', () => {
    const res = wikiLinkCompletionSource(ctxAt('[[', 2), files, NOW)!
    const todo = res.options.find((o) => o.label === 'Todo')!
    const plan = res.options.find((o) => o.label === 'Plan')!
    expect(todo.boost!).toBeGreaterThan(plan.boost!)
  })

  it('keeps from after [[ when a prefix is typed', () => {
    const doc = 'text [[To'
    const res = wikiLinkCompletionSource(ctxAt(doc, doc.length), files, NOW)!
    expect(res.from).toBe(doc.indexOf('[[') + 2)
  })

  it('does not trigger after the pipe (display-name part)', () => {
    expect(wikiLinkCompletionSource(ctxAt('[[Todo|', 7), files, NOW)).toBeNull()
  })

  it('does not trigger on a single [', () => {
    expect(wikiLinkCompletionSource(ctxAt('[', 1), files, NOW)).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/cm6/__tests__/wikiLinkComplete.test.ts`
Expected: FAIL —— 模块/导出不存在。

- [ ] **Step 3: 实现补全源**

创建 `src/lib/cm6/wikiLinkComplete.ts`:

```ts
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import { vaultStore } from '../../vault'
import type { FileMeta } from '../../stores/types'

const MS_PER_DAY = 86_400_000
// 触发:光标在 [[ 之后,且其后未出现 ] / | / 换行(竖线后留给显示名,不补全)。
const TRIGGER_RE = /\[\[([^\[\]\n|]*)$/

/** mtime 新旧 → boost:最新约 0,越旧越负,夹在 [-99, 0] 让 CM6 前缀评分占主导、mtime 作次级加权。 */
export function recencyBoost(mtime: number, now: number): number {
  return Math.max(-99, Math.min(0, Math.round((mtime - now) / MS_PER_DAY)))
}

/** 选中后插入文本:未闭合则补 ]] ;无论是否补,光标都落在 ]] 之后(相对 from 偏移 label.length + 2)。 */
export function buildWikiInsertion(
  label: string,
  follows: string,
): { insert: string; anchor: number } {
  const insert = follows.startsWith(']]') ? label : `${label}]]`
  return { insert, anchor: label.length + 2 }
}

function makeApply(label: string): Completion['apply'] {
  return (view: EditorView, _c: Completion, from: number, to: number) => {
    const follows = view.state.sliceDoc(to, to + 2)
    const { insert, anchor } = buildWikiInsertion(label, follows)
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + anchor },
    })
  }
}

/** 纯函数:从给定 files 构建候选(文件名 + 别名),boost 由 mtime 决定。过滤交给 CM6 自带模糊。 */
export function wikiLinkCompletionSource(
  ctx: CompletionContext,
  files: Record<string, FileMeta>,
  now: number,
): CompletionResult | null {
  const m = ctx.matchBefore(TRIGGER_RE)
  if (!m) return null
  const from = m.from + 2 // [[ 之后,使过滤文本不含括号
  const options: Completion[] = []
  for (const [path, meta] of Object.entries(files)) {
    if (meta.kind !== 'file' || !path.endsWith('.md')) continue
    const base = path.split('/').pop()!.replace(/\.md$/, '')
    const boost = recencyBoost(meta.mtime, now)
    options.push({ label: base, type: 'text', boost, apply: makeApply(base) })
    for (const alias of meta.aliases ?? []) {
      options.push({ label: alias, detail: base, type: 'text', boost, apply: makeApply(alias) })
    }
  }
  return { from, options, validFor: /^[^\[\]\n|]*$/ }
}

export const wikiLinkComplete = autocompletion({
  override: [(ctx) => wikiLinkCompletionSource(ctx, vaultStore.files, Date.now())],
})
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/lib/cm6/__tests__/wikiLinkComplete.test.ts`
Expected: PASS(全部用例)。

- [ ] **Step 5: 提交**

```bash
git add src/lib/cm6/wikiLinkComplete.ts src/lib/cm6/__tests__/wikiLinkComplete.test.ts
git commit -m "feat(cm6): wikilink completion source over filenames and aliases"
```

---

## Task 4: 接入编辑器 extensions

**Files:**
- Modify: `src/plugins/editor/EditorViewer.tsx`(import 区;extensions 数组 65-85)

- [ ] **Step 1: 加入 import**

在 `src/plugins/editor/EditorViewer.tsx` 第 25 行(`listsField, taskFieldComplete` 那行)之后新增一行 import:

```ts
import { wikiLinkComplete } from '../../lib/cm6/wikiLinkComplete'
```

- [ ] **Step 2: 把扩展加入 extensions 数组**

在 extensions 数组中 `taskFieldComplete,`(第 80 行)之后新增一行:

```ts
      taskFieldComplete,
      wikiLinkComplete,
```

- [ ] **Step 3: 类型检查 + 全量测试**

Run: `npx tsc --noEmit`
Expected: 无报错。

Run: `npx vitest run`
Expected: 全部测试 PASS。

- [ ] **Step 4: 手动验证(可选,需 dev server)**

Run: `npm run dev`
打开任一笔记,输入 `[[`:应弹出 CM6 候选框,列出文件名与别名,近期修改的靠前;键入前缀可过滤;选中后得到 `[[名称]]`(自动补 `]]`,光标在外);点击一个别名链接应能跳转到对应文件。

- [ ] **Step 5: 提交**

```bash
git add src/plugins/editor/EditorViewer.tsx
git commit -m "feat(editor): enable wikilink autocomplete in the markdown editor"
```

---

## Self-Review

**Spec coverage:**
- 输入 `[[` 弹 CM6 自带候选框 → Task 3(`autocompletion` override)+ Task 4(接线)。✓
- 文件名 + 别名候选 → Task 3(`wikiLinkCompletionSource` 双重 push)。✓
- CM6 自带模糊过滤 + `validFor` → Task 3。✓
- 前缀优先 + mtime 靠前(`boost`)→ Task 3(`recencyBoost`)。✓
- 触发条件(`[[` 命中 / `|` 后不触发 / 单 `[` 不触发)→ Task 3 测试。✓
- 选中插入 + 自动补 `]]` + 光标在外 → Task 3(`buildWikiInsertion` / `makeApply`)。✓
- 别名索引 + alias-aware resolveLink → Task 1。✓
- 接入导航 / 插件 API / 反链构建 + 删除空转聚合 → Task 2。✓
- 别名缓存与 stem 同生命周期失效 → Task 2(并入 `invalidateStemIndex`)。✓

**Placeholder scan:** 无 TBD/TODO;每个改动步骤均给出完整代码与确切行号。✓

**Type consistency:** `buildAliasIndex` / `getAliasIndex` / `wikiLinkCompletionSource` / `recencyBoost` / `buildWikiInsertion` 命名在定义(Task 1/2/3)与调用(Task 2/4 及测试)中一致;`resolveLink` 第 4 参 `aliasIndex?` 在所有调用点签名匹配。✓
