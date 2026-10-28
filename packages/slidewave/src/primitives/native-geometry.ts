import { z } from 'zod'

const coordinate = z.number().finite().min(-10000).max(10000)
export const NativePathsSchema = z.object({
  paths: z.array(z.object({
    points: z.array(z.tuple([coordinate, coordinate])).min(2).max(4096),
    closed: z.boolean(),
  }).strict()).min(1).max(128),
  fillRule: z.enum(['nonzero', 'evenodd']),
}).strict().refine(value => value.paths.reduce((sum, path) => sum + path.points.length, 0) <= 32768, 'Geometry has too many points')

export interface NativePaths { paths: Array<{points: Array<[number,number]>;closed:boolean}>;fillRule:'nonzero'|'evenodd' }
export interface NativeGeometry extends NativePaths {
  version: 1; fill: string; stroke: string; strokeWidthRatio: number
  fillOpacity?: number; strokeOpacity?: number
}
export const NativeGeometrySchema = z.object({
  version: z.literal(1),
  paths: NativePathsSchema.shape.paths,
  fillRule: NativePathsSchema.shape.fillRule,
  fill: z.string().max(100), stroke: z.string().max(100),
  strokeWidthRatio: z.number().finite().min(0).max(10),
  fillOpacity: z.number().min(0).max(1).optional(),
  strokeOpacity: z.number().min(0).max(1).optional(),
}).strict().refine(value => value.paths.reduce((sum, path) => sum + path.points.length, 0) <= 32768, 'Geometry has too many points')

export function parseNativeGeometry(value: string): NativeGeometry {
  if (value.length > 2_000_000) throw new Error('Native geometry metadata is too large')
  return NativeGeometrySchema.parse(JSON.parse(value)) as NativeGeometry
}
