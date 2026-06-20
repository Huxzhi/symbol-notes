import { PenLine } from 'lucide-solid'
import { definePlugin } from '../../lib/pluginRegistry'
import type { SettingsTabProps } from '../../lib/pluginRegistry'
import { setPluginConfig } from '../../lib/pluginData'
import { EMPTY_EXCALIDRAW_MD } from './excalidrawFormat'
import { ExcalidrawViewer } from './ExcalidrawViewer'

// ── Plugin config defaults (key: sn-plugin-excalidraw in localStorage) ────────

export const EXCALIDRAW_DEFAULTS = {
  defaultTheme: 'dark' as 'dark' | 'light',
  viewBackgroundColor: '#1e1e2e',
  gridSize: 0,           // 0 = disabled
}

export type ExcalidrawPluginConfig = typeof EXCALIDRAW_DEFAULTS

// ── Settings UI ───────────────────────────────────────────────────────────────

function Row(props: { label: string; description?: string; children: any }) {
  return (
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <div class="text-[13px] text-(--text) font-medium">{props.label}</div>
        {props.description && (
          <div class="text-[11px] text-(--text-3) mt-0.5 leading-relaxed">{props.description}</div>
        )}
      </div>
      <div class="shrink-0">{props.children}</div>
    </div>
  )
}

function ExcalidrawSettings(props: SettingsTabProps) {
  const cfg = () => props.getConfig(EXCALIDRAW_DEFAULTS) as ExcalidrawPluginConfig

  return (
    <div class="flex flex-col gap-6">

      {/* 默认主题 */}
      <Row label="默认主题" description="新建绘图文件时使用的 Excalidraw 主题，已保存文件会恢复上次的主题">
        <div class="flex rounded overflow-hidden border border-(--border)">
          {(['dark', 'light'] as const).map((t) => (
            <button
              class={`px-3 py-1 text-[12px] transition-colors cursor-pointer ${
                cfg().defaultTheme === t
                  ? 'bg-(--accent) text-white'
                  : 'text-(--text-2) hover:bg-(--bg-hover)'
              }`}
              onClick={() => props.setConfig({ defaultTheme: t })}
            >
              {t === 'dark' ? '深色' : '浅色'}
            </button>
          ))}
        </div>
      </Row>

      {/* 默认背景色 */}
      <Row label="默认画布背景色" description="新建绘图文件时的画布背景颜色">
        <div class="flex items-center gap-2">
          <input
            type="color"
            class="w-8 h-8 rounded cursor-pointer border border-(--border) bg-transparent p-0.5"
            value={cfg().viewBackgroundColor as string}
            onInput={(e) => props.setConfig({ viewBackgroundColor: e.currentTarget.value })}
          />
          <input
            type="text"
            class="w-24 px-2 py-1 text-[12px] rounded border border-(--border) bg-(--bg-base) text-(--text) font-mono focus:outline-none focus:border-(--accent)"
            value={cfg().viewBackgroundColor as string}
            onInput={(e) => props.setConfig({ viewBackgroundColor: e.currentTarget.value })}
          />
        </div>
      </Row>

      {/* 网格大小 */}
      <Row label="默认网格大小" description="0 表示关闭网格；Excalidraw 推荐值为 20">
        <input
          type="number"
          min="0"
          max="100"
          class="w-20 px-2 py-1 text-[12px] rounded border border-(--border) bg-(--bg-base) text-(--text) focus:outline-none focus:border-(--accent)"
          value={cfg().gridSize as number}
          onInput={(e) => props.setConfig({ gridSize: Number(e.currentTarget.value) })}
        />
      </Row>

    </div>
  )
}

// ── Config updater (called from ExcalidrawViewer on save) ────────────────────
// Writes directly to localStorage so theme/grid changes in Excalidraw UI
// are persisted as global defaults for the next file opened.

export function updateExcalidrawPluginConfig(patch: Partial<ExcalidrawPluginConfig>): void {
  setPluginConfig('excalidraw', patch as Record<string, unknown>)
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export const ExcalidrawPlugin = definePlugin({
  id: 'excalidraw',
  name: 'Excalidraw',
  description: 'Excalidraw 绘图编辑器',
  defaultEnabled: true,
  setup(ctx) {
    function getUniqueName(dirPath: string | null): string {
      const files = ctx.vault.files()
      const prefix = dirPath ? `${dirPath}/` : ''
      if (!files[`${prefix}Untitled.excalidraw.md`]) return 'Untitled.excalidraw.md'
      for (let i = 1; i <= 99; i++) {
        const name = `Untitled ${i}.excalidraw.md`
        if (!files[`${prefix}${name}`]) return name
      }
      return `Untitled ${Date.now()}.excalidraw.md`
    }

    async function createExcalidrawFile(dirPath: string | null): Promise<void> {
      const name = getUniqueName(dirPath)
      const fullName = dirPath ? `${dirPath}/${name}` : name
      const path = await ctx.vault.createFile(fullName)
      if (!path) return
      await ctx.vault.saveFile(path, EMPTY_EXCALIDRAW_MD)
      ctx.workspace.openFile(path)
    }

    ctx.view({
      kind: 'file',
      type: 'excalidraw',
      getDisplayText: (p) => {
        const name = p.split('/').pop() ?? p
        if (name.endsWith('.excalidraw.md')) return name.slice(0, -14)
        if (name.endsWith('.excalidraw')) return name.slice(0, -11)
        return name
      },
      canAcceptFile: (p) => p.endsWith('.excalidraw.md') || p.endsWith('.excalidraw'),
      component: ExcalidrawViewer,
    })

    ctx.ribbon({
      id: 'new-excalidraw',
      title: '新建 Excalidraw 绘图',
      getIcon: () => <PenLine size={18} />,
      onClick: () => void createExcalidrawFile(null),
    })

    ctx.contextMenu('directory', (d) => {
      const dirPath = (d.path as string) ?? null
      return [
        { label: '新建 Excalidraw 绘图', action: () => void createExcalidrawFile(dirPath) },
      ]
    })

    ctx.settings.tab({
      name: 'Excalidraw',
      component: ExcalidrawSettings,
    })
  },
})
