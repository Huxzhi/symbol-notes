import type { JSX } from 'solid-js'
import { ENTRY_STYLE, type CellItem } from './calendarUtils'

const fileStem = (p: string) => p.split('/').pop()?.replace(/\.md$/, '')

/**
 * 渲染单个 cell 条目（月视图格 / 周视图列共用）。
 * wrap=true 时文字换行显示（周视图，列内可滚动）；否则单行截断（月视图固定格高）。
 */
export function CellItemButton(props: {
  item: CellItem
  onOpenFile: (p: string) => void
  wrap?: boolean
}): JSX.Element {
  const item = props.item
  const clip = () => (props.wrap ? 'whitespace-normal break-words' : 'truncate')
  if (item.kind === 'dated') return (
    <button
      class={`shrink-0 text-left text-[10px] leading-snug px-1.5 py-0.5 rounded bg-(--bg-hover) text-[var(--text-2)] ${clip()} w-full cursor-pointer hover:bg-[var(--text-4)] hover:text-[var(--text)] transition-colors`}
      onClick={() => props.onOpenFile(item.path)} title={item.path}
    >{fileStem(item.path)}</button>
  )
  if (item.kind === 'created') return (
    <button
      class={`shrink-0 text-left text-[10px] leading-snug px-1.5 py-0.5 rounded bg-(--accent-bg) text-(--accent) ${clip()} w-full cursor-pointer hover:bg-(--accent) hover:text-white transition-colors`}
      onClick={() => props.onOpenFile(item.path)} title={item.path}
    >{fileStem(item.path)}</button>
  )
  if (item.kind === 'updated') return (
    <button
      class={`shrink-0 text-left text-[10px] leading-snug px-1.5 py-0.5 rounded bg-(--bg-hover) text-[var(--link-2)] ${clip()} w-full cursor-pointer hover:bg-[var(--link-2)] hover:text-white transition-colors`}
      onClick={() => props.onOpenFile(item.path)} title={item.path}
    >{fileStem(item.path)}</button>
  )
  if (item.kind === 'pending') return (
    <button
      class={`shrink-0 text-left text-[10px] leading-snug px-1.5 py-0.5 rounded w-full cursor-pointer transition-colors ${clip()} text-[var(--tag)] hover:opacity-80`}
      style={{ 'background-color': 'color-mix(in srgb, var(--tag) 18%, transparent)' }}
      onClick={() => props.onOpenFile(item.task.path)} title={item.task.path}
    >☐ {item.task.visual}</button>
  )
  if (item.kind === 'done') return (
    <button
      class={`shrink-0 text-left text-[10px] leading-snug px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--text-3)] hover:text-[var(--text-2)] line-through w-full cursor-pointer transition-colors ${clip()}`}
      onClick={() => props.onOpenFile(item.task.path)} title={item.task.path}
    >☑ {item.task.visual}</button>
  )
  if (item.kind === 'event' || item.kind === 'mood' || item.kind === 'idea') {
    const st = ENTRY_STYLE[item.kind]
    return (
      <button
        class={`shrink-0 text-left text-[10px] leading-snug px-1.5 py-0.5 rounded w-full cursor-pointer transition-colors ${clip()} hover:opacity-80`}
        style={{ color: st.hue, 'background-color': `color-mix(in srgb, ${st.hue} 16%, transparent)` }}
        onClick={() => props.onOpenFile(item.entry.path)} title={item.entry.path}
      >{st.sig} {item.entry.visual}</button>
    )
  }
  return null
}
