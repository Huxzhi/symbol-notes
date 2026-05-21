# Live Preview Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Obsidian-style live preview — markdown syntax markers hide when the cursor leaves, restore when it enters — for bold, italic, headings, inline code, and `[[WikiLink]]`.

**Architecture:** A single `ViewPlugin` (`livePreviewExtension.ts`) traverses the Lezer syntax tree once per update to produce `Decoration.replace({})` ranges that hide syntax markers. A custom `InlineParser` (`wikiLinkParser.ts`) teaches `@lezer/markdown` to emit `WikiLink` AST nodes so all five element types are handled uniformly in the same tree walk.

**Tech Stack:** `@codemirror/view` (ViewPlugin, Decoration), `@codemirror/state` (RangeSetBuilder), `@codemirror/language` (syntaxTree), `@lezer/markdown` (InlineParser, MarkdownConfig), `@lezer/common` (SyntaxNodeRef), Vitest

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `src/lib/wikiLinkParser.ts` | Lezer `InlineParser` + `MarkdownConfig` for `[[...]]` |
| Create | `src/lib/livePreviewExtension.ts` | `ViewPlugin` — cursor detection, hide markers, export |
| Modify | `src/components/Editor.tsx` | Swap imports, add `wikiLinkParser` to `markdown()` |
| Modify | `src/lib/cmTheme.ts` | Keep `.cm-wikilink` rule, no new additions needed |
| Delete | `src/lib/wikiLinkExtension.ts` | Replaced by the two files above |
| Modify | `src/lib/__tests__/wikiLinkParser.test.ts` (new) | Unit test for parser AST output |

---

## Task 1: WikiLink Lezer Parser

**Files:**
- Create: `src/lib/wikiLinkParser.ts`
- Create: `src/lib/__tests__/wikiLinkParser.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/wikiLinkParser.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { wikiLinkParser } from '../wikiLinkParser'

function getNodeNames(doc: string): string[] {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: [wikiLinkParser] })],
  })
  const names: string[] = []
  syntaxTree(state).iterate({
    from: 0,
    to: state.doc.length,
    enter(node) { names.push(node.name) },
  })
  return names
}

describe('wikiLinkParser', () => {
  it('emits WikiLink node for [[Page]]', () => {
    const names = getNodeNames('[[Page]]')
    expect(names).toContain('WikiLink')
  })

  it('emits WikiLinkMark for [[ and ]]', () => {
    const names = getNodeNames('[[Page]]')
    expect(names.filter(n => n === 'WikiLinkMark')).toHaveLength(2)
  })

  it('emits WikiLinkTarget for the page name', () => {
    const names = getNodeNames('[[My Page]]')
    expect(names).toContain('WikiLinkTarget')
  })

  it('does not emit WikiLink for plain [[text without closing', () => {
    const names = getNodeNames('[[unclosed')
    expect(names).not.toContain('WikiLink')
  })

  it('handles WikiLink inline with other text', () => {
    const names = getNodeNames('Hello [[World]] end')
    expect(names).toContain('WikiLink')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run src/lib/__tests__/wikiLinkParser.test.ts
```

Expected: FAIL — `Cannot find module '../wikiLinkParser'`

- [ ] **Step 3: Create `src/lib/wikiLinkParser.ts`**

```ts
import type { MarkdownConfig, InlineParser } from '@lezer/markdown'
import { tags } from '@lezer/highlight'

const wikiLinkInlineParser: InlineParser = {
  name: 'WikiLink',
  parse(cx, next, pos) {
    if (next !== 91 /* [ */ || cx.char(pos + 1) !== 91 /* [ */) return -1

    let end = pos + 2
    while (end < cx.end) {
      if (cx.char(end) === 93 /* ] */ && cx.char(end + 1) === 93 /* ] */) break
      end++
    }
    if (end >= cx.end) return -1

    return cx.addElement(cx.elt('WikiLink', pos, end + 2, [
      cx.elt('WikiLinkMark',   pos,     pos + 2),
      cx.elt('WikiLinkTarget', pos + 2, end),
      cx.elt('WikiLinkMark',   end,     end + 2),
    ]))
  },
}

export const wikiLinkParser: MarkdownConfig = {
  defineNodes: [
    { name: 'WikiLink',       style: tags.link },
    { name: 'WikiLinkMark',   style: tags.processingInstruction },
    { name: 'WikiLinkTarget', style: tags.link },
  ],
  parseInline: [wikiLinkInlineParser],
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run src/lib/__tests__/wikiLinkParser.test.ts
```

Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/wikiLinkParser.ts src/lib/__tests__/wikiLinkParser.test.ts
git commit -m "feat: add WikiLink Lezer inline parser with tests"
```

---

## Task 2: Live Preview ViewPlugin

**Files:**
- Create: `src/lib/livePreviewExtension.ts`

Note: This file requires `EditorView` (DOM-dependent), so no Vitest unit tests. Verification is manual in Task 4.

- [ ] **Step 1: Create `src/lib/livePreviewExtension.ts`**

```ts
import { syntaxTree } from '@codemirror/language'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'

const hide = Decoration.replace({})
const wikiLinkMark = Decoration.mark({ class: 'cm-wikilink' })

function cursorInNode(cursorPos: number, from: number, to: number): boolean {
  return cursorPos >= from && cursorPos <= to
}

function buildDecos(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const { state } = view
  const cursorPos = state.selection.main.head
  const cursorLine = state.doc.lineAt(cursorPos).number

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        switch (node.name) {
          case 'StrongEmphasis':
          case 'Emphasis': {
            if (cursorInNode(cursorPos, node.from, node.to)) return
            const c = node.node.cursor()
            if (!c.firstChild()) return
            do {
              if (c.name === 'EmphasisMark') builder.add(c.from, c.to, hide)
            } while (c.nextSibling())
            break
          }

          case 'ATXHeading1':
          case 'ATXHeading2':
          case 'ATXHeading3':
          case 'ATXHeading4':
          case 'ATXHeading5':
          case 'ATXHeading6': {
            if (state.doc.lineAt(node.from).number === cursorLine) return
            const c = node.node.cursor()
            if (!c.firstChild()) return
            do {
              // +1 covers the space after the # markers (e.g. "# " or "## ")
              if (c.name === 'HeaderMark') builder.add(c.from, c.to + 1, hide)
            } while (c.nextSibling())
            break
          }

          case 'InlineCode': {
            if (cursorInNode(cursorPos, node.from, node.to)) return
            const c = node.node.cursor()
            if (!c.firstChild()) return
            do {
              if (c.name === 'CodeMark') builder.add(c.from, c.to, hide)
            } while (c.nextSibling())
            break
          }

          case 'WikiLink': {
            if (cursorInNode(cursorPos, node.from, node.to)) return
            const c = node.node.cursor()
            if (!c.firstChild()) return
            do {
              if (c.name === 'WikiLinkMark') {
                builder.add(c.from, c.to, hide)
              } else if (c.name === 'WikiLinkTarget') {
                builder.add(c.from, c.to, wikiLinkMark)
              }
            } while (c.nextSibling())
            break
          }
        }
      },
    })
  }

  return builder.finish()
}

export const livePreviewExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDecos(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecos(update.view)
      }
    }
  },
  { decorations: v => v.decorations },
)
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/livePreviewExtension.ts
git commit -m "feat: add live preview ViewPlugin for bold/italic/heading/code/wikilink"
```

---

## Task 3: Wire Up Editor

**Files:**
- Modify: `src/components/Editor.tsx`
- Delete: `src/lib/wikiLinkExtension.ts`

- [ ] **Step 1: Update `src/components/Editor.tsx`**

Replace the current content with (changed lines marked):

```ts
import { onMount, onCleanup, createEffect } from 'solid-js'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting } from '@codemirror/language'
import { darkTheme, darkHighlightStyle } from '../lib/cmTheme'
import { wikiLinkParser } from '../lib/wikiLinkParser'
import { livePreviewExtension } from '../lib/livePreviewExtension'
import { editorStore, setEditorStore } from '../stores/editorStore'
import { saveCurrentFile } from '../services/fileSystemService'
import { parseFrontmatter } from '../lib/parseFrontmatter'

export function Editor() {
  let container!: HTMLDivElement
  let view: EditorView | null = null
  let isExternalUpdate = false

  onMount(() => {
    const { body } = parseFrontmatter(editorStore.content)

    view = new EditorView({
      state: EditorState.create({
        doc: body,
        extensions: [
          markdown({ codeLanguages: languages, extensions: [wikiLinkParser] }),
          syntaxHighlighting(darkHighlightStyle),
          darkTheme,
          livePreviewExtension,
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

- [ ] **Step 2: Delete old wikiLinkExtension**

```bash
rm /home/huxzhi/4-code/symbol-notes/src/lib/wikiLinkExtension.ts
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx tsc --noEmit
```

Expected: no errors (no remaining import of `wikiLinkExtension`)

- [ ] **Step 4: Run all tests**

```bash
cd /home/huxzhi/4-code/symbol-notes && npx vitest run
```

Expected: all tests PASS (parseFrontmatter, knowledgeService, wikiLinkParser)

- [ ] **Step 5: Commit**

```bash
git add src/components/Editor.tsx
git rm src/lib/wikiLinkExtension.ts
git commit -m "feat: wire up live preview and WikiLink parser in editor"
```

---

## Task 4: Manual Verification

**Files:** none — dev server only

- [ ] **Step 1: Start the dev server**

```bash
cd /home/huxzhi/4-code/symbol-notes && npm run dev
```

Open `http://localhost:5173` in a browser.

- [ ] **Step 2: Verify bold**

Type `**hello world**`, move cursor out of the word. Expected: `**` markers disappear, "hello world" appears bold. Move cursor back inside — `**` reappears.

- [ ] **Step 3: Verify italic**

Type `*italic text*`, move cursor out. Expected: `*` markers disappear, text appears italic. Move cursor back inside — `*` reappears.

- [ ] **Step 4: Verify heading**

Type `# My Heading`, move cursor to another line. Expected: `# ` disappears, text stays large/colored. Return to heading line — `# ` reappears.

- [ ] **Step 5: Verify inline code**

Type `` `some code` ``, move cursor out. Expected: backticks disappear, text appears in code style. Move cursor back inside — backticks reappear.

- [ ] **Step 6: Verify WikiLink**

Type `[[Page Name]]`, move cursor out. Expected: `[[` and `]]` disappear, "Page Name" shows with dotted underline. Move cursor back inside — full `[[Page Name]]` reappears.

- [ ] **Step 7: Verify existing file loads in preview state**

Open an existing file with markdown content. Expected: all markdown syntax markers are hidden immediately (cursor not in any of them on load).
