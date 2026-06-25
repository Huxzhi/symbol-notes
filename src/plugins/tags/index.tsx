import { createMemo, createSignal, For, Show } from 'solid-js'
import { metadataStore } from '../../metadata'
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

function getFilesForTag(tagMap: Record<string, string[]>, tag: string): string[] {
  const paths = new Set<string>()
  for (const [k, files] of Object.entries(tagMap)) {
    if (k === tag || k.startsWith(tag + '/')) {
      for (const f of files) paths.add(f)
    }
  }
  return [...paths].sort()
}

function displayName(path: string): string {
  const name = path.split('/').pop() ?? path
  return name.endsWith('.md') ? name.slice(0, -3) : name
}

function TagTreeNode(props: {
  node: TagNode
  depth: number
  collapsed: Set<string>
  expandedFiles: Set<string>
  onToggleCollapse: (tag: string) => void
  onToggleFiles: (tag: string) => void
  tagMap: Record<string, string[]>
}) {
  const hasChildren = () => props.node.children.length > 0
  const isCollapsed = () => props.collapsed.has(props.node.fullTag)
  const isFilesExpanded = () => props.expandedFiles.has(props.node.fullTag)
  const total = () => subtreeCount(props.node)
  const files = () => isFilesExpanded()
    ? getFilesForTag(props.tagMap, props.node.fullTag)
    : []

  return (
    <div>
      <div
        class="flex items-center gap-1 py-0.5 rounded cursor-pointer hover:bg-(--bg-hover) text-[11px] select-none"
        style={{ 'padding-left': `${8 + props.depth * 12}px`, 'padding-right': '8px' }}
        onClick={() => props.onToggleFiles(props.node.fullTag)}
      >
        <span
          class="w-3 shrink-0 text-center text-(--text-4) text-[9px]"
          onClick={(e) => {
            if (!hasChildren()) return
            e.stopPropagation()
            props.onToggleCollapse(props.node.fullTag)
          }}
        >
          {hasChildren() ? (isCollapsed() ? '▶' : '▼') : ''}
        </span>
        <span class="text-(--text-4)">#</span>
        <span class="flex-1 text-(--text-2)">{props.node.segment}</span>
        <span class="text-(--text-4) text-[10px]">{total()}</span>
      </div>
      <Show when={isFilesExpanded()}>
        <For each={files()}>
          {(path) => (
            <div
              class="truncate text-[11px] cursor-pointer hover:bg-(--bg-hover) text-(--text-2) py-0.5"
              style={{
                'padding-left': `${8 + (props.depth + 1) * 12 + 4}px`,
                'padding-right': '8px',
              }}
              title={path}
              onClick={() => workspaceActions.openFile(path)}
            >
              {displayName(path)}
            </div>
          )}
        </For>
      </Show>
      <Show when={hasChildren() && !isCollapsed()}>
        <For each={props.node.children}>
          {(child) => (
            <TagTreeNode
              node={child}
              depth={props.depth + 1}
              collapsed={props.collapsed}
              expandedFiles={props.expandedFiles}
              onToggleCollapse={props.onToggleCollapse}
              onToggleFiles={props.onToggleFiles}
              tagMap={props.tagMap}
            />
          )}
        </For>
      </Show>
    </div>
  )
}

function TagsPanel() {
  const [collapsed, setCollapsed] = createSignal(new Set<string>())
  const [expandedFiles, setExpandedFiles] = createSignal(new Set<string>())
  const roots = createMemo(() => buildTagTree(metadataStore.tagMap))

  function toggleCollapse(tag: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(tag) ? next.delete(tag) : next.add(tag)
      return next
    })
  }

  function toggleFiles(tag: string) {
    setExpandedFiles(prev => {
      const next = new Set(prev)
      next.has(tag) ? next.delete(tag) : next.add(tag)
      return next
    })
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
              expandedFiles={expandedFiles()}
              onToggleCollapse={toggleCollapse}
              onToggleFiles={toggleFiles}
              tagMap={metadataStore.tagMap}
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
