import { For } from 'solid-js'
import { BookOpen } from 'lucide-solid'
import type { SettingsTabProps } from '../../lib/pluginRegistry'
import { definePlugin } from '../../lib/pluginRegistry'
import { closeModal, showModal } from '../../stores/modalStore'
import { listTemplates, resolveTemplate } from '../../lib/templates'
import { todayPath } from './formatDate'

const DEFAULTS = {
  folder: 'journal',
  dateFormat: 'YYYY-MM-DD',
  autoCreate: false,
  template: '', // 模板文件 path；空 = 不使用
}

function TextRow(props: {
  label: string
  description?: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div class="flex flex-col gap-1">
      <div class="text-[13px] t-base font-medium">{props.label}</div>
      {props.description && (
        <div class="text-[11px] t-3 leading-relaxed">{props.description}</div>
      )}
      <input
        type="text"
        class="mt-1 px-2 py-1 text-[13px] rounded border border-(--border) bg-(--bg-base) text-(--text) focus:outline-none focus:border-(--accent)"
        value={props.value}
        onInput={(e) => props.onChange(e.currentTarget.value)}
      />
    </div>
  )
}

function ToggleRow(props: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label class="flex items-start gap-3 cursor-pointer select-none">
      <div class="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          class="sr-only"
          checked={props.checked}
          onChange={(e) => props.onChange(e.currentTarget.checked)}
        />
        <div
          class={`w-9 h-5 rounded-full transition-colors ${props.checked ? 'bg-(--accent)' : 'bg-(--bg-active)'}`}
        />
        <div
          class={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${props.checked ? 'translate-x-4' : ''}`}
        />
      </div>
      <div>
        <div class="text-[13px] t-base font-medium">{props.label}</div>
        {props.description && (
          <div class="text-[11px] t-3 mt-0.5 leading-relaxed">
            {props.description}
          </div>
        )}
      </div>
    </label>
  )
}

function DailyNoteSettings(props: SettingsTabProps) {
  const config = () => props.getConfig(DEFAULTS)
  return (
    <div class="flex flex-col gap-5">
      <TextRow
        label="日记文件夹"
        description="相对 vault 根目录，留空则存于根目录"
        value={config().folder as string}
        onChange={(v) => props.setConfig({ folder: v })}
      />
      <TextRow
        label="日期格式"
        description="支持 YYYY、MM、DD（例：YYYY-MM-DD）"
        value={config().dateFormat as string}
        onChange={(v) => props.setConfig({ dateFormat: v })}
      />
      <ToggleRow
        label="自动创建（不弹确认框）"
        description="开启后点击按钮直接创建今日日记，不询问"
        checked={config().autoCreate as boolean}
        onChange={(v) => props.setConfig({ autoCreate: v })}
      />
      <div class="flex flex-col gap-1">
        <div class="text-[13px] t-base font-medium">模板</div>
        <div class="text-[11px] t-3 leading-relaxed">
          新建日记时套用的模板（来自“模板”设置里配置的文件夹）。
        </div>
        <select
          class="mt-1 px-2 py-1 text-[13px] rounded border border-(--border) bg-(--bg-base) text-(--text) focus:outline-none focus:border-(--accent)"
          value={config().template as string}
          onChange={(e) => props.setConfig({ template: e.currentTarget.value })}
        >
          <option value="">无</option>
          <For each={listTemplates()}>
            {(t) => <option value={t.path}>{t.name}</option>}
          </For>
        </select>
      </div>
    </div>
  )
}

export const DailyNotePlugin = definePlugin({
  id: 'daily-note',
  name: '今日日记',
  core: true,
  description: '快速打开或新建今天的日记文件',
  defaultEnabled: true,
  setup(ctx) {
    async function openToday() {
      const { folder, dateFormat, autoCreate } =
        ctx.settings.getConfig(DEFAULTS)
      const path = todayPath(folder as string, dateFormat as string)

      if (ctx.vault.files()[path]) {
        ctx.workspace.openFile(path)
        return
      }

      const { template } = ctx.settings.getConfig(DEFAULTS)

      const createWithTemplate = async () => {
        const created = await ctx.vault.createFile(path)
        if (!created) return
        const tpl = template as string
        if (tpl) {
          try {
            const raw = await ctx.vault.readFile(tpl)
            const fileName = path.split('/').pop()!.replace(/\.md$/, '')
            const { text } = resolveTemplate(raw, { title: fileName })
            await ctx.vault.saveFile(created, text)
          } catch {
            // 模板读取失败：保持空文件
          }
        }
        ctx.workspace.openFile(created)
      }

      if (autoCreate) {
        await createWithTemplate()
        return
      }

      showModal({
        title: '创建今日日记',
        message: `创建 ${path}？`,
        buttons: [
          { label: '取消', variant: 'ghost', onClick: closeModal },
          {
            label: '创建',
            variant: 'primary',
            onClick: () => {
              closeModal()
              void createWithTemplate()
            },
          },
        ],
      })
    }

    ctx.ribbon({
      id: 'daily-note',
      title: '今日日记',
      getIcon: () => <BookOpen size={18} />,
      onClick: () => void openToday(),
      isActive: () => {
        const { folder, dateFormat } = ctx.settings.getConfig(DEFAULTS)
        const path = todayPath(folder as string, dateFormat as string)
        return ctx.workspace.activeFilePath() === path
      },
    })

    ctx.settings.tab({
      name: '今日日记',
      component: DailyNoteSettings,
    })
  },
})
