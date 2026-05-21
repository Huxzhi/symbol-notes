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
    '.cm-blockquote': {
      borderLeft: '3px solid #6c63ff',
      paddingLeft: '16px',
    },
    '.cm-task-checkbox': {
      cursor: 'pointer',
      verticalAlign: 'middle',
      marginRight: '4px',
      accentColor: '#6c63ff',
    },
    '.cm-wikilink': {
      color: '#7ec8e3',
      textDecoration: 'underline',
      textDecorationStyle: 'dotted',
      cursor: 'pointer',
    },
    '.cm-hr-widget': {
      display: 'block',
      height: '1px',
      background: '#3a3a5c',
      backgroundClip: 'content-box',
      border: 'none',
      padding: '11px 0',
      width: '100%',
      boxSizing: 'content-box',
    },
    '.cm-table-widget-wrapper': {
      padding: '8px 0',
    },
    '.cm-table-widget': {
      borderCollapse: 'collapse',
      width: '100%',
      fontSize: '14px',
    },
    '.cm-table-widget th, .cm-table-widget td': {
      border: '1px solid #3a3a5c',
      padding: '4px 12px',
      textAlign: 'left',
      color: '#ccc',
    },
    '.cm-table-widget thead': {
      background: '#1a1a2e',
    },
    '.cm-table-widget thead th': {
      color: '#9d8dff',
      fontWeight: 'bold',
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
