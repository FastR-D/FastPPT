import { describe, expect, it } from 'vitest'

import {
  boxesShareLine,
  centeredTextBox,
  normalizeDomRect,
  unionBoxes,
} from '../../src/slidev/geometry'

describe('Slidev capture geometry', () => {
  it('normalizes transformed browser rectangles into intrinsic slide pixels', () => {
    expect(normalizeDomRect(
      { left: 120, top: 70, width: 200, height: 100 },
      {
        rootRect: { left: 20, top: 20 },
        rootScaleX: 2,
        rootScaleY: 2,
        precision: 4,
      },
    )).toEqual({ x: 50, y: 25, width: 100, height: 50 })
  })

  it('centers a font-safe text box and applies an explicit optical offset', () => {
    expect(centeredTextBox(
      { x: 100, y: 430, width: 200, height: 26 },
      { x: 100, y: 435, width: 200, height: 16 },
      { x: 90, y: 428, width: 220, height: 30 },
      { fontSizePx: 18, lineHeightPx: 16 },
      1.5,
    )).toEqual({ x: 100, y: 433.25, width: 200, height: 22.5 })
  })

  it('groups adjacent glyph boxes on one line without merging separate lines', () => {
    const first = { x: 10, y: 20, width: 8, height: 16 }
    const adjacent = { x: 18, y: 20.2, width: 7, height: 16 }
    const nextLine = { x: 10, y: 40, width: 7, height: 16 }

    expect(boxesShareLine(first, adjacent)).toBe(true)
    expect(boxesShareLine(first, nextLine)).toBe(false)
    expect(unionBoxes(first, adjacent)).toEqual({ x: 10, y: 20, width: 15, height: 16.2 })
  })
})
