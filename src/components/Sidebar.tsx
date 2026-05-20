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
