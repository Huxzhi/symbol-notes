import { describe, it, expect } from 'vitest'
import LZString from 'lz-string'
import {
  parseExcalidrawMd,
  serializeExcalidrawMd,
  EMPTY_EXCALIDRAW_MD,
  type ExcalidrawData,
} from '../excalidrawFormat'

const SAMPLE_DATA: ExcalidrawData = {
  type: 'excalidraw',
  version: 2,
  source: 'symbol-notes',
  elements: [],
  appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
  files: {},
}

const PARSED_FILE = `---
excalidraw-plugin: parsed
tags: [excalidraw]
---
==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this panel. ⚠==

# Text Elements

%%
# Drawing
\`\`\`json
${JSON.stringify(SAMPLE_DATA)}
\`\`\`
%%
`

describe('parseExcalidrawMd — parsed mode', () => {
  it('extracts data and mode', () => {
    const result = parseExcalidrawMd(PARSED_FILE)
    expect(result.mode).toBe('parsed')
    expect(result.data.type).toBe('excalidraw')
    expect(result.data.elements).toEqual([])
    expect(result.data.appState.viewBackgroundColor).toBe('#ffffff')
  })

  it('throws on missing frontmatter', () => {
    expect(() => parseExcalidrawMd('no frontmatter here')).toThrow()
  })

  it('throws on missing %% block', () => {
    const broken = `---\nexcalidraw-plugin: parsed\n---\nno drawing block`
    expect(() => parseExcalidrawMd(broken)).toThrow()
  })
})

describe('parseExcalidrawMd — compressed mode', () => {
  it('decompresses and extracts data', () => {
    const compressed = LZString.compressToBase64(JSON.stringify(SAMPLE_DATA))
    const file = `---
excalidraw-plugin: compressed
tags: [excalidraw]
---
==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this panel. ⚠==

# Text Elements

%%
# Drawing
\`\`\`compressed-json
${compressed}
\`\`\`
%%
`
    const result = parseExcalidrawMd(file)
    expect(result.mode).toBe('compressed')
    expect(result.data.type).toBe('excalidraw')
    expect(result.data.elements).toEqual([])
  })
})

describe('serializeExcalidrawMd', () => {
  it('roundtrip: parsed mode', () => {
    const serialized = serializeExcalidrawMd(SAMPLE_DATA, 'parsed')
    const reparsed = parseExcalidrawMd(serialized)
    expect(reparsed.mode).toBe('parsed')
    expect(reparsed.data).toEqual(SAMPLE_DATA)
  })

  it('roundtrip: compressed mode', () => {
    const serialized = serializeExcalidrawMd(SAMPLE_DATA, 'compressed')
    const reparsed = parseExcalidrawMd(serialized)
    expect(reparsed.mode).toBe('compressed')
    expect(reparsed.data).toEqual(SAMPLE_DATA)
  })

  it('writes text elements from data', () => {
    const dataWithText: ExcalidrawData = {
      ...SAMPLE_DATA,
      elements: [
        { id: 'abc123', type: 'text', text: 'Hello world', x: 0, y: 0 },
        { id: 'def456', type: 'rectangle', x: 0, y: 0 },
      ],
    }
    const serialized = serializeExcalidrawMd(dataWithText, 'parsed')
    expect(serialized).toContain('abc123:: Hello world')
    expect(serialized).not.toContain('def456::')
  })

  it('uses compressed-json block for compressed mode', () => {
    const serialized = serializeExcalidrawMd(SAMPLE_DATA, 'compressed')
    expect(serialized).toContain('```compressed-json')
    expect(serialized).toContain('excalidraw-plugin: compressed')
  })
})

describe('EMPTY_EXCALIDRAW_MD', () => {
  it('is valid and parses as parsed mode', () => {
    const result = parseExcalidrawMd(EMPTY_EXCALIDRAW_MD)
    expect(result.mode).toBe('parsed')
    expect(result.data.elements).toEqual([])
  })
})
