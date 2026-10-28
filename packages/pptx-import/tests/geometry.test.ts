import { describe, expect, it } from 'vitest'
import { resolveObjectGeometry } from '../src/geometry.js'
import type { SourceObject } from '../src/objects.js'

function shape(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  attributes: Record<string, string> = {},
): SourceObject {
  return {
    part: 'layout.xml',
    shapeId: id,
    kind: 'sp',
    order: 0,
    sourceXml: '',
    provenance: 'extracted',
    transform: {
      units: 'emu',
      attributes,
      offset: { x: String(x), y: String(y) },
      extent: { cx: String(width), cy: String(height) },
    },
  }
}
function group(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  childX: number,
  childY: number,
  childWidth: number,
  childHeight: number,
) {
  const result = shape(id, x, y, width, height)
  result.kind = 'grpSp'
  result.transform!.childOffset = { x: String(childX), y: String(childY) }
  result.transform!.childExtent = {
    cx: String(childWidth),
    cy: String(childHeight),
  }
  return result
}

describe('source group matrices', () => {
  it('composes nested nonuniform scale and nonzero child origins', () => {
    const outer = group('outer', 100, 200, 1000, 2000, 10, 20, 100, 200)
    const inner = group('inner', 20, 40, 40, 80, 5, 10, 20, 20)
    inner.parentShapeId = 'outer'
    const child = shape('child', 10, 15, 5, 10)
    child.parentShapeId = 'inner'
    expect(resolveObjectGeometry(child, [outer, inner, child])).toMatchObject({
      status: 'resolved',
      axisAligned: true,
      matrix: [100, 0, 0, 400, 300, 600],
      bounds: { x: 300, y: 600, width: 100, height: 400 },
      chain: [{ shapeId: 'inner' }, { shapeId: 'outer' }],
    })
  })

  it('keeps rotated and flipped corners distinct from their enclosing rectangle', () => {
    const rotated = shape('rotated', 0, 0, 100, 50, { rot: '5400000' })
    const result = resolveObjectGeometry(rotated, [rotated])
    expect(result.status).toBe('resolved')
    expect(result.axisAligned).toBe(false)
    expect(result.corners?.[0]?.x).toBeCloseTo(75)
    expect(result.corners?.[0]?.y).toBeCloseTo(-25)
    expect(result.bounds?.width).toBeCloseTo(50)
    const flipped = shape('flipped', 10, 20, 100, 50, { flipH: 'true' })
    expect(resolveObjectGeometry(flipped, [flipped])).toMatchObject({
      axisAligned: false,
      corners: [
        { x: 110, y: 20 },
        { x: 10, y: 20 },
        { x: 10, y: 70 },
        { x: 110, y: 70 },
      ],
    })
    const plain = shape('plain', 10, 20, 100, 50, {
      flipH: '0',
      flipV: 'false',
    })
    expect(resolveObjectGeometry(plain, [plain])).toMatchObject({
      axisAligned: true,
      bounds: { x: 10, y: 20, width: 100, height: 50 },
    })
  })

  it('rejects missing, ambiguous, cyclic and singular group coordinates', () => {
    const child = shape('child', 0, 0, 100, 100)
    child.parentShapeId = 'parent'
    expect(resolveObjectGeometry(child, [child]).status).toBe('unresolved')
    const parent = group('parent', 0, 0, 100, 100, 0, 0, 100, 100)
    expect(
      resolveObjectGeometry(child, [child, parent, { ...parent }]).status,
    ).toBe('unresolved')
    parent.parentShapeId = 'parent'
    expect(
      resolveObjectGeometry(child, [child, parent]).issues.join(),
    ).toContain('Cyclic')
    delete parent.parentShapeId
    parent.transform!.childExtent!.cx = '0'
    expect(resolveObjectGeometry(child, [child, parent]).status).toBe(
      'unresolved',
    )
    expect(
      resolveObjectGeometry(
        shape('bad', 0, 0, 100, 100, { flipH: 'invalid' }),
        [],
      ).status,
    ).toBe('unresolved')
  })
})
