import { createSignal } from 'solid-js'
import { loadFromStorage, saveToStorage } from '../localStorage'
import { vaultStore } from '../../vault'
import type { FileMeta } from '../../stores/types'

const KEY = 'sn-templates'

export interface TemplateEntry {
  name: string
  path: string
}

const initial = loadFromStorage<{ folder: string }>(
  KEY,
  { folder: 'templates' },
  (v) => typeof v === 'object' && v !== null,
)

const [templatesFolder, setTemplatesFolderSignal] = createSignal(initial.folder)

export { templatesFolder }

export function setTemplatesFolder(folder: string): void {
  setTemplatesFolderSignal(folder)
  saveToStorage(KEY, { folder })
}

export function filterTemplateFiles(
  files: Record<string, FileMeta>,
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
