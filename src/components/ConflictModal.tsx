import { createMemo, createSignal, For, Show } from 'solid-js'
import { conflictStore, closeConflict } from '../stores/conflictStore'

// ── Line diff (LCS-based, capped at 500 lines each side) ─────────────────────

type DiffLine = { type: 'same' | 'add' | 'del'; text: string }

function computeDiff(editorText: string, diskText: string): DiffLine[] | null {
  const a = editorText.split('\n')
  const b = diskText.split('\n')
  if (a.length > 500 || b.length > 500) return null

  const m = a.length, n = b.length
  // Uint16Array: 2 bytes/entry vs 8, fine for LCS ≤ 500
  const dp: Uint16Array[] = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])

  const result: DiffLine[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.unshift({ type: 'same', text: a[i - 1] }); i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'add', text: b[j - 1] }); j--   // add = in disk, not editor
    } else {
      result.unshift({ type: 'del', text: a[i - 1] }); i--   // del = in editor, not disk
    }
  }
  return result
}

// Collapse long unchanged runs; keep `ctx` lines of context around changes.
type ViewChunk = { type: 'lines'; lines: DiffLine[] } | { type: 'skip'; count: number }

function collapseContext(diff: DiffLine[], ctx = 3): ViewChunk[] {
  const shown = new Set<number>()
  diff.forEach((l, i) => {
    if (l.type !== 'same')
      for (let k = Math.max(0, i - ctx); k <= Math.min(diff.length - 1, i + ctx); k++)
        shown.add(k)
  })
  if (shown.size === 0) return [{ type: 'skip', count: diff.length }]

  const chunks: ViewChunk[] = []
  let i = 0
  while (i < diff.length) {
    if (shown.has(i)) {
      const lines: DiffLine[] = []
      while (i < diff.length && shown.has(i)) lines.push(diff[i++])
      chunks.push({ type: 'lines', lines })
    } else {
      let count = 0
      while (i < diff.length && !shown.has(i)) { count++; i++ }
      chunks.push({ type: 'skip', count })
    }
  }
  return chunks
}

// ── Component ─────────────────────────────────────────────────────────────────

const LINE_STYLE: Record<DiffLine['type'], string> = {
  add:  'bg-[#1a3a1a] text-[#7ec87e] select-text',
  del:  'bg-[#3a1a1a] text-[#e07a7a] select-text',
  same: 'text-(--text-4) select-text',
}
const LINE_PREFIX: Record<DiffLine['type'], string> = { add: '+', del: '-', same: ' ' }

export function ConflictModal() {
  const [tab, setTab] = createSignal<'diff' | 'disk'>('diff')

  const diff = createMemo(() =>
    conflictStore.open
      ? computeDiff(conflictStore.editorContent, conflictStore.diskContent)
      : null
  )
  const chunks = createMemo(() => {
    const d = diff()
    return d ? collapseContext(d) : null
  })

  function choose(choice: 'overwrite' | 'reload' | 'cancel') {
    conflictStore.onChoice(choice)
    closeConflict()
  }

  return (
    <Show when={conflictStore.open}>
      <div
        class="fixed inset-0 z-[10000] flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.6)' }}
        onClick={(e) => { if (e.target === e.currentTarget) choose('cancel') }}
      >
        <div
          class="bg-(--bg-elevated) border border-(--border-2) rounded-lg shadow-xl flex flex-col"
          style={{ width: 'min(780px, 92vw)', 'max-height': '82vh' }}
        >
          {/* Header */}
          <div class="px-5 pt-4 pb-3 border-b border-(--border) shrink-0">
            <h2 class="text-[15px] font-semibold text-(--text) mb-0.5">文件冲突</h2>
            <p class="text-[12px] text-(--text-3)">
              <span class="font-medium text-(--text-2)">{conflictStore.filename}</span>
              {' '}已被外部程序修改，与编辑器中的版本不一致。
            </p>
          </div>

          {/* Tabs */}
          <div class="flex gap-0 px-5 pt-2 shrink-0 border-b border-(--border)">
            {(['diff', 'disk'] as const).map((t) => (
              <button
                class={`px-3 py-1.5 text-[12px] border-b-2 transition-colors mr-1 ${
                  tab() === t
                    ? 'border-(--accent) text-(--accent) font-medium'
                    : 'border-transparent text-(--text-3) hover:text-(--text)'
                }`}
                onClick={() => setTab(t)}
              >
                {t === 'diff' ? '差异' : '磁盘原版'}
              </button>
            ))}
          </div>

          {/* Content */}
          <div class="flex-1 overflow-y-auto min-h-0 font-mono text-[11px] leading-snug">
            {/* Diff tab */}
            <Show when={tab() === 'diff'}>
              <Show when={diff() === null}>
                <div class="px-5 py-4 text-(--text-3) text-[12px]">
                  文件过长（超过 500 行），差异视图不可用。请切换到"磁盘原版"查看。
                </div>
              </Show>
              <Show when={diff() !== null}>
                <div class="px-1 py-1">
                  <div class="text-[10px] text-(--text-4) px-3 pb-1 select-none">
                    <span class="text-[#7ec87e]">+ 磁盘新增</span>
                    {'  '}
                    <span class="text-[#e07a7a]">- 编辑器独有</span>
                  </div>
                  <For each={chunks()!}>
                    {(chunk) => (
                      <>
                        <Show when={chunk.type === 'skip'}>
                          <div class="px-3 py-0.5 text-(--text-4) text-[10px] select-none italic">
                            … 跳过 {(chunk as { type: 'skip'; count: number }).count} 行 …
                          </div>
                        </Show>
                        <Show when={chunk.type === 'lines'}>
                          <For each={(chunk as { type: 'lines'; lines: DiffLine[] }).lines}>
                            {(line) => (
                              <div class={`flex px-2 py-px ${LINE_STYLE[line.type]}`}>
                                <span class="w-4 shrink-0 select-none opacity-60">
                                  {LINE_PREFIX[line.type]}
                                </span>
                                <span class="whitespace-pre-wrap break-all">{line.text || ' '}</span>
                              </div>
                            )}
                          </For>
                        </Show>
                      </>
                    )}
                  </For>
                </div>
              </Show>
            </Show>

            {/* Disk tab */}
            <Show when={tab() === 'disk'}>
              <pre class="px-4 py-3 text-(--text-2) whitespace-pre-wrap break-all select-text leading-relaxed text-[11px]">
                {conflictStore.diskContent}
              </pre>
            </Show>
          </div>

          {/* Buttons */}
          <div class="flex justify-end gap-2 px-5 py-3 border-t border-(--border) shrink-0">
            <button
              class="px-3 py-1.5 text-[13px] rounded border border-(--border-2) text-(--text-3) hover:text-(--text) transition-colors"
              onClick={() => choose('cancel')}
            >
              取消
            </button>
            <button
              class="px-3 py-1.5 text-[13px] rounded border border-(--accent) text-(--accent) hover:bg-(--accent)/10 transition-colors"
              onClick={() => choose('reload')}
            >
              重新加载
            </button>
            <button
              class="px-3 py-1.5 text-[13px] rounded border border-[#e05252] text-[#e05252] hover:bg-[#e05252]/10 transition-colors"
              onClick={() => choose('overwrite')}
            >
              覆盖保存
            </button>
          </div>
        </div>
      </div>
    </Show>
  )
}
