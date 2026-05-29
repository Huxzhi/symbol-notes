import { createMemo, createSignal, For, Show } from 'solid-js'
import { cacheStore } from '../../stores/cacheStore'
import { workspaceActions } from '../../stores/workspaceStore'
import { definePlugin } from '../../lib/pluginRegistry'

interface TagNode {
  segment: string
  fullTag: string
  count: number
  children: TagNode[]
}

function buildTagTree(tagMap: Record<string, string[]>): TagNode[] {
  const tagged: Record<string, number> = {}
  for (const [tag, files] of Object.entries(tagMap)) {
    if (files?.length) tagged[tag] = files.length
  }

  function buildLevel(prefix: string): TagNode[] {
    const seen = new Map<string, string>()
    for (const tag of Object.keys(tagged)) {
      const rest = prefix
        ? tag.startsWith(prefix + '/') ? tag.slice(prefix.length + 1) : null
        : tag
      if (rest === null) continue
      const segment = rest.split('/')[0]
      const fullTag = prefix ? `${prefix}/${segment}` : segment
      if (!seen.has(segment)) seen.set(segment, fullTag)
    }
    return [...seen.entries()]
      .map(([segment, fullTag]) => ({
        segment,
        fullTag,
        count: tagged[fullTag] ?? 0,
        children: buildLevel(fullTag),
      }))
      .sort((a, b) => a.segment.localeCompare(b.segment))
  }

  return buildLevel('')
}

function subtreeCount(node: TagNode): number {
  return node.count + node.children.reduce((s, c) => s + subtreeCount(c), 0)
}

function TagTreeNode(props: {
  node: TagNode
  depth: number
  collapsed: Set<string>
  onToggle: (tag: string) => void
  onSelect: (tag: string) => void
}) {
  const hasChildren = () => props.node.children.length > 0
  const isCollapsed = () => props.collapsed.has(props.node.fullTag)
  const total = () => subtreeCount(props.node)

  return (
    <div>
      <div
        class="flex items-center gap-1 py-0.5 rounded cursor-pointer hover:bg-(--bg-hover) text-[11px] select-none"
        style={{ 'padding-left': `${8 + props.depth * 12}px`, 'padding-right': '8px' }}
        onClick={() => props.onSelect(props.node.fullTag)}
      >
        <span
          class="w-3 shrink-0 text-center text-(--text-4) text-[9px]"
          onClick={(e) => {
            if (!hasChildren()) return
            e.stopPropagation()
            props.onToggle(props.node.fullTag)
          }}
        >
          {hasChildren() ? (isCollapsed() ? '▶' : '▼') : ''}
        </span>
        <span class="text-(--text-4)">#</span>
        <span class="flex-1 text-(--text-2)">{props.node.segment}</span>
        <span class="text-(--text-4) text-[10px]">{total()}</span>
      </div>
      <Show when={hasChildren() && !isCollapsed()}>
        <For each={props.node.children}>
          {(child) => (
            <TagTreeNode
              node={child}
              depth={props.depth + 1}
              collapsed={props.collapsed}
              onToggle={props.onToggle}
              onSelect={props.onSelect}
            />
          )}
        </For>
      </Show>
    </div>
  )
}

function TagsPanel() {
  const [collapsed, setCollapsed] = createSignal(new Set<string>())
  const roots = createMemo(() => buildTagTree(cacheStore.tagMap))

  function toggle(tag: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(tag) ? next.delete(tag) : next.add(tag)
      return next
    })
  }

  function select(tag: string) {
    workspaceActions.openSidebarPanel('right', 'search', { tag })
  }

  return (
    <div class="py-1 overflow-y-auto h-full">
      <Show
        when={roots().length > 0}
        fallback={<div class="px-3 py-2 text-[11px] text-(--text-4) italic">暂无标签</div>}
      >
        <For each={roots()}>
          {(node) => (
            <TagTreeNode
              node={node}
              depth={0}
              collapsed={collapsed()}
              onToggle={toggle}
              onSelect={select}
            />
          )}
        </For>
      </Show>
    </div>
  )
}

export const TagsPlugin = definePlugin({
  id: 'tags',
  name: '标签',
  core: true,
  setup(ctx) {
    ctx.view({
      kind: 'panel',
      position: 'right',
      type: 'tags',
      getDisplayText: () => '标签',
      component: TagsPanel,
    })
  },
})
