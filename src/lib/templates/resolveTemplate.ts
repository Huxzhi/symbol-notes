import { formatDate } from './formatDate'

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const CURSOR_SENTINEL = '\u0000'

export interface TemplateContext {
  title?: string
  now?: Date
}

export interface ResolvedTemplate {
  text: string
  cursorPos: number | null
}

function offsetDay(base: Date, days: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d
}

export function resolveTemplate(
  content: string,
  ctx: TemplateContext = {},
): ResolvedTemplate {
  const now = ctx.now ?? new Date()
  const title = ctx.title ?? ''

  const replaced = content.replace(/\{\{([^}]*)\}\}/g, (match, raw: string) => {
    const expr = raw.trim()
    if (expr === 'cursor') return CURSOR_SENTINEL
    const colon = expr.indexOf(':')
    const name = (colon === -1 ? expr : expr.slice(0, colon)).trim()
    const fmt = colon === -1 ? '' : expr.slice(colon + 1).trim()
    switch (name) {
      case 'date':
        return formatDate(now, fmt || 'YYYY-MM-DD')
      case 'time':
        return formatDate(now, fmt || 'HH:mm')
      case 'yesterday':
        return formatDate(offsetDay(now, -1), fmt || 'YYYY-MM-DD')
      case 'tomorrow':
        return formatDate(offsetDay(now, 1), fmt || 'YYYY-MM-DD')
      case 'weekday':
        return WEEKDAYS[now.getDay()]
      case 'title':
        return title
      default:
        return match
    }
  })

  const firstCursor = replaced.indexOf(CURSOR_SENTINEL)
  const cursorPos = firstCursor === -1 ? null : firstCursor
  const text = replaced.split(CURSOR_SENTINEL).join('')
  return { text, cursorPos }
}
