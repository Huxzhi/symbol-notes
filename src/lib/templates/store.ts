import { getPluginConfig, setPluginConfig } from '../pluginData'
import { vaultStore } from '../../vault'
import type { FileEntry } from '../../stores/types'

export interface TemplateEntry {
  name: string
  path: string
}

/** 模板文件夹：存 plugins/templates/data.json 的 folder 字段（缺省 'templates'）。 */
export function templatesFolder(): string {
  const v = getPluginConfig('templates').folder
  return typeof v === 'string' ? v : 'templates'
}

export function setTemplatesFolder(folder: string): void {
  setPluginConfig('templates', { folder })
}

export function filterTemplateFiles(
  files: Record<string, FileEntry>,
  folder: string,
): TemplateEntry[] {
  const trimmed = folder.replace(/\/+$/, '')
  if (!trimmed) return []
  const prefix = trimmed + '/'
  return Object.values(files)
    .filter(
      (f) =>
        f.kind === 'file' &&
        f.path.endsWith('.md') &&
        f.path.startsWith(prefix),
    )
    .map((f) => ({ name: f.name.replace(/\.md$/, ''), path: f.path }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function listTemplates(): TemplateEntry[] {
  return filterTemplateFiles(vaultStore.files, templatesFolder())
}
