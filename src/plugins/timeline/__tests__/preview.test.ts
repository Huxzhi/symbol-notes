import { describe, it, expect } from 'vitest'
import { extractPreview } from '../preview'

describe('extractPreview', () => {
  it('抓第一张 markdown 图片 url 作 thumbnail', () => {
    const r = extractPreview('# 标题\n\n![alt](images/pic.png)\n正文')
    expect(r.thumbnail).toBe('images/pic.png')
  })

  it('抓 ![[embed]] 形式的嵌入图片', () => {
    const r = extractPreview('![[diagram.png]]\n正文')
    expect(r.thumbnail).toBe('diagram.png')
  })

  it('snippet = 第一段非空、非标题、非图片的正文（截断到 120 字内）', () => {
    const r = extractPreview('# 标题\n\n这是第一段正文。\n\n第二段')
    expect(r.snippet).toBe('这是第一段正文。')
  })

  it('跳过 frontmatter 与标题行', () => {
    const md = '---\ntitle: x\n---\n# 大标题\n\n真正的正文在这里'
    const r = extractPreview(md)
    expect(r.snippet).toBe('真正的正文在这里')
  })

  it('无图片 → thumbnail 为 undefined', () => {
    const r = extractPreview('纯文字笔记，没有图')
    expect(r.thumbnail).toBeUndefined()
    expect(r.snippet).toBe('纯文字笔记，没有图')
  })

  it('空内容 → 两者均 undefined', () => {
    const r = extractPreview('')
    expect(r).toEqual({})
  })

  it('超长首段截断到 120 字符并加省略号', () => {
    const long = 'x'.repeat(200)
    const r = extractPreview(long)
    expect(r.snippet!.length).toBe(121) // 120 + '…'
    expect(r.snippet!.endsWith('…')).toBe(true)
  })
})
