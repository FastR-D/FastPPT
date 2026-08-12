export type ImageFit = 'cover' | 'contain' | 'fill' | 'none' | 'scale-down'
export type SizeRange = number | [number, number]
export type RatioRange = number | [number, number]
export type DecorSize = {
  cols?: SizeRange
  rows?: SizeRange
  ratio?: RatioRange
  aspectRatio?: RatioRange
}
export type DecorImage = {
  fit?: ImageFit
  position?: string
  anchor?: string
  x?: number | string
  y?: number | string
  zoom?: number | string
  rotate?: number | string
  color?: string
  opacity?: number | string
  backgroundColor?: string
}
export type DecorVariant = {
  id: string
  src: string
  cols?: SizeRange
  rows?: SizeRange
  ratio?: RatioRange
  aspectRatio?: RatioRange
  meaning?: string
  tone?: string
  sizes?: DecorSize[]
  meanings?: string[]
  tones?: string[]
  tags?: string[]
  image?: DecorImage
}
export type DecorStore = {
  save(overrides: readonly DecorVariant[]): Promise<{ ok: true, count: number }>
}
