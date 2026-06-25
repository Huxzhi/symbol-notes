import type { FileMeta, ListItem } from '../../stores/types'
import { setVaultStore } from '../../vault/store'

export function buildTaskMap(files: Record<string, { lists: ListItem[] }>): Record<string, ListItem[]> {
  const result: Record<string, ListItem[]> = {}
  for (const [path, meta] of Object.entries(files)) {
    const tasks = meta.lists.filter((l) => l.task)
    if (tasks.length > 0) result[path] = tasks
  }
  return result
}

/** 全量重建 taskMap */
export function buildTasks(mdFiles: Record<string, FileMeta>): void {
  setVaultStore('taskMap', buildTaskMap(mdFiles))
}

/** 单文件 lists 变化时增量更新任务子集 */
export function applyFileTasks(path: string, lists: ListItem[]): void {
  setVaultStore('taskMap', path, lists.filter((l) => l.task))
}

/** 文件删除：清理 taskMap 条目 */
export function removeFileTasks(path: string): void {
  setVaultStore('taskMap', path, undefined as unknown as ListItem[])
}
