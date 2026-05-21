# Live Preview Extension Design

**Date:** 2026-05-21  
**Status:** Approved  
**Scope:** CodeMirror 6 live preview — hide markdown syntax markers when cursor is away

---

## Goal

Implement Obsidian-style live preview in the editor: markdown syntax markers (`**`, `*`, `#`, backticks, `[[`, `]]`) are hidden when the cursor is not near them, and restored when the cursor enters the token range.

---

## Elements Covered

| Element | Example | Marker hidden | Cursor trigger |
|---------|---------|--------------|----------------|
| Bold | `**bold**` | `**` | cursor inside `[from, to]` of node |
| Italic | `*italic*` | `*` | cursor inside `[from, to]` of node |
| Heading | `# Title` | `# ` (mark + trailing space) | cursor on same line |
| Inline code | `` `code` `` | backticks | cursor inside `[from, to]` of node |
| WikiLink | `[[Page]]` | `[[` and `]]` | cursor inside `[from, to]` of node |

---

## Architecture

### Approach: Single ViewPlugin + syntaxTree (Plan A)

One `buildDecos(view)` function traverses the visible syntax tree once per update. All five element types are handled in the same pass. WikiLinks require a custom Lezer `InlineParser` so they appear in the syntax tree alongside standard markdown nodes.

### Data Flow

```
ViewPlugin.update()
  ├─ trigger: docChanged || selectionSet || viewportChanged
  └─ buildDecos(view)
       └─ syntaxTree(state).iterate(visibleRanges)
            ├─ StrongEmphasis / Emphasis  → hideMarksIn('EmphasisMark')
            ├─ ATXHeading1..6             → hideMarksIn('HeaderMark', +trailingSpace)
            ├─ InlineCode                 → hideMarksIn('CodeMark')
            └─ WikiLink                  → hideMarksIn('WikiLinkMark')
       → RangeSetBuilder → DecorationSet
```

---

## File Changes

### New: `src/lib/wikiLinkParser.ts`

Defines a Lezer `InlineParser` and `MarkdownConfig` that teaches `@lezer/markdown` to parse `[[...]]` as first-class AST nodes.

Node structure produced:
```
WikiLink [0, 12]
  WikiLinkMark   [0, 2]     ← [[
  WikiLinkTarget [2, 8]     ← page name
  WikiLinkMark   [8, 10]    ← ]]
```

Node style tags:
- `WikiLink` → `tags.link`
- `WikiLinkMark` → `tags.processingInstruction`
- `WikiLinkTarget` → `tags.link`

### New: `src/lib/livePreviewExtension.ts`

Single `ViewPlugin` that exports `livePreviewExtension`. Internals:

```ts
// Cursor helpers
function cursorInNode(cursorPos, node): boolean
function cursorOnLine(state, cursorPos, node): boolean

// Decoration builder
function hideMarksIn(node, markName, builder, includeTrailingSpace?): void
function buildDecos(view): DecorationSet

// Export
export const livePreviewExtension = ViewPlugin.fromClass(...)
```

`hideMarksIn` traverses the node's children with `node.node.cursor()` and calls `builder.add(from, to, Decoration.replace({}))` for each child matching `markName`. For `HeaderMark`, extends the replaced range by 1 to cover the trailing space (e.g. `# ` → hide 2 chars for `##`, 3 chars for `###`).

`RangeSetBuilder` requires ranges added in ascending `from` order. Since `syntaxTree.iterate` visits nodes in document order and `hideMarksIn` visits children in order, this invariant is guaranteed.

### Delete: `src/lib/wikiLinkExtension.ts`

Replaced entirely by `wikiLinkParser.ts` + `livePreviewExtension.ts`.

### Modify: `src/components/Editor.tsx`

- Remove `wikiLinkExtension` import
- Add `wikiLinkParser` import (for `markdown({ extensions: [wikiLinkParser] })`)
- Add `livePreviewExtension` import
- Replace `wikiLinkExtension` in the extensions array with `livePreviewExtension`

### Modify: `src/lib/cmTheme.ts`

- Keep `.cm-wikilink` rule as-is (the `WikiLinkTarget` tag is styled via `darkHighlightStyle` using `tags.link`)
- Optionally suppress default color of `tags.processingInstruction` for `WikiLinkMark` so hidden markers don't flash before replace decorations render

---

## Cursor Detection Rules

```
inline elements (Bold, Italic, InlineCode, WikiLink):
  show raw ← cursor >= node.from && cursor <= node.to

block elements (Heading):
  show raw ← doc.lineAt(cursor).number === doc.lineAt(node.from).number
```

Selection ranges: only `state.selection.main.head` (cursor position) is checked, matching Obsidian behavior. Multi-cursor support is out of scope.

---

## Styling

All content styles come from the existing `darkHighlightStyle` in `cmTheme.ts` — no new CSS classes needed for bold/italic/heading/code. The `Decoration.replace({})` on markers simply makes them invisible; Lezer's tag-based highlighting continues to style the remaining content nodes.

WikiLink target text inherits `tags.link` color (`#7ec8e3`) and the `.cm-wikilink` rule adds the dotted underline. These rules already exist; no new theme entries are required.

---

## Out of Scope

- `~~strikethrough~~` — not requested, can be added later with same pattern
- `[text](url)` links — not requested
- Fenced code blocks — not requested
- Multi-cursor aware decoration — not requested
- Click-to-navigate on WikiLink — existing behavior not changed

---

## Testing

Manual verification cases (no automated tests planned):

1. Type `**hello**` — markers disappear when cursor leaves
2. Move cursor back inside `hello` — `**` reappears
3. Type `# Title` — `# ` hides on cursor leaving the line
4. Type `` `code` `` — backticks hide on cursor leaving
5. Type `[[Page Name]]` — brackets hide, `Page Name` shows with dotted underline
6. Move cursor into `[[Page Name]]` — full `[[Page Name]]` reappears
7. Existing file loads — all elements render in preview state immediately
