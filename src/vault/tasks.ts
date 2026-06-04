import type { FileMeta, TaskItem } from '../stores/types'
import { setVaultStore } from './index'

export function buildTaskMap(files: Record<string, { tasks: TaskItem[] }>): Record<string, TaskItem[]> {
  const result: Record<string, TaskItem[]> = {}
  for (const [path, meta] of Object.entries(files)) {
    if (meta.tasks.length > 0) result[path] = meta.tasks
  }
  return result
}

/** 全量重建 taskMap */
export function buildTasks(mdFiles: Record<string, FileMeta>): void {
  setVaultStore('taskMap', buildTaskMap(mdFiles))
}

/** 单文件 tasks 变化时增量更新 */
export function applyFileTasks(path: string, tasks: TaskItem[]): void {
  setVaultStore('taskMap', path, tasks)
}

/** 文件删除：清理 taskMap 条目 */
export function removeFileTasks(path: string): void {
  setVaultStore('taskMap', path, undefined as unknown as TaskItem[])
}
