export const HTML_SNAPSHOT_VERSION = 1 as const

export interface HtmlBox {
  x: number
  y: number
  width: number
  height: number
}

export interface HtmlColor {
  hex: string
  alpha: number
}

export interface HtmlGradient {
  angle: number
  stops: Array<{ offset: number; color: HtmlColor }>
}

export type HtmlWarningCode =
  | 'image-embed-failed'
  | 'unsupported-background-image'
  | 'unsupported-backdrop-filter'
  | 'unsupported-clip-path'
  | 'unsupported-mask'
  | 'unsupported-media'
  | 'unsupported-transform'
  | 'unsupported-border-style'
  | 'unresolved-font'
  | 'invalid-snapshot'

export interface HtmlConversionWarning {
  code: HtmlWarningCode
  message: string
  elementId?: string
}

export interface HtmlElementSource {
  tag: string
  path: string
  className?: string
  pseudo?: 'before' | 'after'
}

interface HtmlElementBase {
  id: string
  box: HtmlBox
  order: number
  zIndex: number
  opacity: number
  source: HtmlElementSource
}

export type HtmlShapeKind = 'rect' | 'roundRect' | 'ellipse' | 'chevron'

export interface HtmlShapeElement extends HtmlElementBase {
  kind: 'shape'
  shape: HtmlShapeKind
  preciseRadius?: boolean
  fill?: HtmlColor
  gradient?: HtmlGradient
  stroke?: {
    color: HtmlColor
    widthPx: number
    dash?: 'solid' | 'dash' | 'dot'
  }
  radiusPx?: number
  rotation?: number
  shadow?: {
    color: HtmlColor
    blurPx: number
    offsetPx: number
    angle: number
  }
}

export interface HtmlLineElement extends HtmlElementBase {
  kind: 'line'
  x2: number
  y2: number
  color: HtmlColor
  widthPx: number
  dash?: 'solid' | 'dash' | 'dot'
}

export interface HtmlTextStyle {
  fontFamily: string
  fontSizePx: number
  fontWeight: number
  fontStyle: 'normal' | 'italic'
  lineHeightPx: number
  letterSpacingPx: number
  color: HtmlColor
  align: 'left' | 'center' | 'right' | 'justify'
  decoration: Array<'underline' | 'line-through'>
  direction: 'ltr' | 'rtl'
  language?: string
}

export interface HtmlTextElement extends HtmlElementBase {
  kind: 'text'
  text: string
  style: HtmlTextStyle
  metrics?: {
    advancePx: number
    graphemeCount: number
  }
  verticalAlign?: 'top' | 'middle' | 'bottom'
  rotation?: number
  hyperlink?: string
}

export interface HtmlImageElement extends HtmlElementBase {
  kind: 'image'
  data?: string
  path?: string
  alt?: string
  rotation?: number
}

export type HtmlSlideElement =
  HtmlShapeElement | HtmlLineElement | HtmlTextElement | HtmlImageElement

export interface HtmlSlideSnapshot {
  version: typeof HTML_SNAPSHOT_VERSION
  id: string
  width: number
  height: number
  elements: HtmlSlideElement[]
  warnings: HtmlConversionWarning[]
}

export interface HtmlDeckSnapshot {
  version: typeof HTML_SNAPSHOT_VERSION
  source: 'slidev' | 'html'
  slides: HtmlSlideSnapshot[]
  warnings: HtmlConversionWarning[]
}
