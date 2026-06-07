import { formatDate } from '../../lib/templates/formatDate'

export { formatDate }

export function todayPath(folder: string, dateFormat: string, date = new Date()): string {
  const name = formatDate(date, dateFormat) + '.md'
  return folder ? `${folder}/${name}` : name
}
