export interface ParsedFile {
  frontmatter: Record<string, unknown>
  body: string
}

export function parseFrontmatter(raw: string): ParsedFile {
  if (!raw.startsWith('---')) return { frontmatter: {}, body: raw }
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return { frontmatter: {}, body: raw }
  const yamlStr = raw.slice(4, end)
  const body = raw.slice(end + 4).replace(/^\n/, '')
  return { frontmatter: parseYamlSubset(yamlStr), body }
}

export function parseYamlSubset(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = yaml.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) {
      i++
      continue
    }
    const key = line.slice(0, colonIdx).trim()
    if (!key) {
      i++
      continue
    }
    const rest = line.slice(colonIdx + 1).trim()
    if (rest === '') {
      const items: string[] = []
      i++
      while (i < lines.length && /^\s+-\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\s+-\s*/, '').trim())
        i++
      }
      result[key] = items
    } else if (rest.startsWith('[') && rest.endsWith(']')) {
      result[key] = rest
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      i++
    } else {
      result[key] = parseScalar(rest)
      i++
    }
  }
  return result
}

function parseScalar(value: string): unknown {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null' || value === '~') return null
  const num = Number(value)
  if (value !== '' && !isNaN(num)) return num
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

export function formatTimestamp(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

// Set or add a single frontmatter field in-place, preserving all other content.
// Creates a frontmatter block if the file has none.
export function setFrontmatterField(
  content: string,
  key: string,
  value: string,
): string {
  if (!content.startsWith('---')) {
    return `---\n${key}: ${value}\n---\n\n${content}`
  }
  const fmEnd = content.indexOf('\n---', 3)
  if (fmEnd === -1) {
    return `---\n${key}: ${value}\n---\n\n${content}`
  }
  const yaml = content.slice(4, fmEnd)
  const rest = content.slice(fmEnd + 4) // everything after closing ---
  const fieldRe = new RegExp(`^(${key}:[ \\t]*).*$`, 'm')
  if (fieldRe.test(yaml)) {
    return `---\n${yaml.replace(fieldRe, `$1${value}`)}\n---${rest}`
  }
  return `---\n${yaml}\n${key}: ${value}\n---${rest}`
}

export function serializeFrontmatter(
  frontmatter: Record<string, unknown>,
  body: string,
): string {
  if (Object.keys(frontmatter).length === 0) return body
  const yaml = Object.entries(frontmatter)
    .map(([k, v]) => {
      if (Array.isArray(v)) {
        if (v.length === 0) return `${k}: []`
        return `${k}:\n${v.map((item) => `  - ${item}`).join('\n')}`
      }
      const s = String(v)
      if (s.includes(':') || s.includes('#'))
        return `${k}: "${s.replace(/"/g, '\\"')}"`
      return `${k}: ${s}`
    })
    .join('\n')
  return `---\n${yaml}\n---\n${body}`
}
