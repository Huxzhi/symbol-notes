import { FileText } from 'lucide-solid'
import { definePlugin } from '../../lib/pluginRegistry'
import type { SettingsTabProps } from '../../lib/pluginRegistry'
import {
  listTemplates,
  resolveTemplate,
  templatesFolder,
  setTemplatesFolder,
} from '../../lib/templates'
import { showToast } from '../../stores/toastStore'
import { openTemplatePicker } from './pickerStore'

function TemplatesSettings(_props: SettingsTabProps) {
  return (
    <div class="flex flex-col gap-5">
      <div class="flex flex-col gap-1">
        <div class="text-[13px] t-base font-medium">模板文件夹</div>
        <div class="text-[11px] t-3 leading-relaxed">
          相对 vault 根目录。该文件夹下的 .md 文件会作为模板。
        </div>
        <input
          type="text"
          class="mt-1 px-2 py-1 text-[13px] rounded border border-(--border) bg-(--bg-base) text-(--text) focus:outline-none focus:border-(--accent)"
          value={templatesFolder()}
          onInput={(e) => setTemplatesFolder(e.currentTarget.value)}
        />
      </div>
    </div>
  )
}

export const TemplatesPlugin = definePlugin({
  id: 'templates',
  name: '模板',
  description: '动态模板：从模板新建笔记或插入到当前笔记',
  defaultEnabled: true,
  setup(ctx) {
    async function applyToNewNote(templatePath: string, name: string, folder: string) {
      const targetDir = folder.replace(/\/+$/, '')
      const path = targetDir ? `${targetDir}/${name}` : name
      const created = await ctx.vault.createFile(path)
      if (!created) return
      try {
        const raw = await ctx.vault.readFile(templatePath)
        const { text } = resolveTemplate(raw, { title: name })
        await ctx.vault.saveFile(created, text)
      } catch {
        showToast('读取模板失败，已创建空文件')
      }
      ctx.workspace.openFile(created)
    }

    // 入口 A: 文件树文件夹右键 → 从模板新建
    ctx.contextMenu('directory', (d) => {
      const dir = d.path ?? ''
      return [
        {
          label: '从模板新建',
          action: () => {
            void openTemplatePicker('create').then((result) => {
              if (!result || !result.name) return
              void applyToNewNote(result.templatePath, result.name, dir)
            })
          },
        },
      ]
    })

    // 入口 B: Ribbon → 插入模板（到当前编辑器；无编辑器则新建）
    ctx.ribbon({
      id: 'templates-insert',
      title: '插入模板',
      getIcon: () => <FileText size={18} />,
      onClick: () => {
        if (listTemplates().length === 0) {
          showToast('没有可用模板，请先在设置中配置模板文件夹')
          return
        }
        void openTemplatePicker('insert').then(async (result) => {
          if (!result) return
          try {
            const raw = await ctx.vault.readFile(result.templatePath)
            const { text, cursorPos } = resolveTemplate(raw, {})
            const inserted = ctx.workspace.insertAtCursor(text, cursorPos)
            if (!inserted) {
              // 无激活编辑器 → 回退到新建流程
              void openTemplatePicker('create').then((r2) => {
                if (!r2 || !r2.name) return
                void applyToNewNote(r2.templatePath, r2.name, '')
              })
            }
          } catch {
            showToast('读取模板失败')
          }
        })
      },
      isActive: () => false,
    })

    ctx.settings.tab({
      name: '模板',
      component: TemplatesSettings,
    })
  },
})
