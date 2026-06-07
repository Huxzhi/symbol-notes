export function formatDate(date: Date, fmt: string): string {
  const y = date.getFullYear().toString()
  const M = (date.getMonth() + 1).toString().padStart(2, '0')
  const D = date.getDate().toString().padStart(2, '0')
  const H = date.getHours().toString().padStart(2, '0')
  const m = date.getMinutes().toString().padStart(2, '0')
  const s = date.getSeconds().toString().padStart(2, '0')
  return fmt
    .replaceAll('YYYY', y)
    .replaceAll('MM', M)
    .replaceAll('DD', D)
    .replaceAll('HH', H)
    .replaceAll('mm', m)
    .replaceAll('ss', s)
}
