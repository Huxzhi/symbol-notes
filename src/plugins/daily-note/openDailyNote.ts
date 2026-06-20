import { getPluginConfig } from '../../lib/pluginData'
import { workspaceActions } from '../../stores/workspaceStore'
import { vaultStore, fileActions, readFile } from '../../vault'
import { resolveTemplate } from '../../lib/templates'
import { showModal, closeModal } from '../../stores/modalStore'
import { todayPath } from './formatDate'

const DEFAULTS = {
  folder: 'journal',
  dateFormat: 'YYYY-MM-DD',
  autoCreate: false,
  template: '',
}

/** 读取「今日日记」插件的持久化配置（与插件内 createStore 同一 localStorage 键）。 */
function dailyConfig() {
  return { ...DEFAULTS, ...getPluginConfig('daily-note') }
}

/** 某天日记的目标路径（按日记插件的文件夹 + 日期格式）。 */
export function dailyNotePath(date: Date): string {
  const cfg = dailyConfig()
  return todayPath(String(cfg.folder), String(cfg.dateFormat), date)
}

/**
 * 打开某天的日记：存在则直接打开；否则按日记插件设置创建——
 * autoCreate 时直接建并套用模板，否则弹框确认后再建。
 */
export async function openDailyNote(date: Date): Promise<void> {
  const cfg = dailyConfig()
  const path = todayPath(String(cfg.folder), String(cfg.dateFormat), date)

  if (vaultStore.files[path]) {
    workspaceActions.openFile(path)
    return
  }

  const createWithTemplate = async () => {
    const created = await fileActions.createFile(path)
    if (!created) return
    const tpl = String(cfg.template ?? '')
    if (tpl) {
      try {
        const raw = await readFile(tpl)
        const fileName = path.split('/').pop()!.replace(/\.md$/, '')
        const { text } = resolveTemplate(raw, { title: fileName })
        await fileActions.saveFile(created, text)
      } catch {
        // 模板读取失败：保持空文件
      }
    }
    workspaceActions.openFile(created)
  }

  if (cfg.autoCreate) {
    await createWithTemplate()
    return
  }

  showModal({
    title: '创建日记',
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
