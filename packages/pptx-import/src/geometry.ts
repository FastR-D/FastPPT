import type { SourceObject } from './objects.js'

/** Affine transform [a,b,c,d,e,f]: x'=a*x+c*y+e, y'=b*x+d*y+f. */
export type Matrix = [number, number, number, number, number, number]
const identity: Matrix = [1, 0, 0, 1, 0, 0]
const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y]
const scale = (x: number, y: number): Matrix => [x, 0, 0, y, 0, 0]
function multiply(l: Matrix, r: Matrix): Matrix {
  return [
    l[0] * r[0] + l[2] * r[1],
    l[1] * r[0] + l[3] * r[1],
    l[0] * r[2] + l[2] * r[3],
    l[1] * r[2] + l[3] * r[3],
    l[0] * r[4] + l[2] * r[5] + l[4],
    l[1] * r[4] + l[3] * r[5] + l[5],
  ]
}
const compose = (...matrices: Matrix[]): Matrix =>
  matrices.reduce(multiply, identity)
export function sourceNumber(value: string | undefined): number | undefined {
  if (value === undefined || !/^-?\d+$/.test(value)) return undefined
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : undefined
}
function flag(value: string | undefined): boolean {
  if (value === undefined || value === '0' || value === 'false') return false
  if (value === '1' || value === 'true') return true
  throw new Error(`Invalid transform flag: ${value}`)
}
function frame(object: SourceObject) {
  const t = object.transform
  const x = sourceNumber(t?.offset?.x),
    y = sourceNumber(t?.offset?.y)
  const width = sourceNumber(t?.extent?.cx),
    height = sourceNumber(t?.extent?.cy)
  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined ||
    width <= 0 ||
    height <= 0
  )
    throw new Error('Incomplete or invalid transform geometry')
  const rotation =
    t?.attributes.rot === undefined ? 0 : sourceNumber(t.attributes.rot)
  if (rotation === undefined) throw new Error('Invalid rotation')
  const radians = ((rotation / 60000) * Math.PI) / 180
  const rotate: Matrix = [
    Math.cos(radians),
    Math.sin(radians),
    -Math.sin(radians),
    Math.cos(radians),
    0,
    0,
  ]
  const flip = scale(
    flag(t?.attributes.flipH) ? -1 : 1,
    flag(t?.attributes.flipV) ? -1 : 1,
  )
  return {
    x,
    y,
    width,
    height,
    orientation: compose(
      translate(x + width / 2, y + height / 2),
      rotate,
      flip,
      translate(-width / 2, -height / 2),
    ),
  }
}

/** Keep the full matrix and corners; an enclosing rectangle is never passed
 * off as a faithful replacement for a rotated, flipped or sheared object. */
export function resolveObjectGeometry(
  object: SourceObject,
  objects: readonly SourceObject[],
) {
  const chain: Array<{ part: string; shapeId?: string }> = []
  const seen = new Set<SourceObject>()
  const parentMatrix = (entry: SourceObject): Matrix => {
    if (!entry.parentShapeId) return identity
    if (seen.has(entry)) throw new Error('Cyclic group transform')
    seen.add(entry)
    const matches = objects.filter(
      (candidate) =>
        candidate.part === entry.part &&
        candidate.shapeId === entry.parentShapeId,
    )
    if (matches.length !== 1 || matches[0]!.kind !== 'grpSp')
      throw new Error('Missing or ambiguous group transform')
    const group = matches[0]!
    chain.push({
      part: group.part,
      ...(group.shapeId ? { shapeId: group.shapeId } : {}),
    })
    const parent = parentMatrix(group)
    const g = frame(group),
      t = group.transform!
    const x = sourceNumber(t.childOffset?.x),
      y = sourceNumber(t.childOffset?.y)
    const width = sourceNumber(t.childExtent?.cx),
      height = sourceNumber(t.childExtent?.cy)
    if (
      x === undefined ||
      y === undefined ||
      width === undefined ||
      height === undefined ||
      width <= 0 ||
      height <= 0
    )
      throw new Error('Incomplete or invalid group coordinate system')
    return compose(
      parent,
      g.orientation,
      scale(g.width / width, g.height / height),
      translate(-x, -y),
    )
  }
  const base = {
    part: object.part,
    ...(object.shapeId ? { shapeId: object.shapeId } : {}),
    units: 'emu' as const,
    provenance: 'derived' as const,
  }
  try {
    const f = frame(object)
    const matrix = compose(
      parentMatrix(object),
      f.orientation,
      scale(f.width, f.height),
    )
    const corners = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ].map(([x, y]) => ({
      x: matrix[0] * x! + matrix[2] * y! + matrix[4],
      y: matrix[1] * x! + matrix[3] * y! + matrix[5],
    }))
    if (
      !matrix.every(Number.isFinite) ||
      corners.some(
        (point) =>
          Math.abs(point.x) > Number.MAX_SAFE_INTEGER ||
          Math.abs(point.y) > Number.MAX_SAFE_INTEGER,
      )
    )
      throw new Error('Group transform exceeds numeric range')
    const bounds = {
      x: Math.min(...corners.map((p) => p.x)),
      y: Math.min(...corners.map((p) => p.y)),
      width:
        Math.max(...corners.map((p) => p.x)) -
        Math.min(...corners.map((p) => p.x)),
      height:
        Math.max(...corners.map((p) => p.y)) -
        Math.min(...corners.map((p) => p.y)),
    }
    const axisAligned =
      Math.abs(matrix[1]) < 1e-6 &&
      Math.abs(matrix[2]) < 1e-6 &&
      matrix[0] > 0 &&
      matrix[3] > 0
    return {
      ...base,
      status: 'resolved' as const,
      matrix,
      corners,
      bounds,
      axisAligned,
      chain,
      issues: [] as string[],
    }
  } catch (cause) {
    return {
      ...base,
      status: 'unresolved' as const,
      chain,
      issues: [
        `${cause instanceof Error ? cause.message : String(cause)}: ${object.part}#${object.shapeId ?? object.order}`,
      ],
    }
  }
}
