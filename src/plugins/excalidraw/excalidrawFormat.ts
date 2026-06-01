import LZString from 'lz-string'

export type ExcalidrawMode = 'parsed' | 'compressed'

export interface ExcalidrawElement {
  id: string
  type: string
  text?: string
  [key: string]: unknown
}

export interface ExcalidrawData {
  type: 'excalidraw'
  version: number
  source?: string
  elements: ExcalidrawElement[]
  appState: Record<string, unknown>
  files: Record<string, unknown>
}

export interface ParseResult {
  data: ExcalidrawData
  mode: ExcalidrawMode
}

const FRONTMATTER_MODE_RE = /^---[\s\S]*?excalidraw-plugin:\s*(parsed|compressed)/
const PARSED_BLOCK_RE = /%%[\s\S]*?```json\s*\n([\s\S]*?)\n```[\s\S]*?%%/
const COMPRESSED_BLOCK_RE = /%%[\s\S]*?```compressed-json\s*\n([\s\S]*?)\n```[\s\S]*?%%/

export function parseExcalidrawMd(content: string): ParseResult {
  const modeMatch = FRONTMATTER_MODE_RE.exec(content)
  if (!modeMatch)
    throw new Error('Not a valid Excalidraw file: missing excalidraw-plugin frontmatter')
  const mode = modeMatch[1] as ExcalidrawMode

  let jsonStr: string
  if (mode === 'parsed') {
    const m = PARSED_BLOCK_RE.exec(content)
    if (!m) throw new Error('Missing ```json block in Excalidraw file')
    jsonStr = m[1]
  } else {
    const m = COMPRESSED_BLOCK_RE.exec(content)
    if (!m) throw new Error('Missing ```compressed-json block in Excalidraw file')
    const decompressed = LZString.decompressFromBase64(m[1])
    if (!decompressed) throw new Error('Failed to decompress Excalidraw data')
    jsonStr = decompressed
  }

  const data = JSON.parse(jsonStr) as ExcalidrawData
  return { data, mode }
}

function buildTextElements(elements: ExcalidrawElement[]): string {
  return elements
    .filter((el) => el.type === 'text' && el.text)
    .map((el) => `${el.id}:: ${el.text}`)
    .join('\n')
}

export function serializeExcalidrawMd(data: ExcalidrawData, mode: ExcalidrawMode): string {
  const textElements = buildTextElements(data.elements)
  const drawingBlock =
    mode === 'parsed'
      ? `\`\`\`json\n${JSON.stringify(data)}\n\`\`\``
      : `\`\`\`compressed-json\n${LZString.compressToBase64(JSON.stringify(data))}\n\`\`\``

  return `---
excalidraw-plugin: ${mode}
tags: [excalidraw]
---
==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this panel. ⚠==

# Text Elements
${textElements}

%%
# Drawing
${drawingBlock}
%%
`
}

export const EMPTY_EXCALIDRAW_DATA: ExcalidrawData = {
  type: 'excalidraw',
  version: 2,
  source: 'symbol-notes',
  elements: [],
  appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
  files: {},
}

export const EMPTY_EXCALIDRAW_MD = serializeExcalidrawMd(EMPTY_EXCALIDRAW_DATA, 'parsed')
