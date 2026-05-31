export function formatDate(date: Date, fmt: string): string {
  const y = date.getFullYear().toString()
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  const d = date.getDate().toString().padStart(2, '0')
  return fmt.replaceAll('YYYY', y).replaceAll('MM', m).replaceAll('DD', d)
}

export function todayPath(folder: string, dateFormat: string, date = new Date()): string {
  const name = formatDate(date, dateFormat) + '.md'
  return folder ? `${folder}/${name}` : name
}
