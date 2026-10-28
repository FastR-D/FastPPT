import { describe, expect, it } from 'vitest'
import { clipImageBox } from '../../src/slidev/image-clipping.js'

describe('image overflow clipping', () => {
  it('keeps the original image frame when ancestors do not clip it', () => {
    const box = { x: 40, y: 80, width: 760, height: 570 }
    expect(clipImageBox(box, [])).toEqual({ box })
  })

  it('preserves the visible frame and source crop of a negatively positioned image', () => {
    const result = clipImageBox(
      { x: 40, y: 54, width: 760, height: 570 },
      [{ box: { x: 40, y: 160, width: 760, height: 464 }, x: true, y: true }],
    )!
    expect(result.box).toEqual({ x: 40, y: 160, width: 760, height: 464 })
    expect(result.crop?.top).toBeCloseTo(106 / 570)
    expect(result.crop?.bottom).toBe(0)
  })

  it('intersects nested clips per axis without repeatedly stretching the source', () => {
    const result = clipImageBox(
      { x: 0, y: 0, width: 200, height: 100 },
      [
        { box: { x: 20, y: 80, width: 180, height: 10 }, x: true, y: false },
        { box: { x: 0, y: 10, width: 160, height: 70 }, x: true, y: true },
      ],
    )!
    expect(result.box).toEqual({ x: 20, y: 10, width: 140, height: 70 })
    expect(result.crop).toEqual({ left: 0.1, top: 0.1, right: 0.2, bottom: 0.2 })
  })

  it('omits images entirely outside a clipping ancestor', () => {
    expect(clipImageBox(
      { x: 220, y: 0, width: 100, height: 100 },
      [{ box: { x: 0, y: 0, width: 200, height: 200 }, x: true, y: true }],
    )).toBeUndefined()
  })
})
