import { describe, expect, it } from 'vitest'

import {
  canvasFont,
  fontSafeLineBox,
  mergeTextGrapheme,
  textGraphemeRanges,
} from '../../src/slidev/text-layout'

describe('Pretext-backed Slidev text layout', () => {
  it('segments combining marks and ZWJ emoji as complete graphemes', () => {
    expect(textGraphemeRanges('e\u0301 👨‍👩‍👧‍👦 中文').map((item) => item.text)).toEqual([
      'e\u0301',
      ' ',
      '👨‍👩‍👧‍👦',
      ' ',
      '中',
      '文',
    ])
  })

  it('builds a complete canvas font shorthand from computed styles', () => {
    const style = {
      fontFamily: '"Source Han Sans SC", sans-serif',
      fontSize: '18px',
      fontStretch: 'normal',
      fontStyle: 'italic',
      fontVariant: 'normal',
      fontWeight: '700',
    } as CSSStyleDeclaration
    expect(canvasFont(style)).toBe(
      'italic normal 700 18px "Source Han Sans SC", sans-serif',
    )
  })

  it('merges graphemes by rendered line while preserving grapheme counts', () => {
    const fragments: Parameters<typeof mergeTextGrapheme>[0] = []
    mergeTextGrapheme(
      fragments,
      '春',
      { x: 10, y: 20, width: 14, height: 18 },
      14,
    )
    mergeTextGrapheme(
      fragments,
      '天',
      { x: 24, y: 20.2, width: 14, height: 18 },
      14,
    )
    mergeTextGrapheme(
      fragments,
      '到',
      { x: 10, y: 42, width: 14, height: 18 },
      14,
    )

    expect(fragments).toEqual([
      {
        text: '春天',
        box: { x: 10, y: 20, width: 28, height: 18.2 },
        advancePx: 28,
        graphemeCount: 2,
      },
      {
        text: '到',
        box: { x: 10, y: 42, width: 14, height: 18 },
        advancePx: 14,
        graphemeCount: 1,
      },
    ])
  })

  it('keeps same-height text in separate CSS columns', () => {
    const fragments: Parameters<typeof mergeTextGrapheme>[0] = []
    mergeTextGrapheme(
      fragments,
      '左',
      { x: 10, y: 20, width: 14, height: 18 },
      14,
    )
    mergeTextGrapheme(
      fragments,
      '右',
      { x: 210, y: 20, width: 14, height: 18 },
      14,
    )
    expect(fragments.map((fragment) => fragment.text)).toEqual(['左', '右'])
  })

  it('expands glyph bounds symmetrically to a font-safe line box', () => {
    expect(
      fontSafeLineBox({ x: 20, y: 30, width: 80, height: 15 }, 22),
    ).toEqual({ x: 20, y: 26.5, width: 80, height: 22 })
  })
})
