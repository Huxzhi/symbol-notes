export function toggleInArray(arr: string[], val: string): string[] {
  return arr.includes(val) ? arr.filter(p => p !== val) : [...arr, val]
}
