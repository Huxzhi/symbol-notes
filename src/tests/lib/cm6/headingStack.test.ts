import { describe, it, expect } from 'vitest'
import { pushHeading, headingPathOf, type HeadingFrame } from '../../../lib/cm6/headingStack'

describe('headingStack', () => {
  it('逐级压栈得到路径', () => {
    const s: HeadingFrame[] = []
    pushHeading(s, 1, '实验记录')
    pushHeading(s, 2, '计划')
    expect(headingPathOf(s)).toEqual(['实验记录', '计划'])
  })
  it('同级标题替换而非叠加', () => {
    const s: HeadingFrame[] = []
    pushHeading(s, 2, '计划')
    pushHeading(s, 2, '反思')
    expect(headingPathOf(s)).toEqual(['反思'])
  })
  it('更高层级弹出更深层级', () => {
    const s: HeadingFrame[] = []
    pushHeading(s, 1, 'A')
    pushHeading(s, 2, 'B')
    pushHeading(s, 1, 'C')
    expect(headingPathOf(s)).toEqual(['C'])
  })
})
