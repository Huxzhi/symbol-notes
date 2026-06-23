export type HeadingFrame = { text: string; level: number }

/** 弹出所有 level >= 当前的（它们的管辖已结束），再压入当前标题。就地修改 stack。 */
export function pushHeading(stack: HeadingFrame[], level: number, text: string): void {
  while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
  stack.push({ text, level })
}

export function headingPathOf(stack: HeadingFrame[]): string[] {
  return stack.map(f => f.text)
}
