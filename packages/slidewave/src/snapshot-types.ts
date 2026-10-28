import type { NativePaths } from './primitives/native-geometry.js'
import type { TextBullet, TextBulletFont, TextBulletColor } from './primitives/text-bullet.js'
import type { DecimalTab } from './primitives/text-tabs.mjs'
import type { TextTabLayout } from './primitives/text-tab-layout.js'

export const HTML_SNAPSHOT_VERSION = 1 as const
/** V1 stays available for older capture hosts. Structured objects require V2. */
export const HTML_SNAPSHOT_VERSIONS = [1, 2] as const
export type HtmlSnapshotVersion = (typeof HTML_SNAPSHOT_VERSIONS)[number]
export type HtmlRepresentation = 'native-table' | 'native-shapes' | 'native-text' | 'image'

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
  | 'unembedded-font'
  | 'font-subset-failed'
  | 'invalid-snapshot'
  | 'numbering-compatibility'
  | 'text-tab-compatibility'
  | 'text-letter-spacing-compatibility'
  | 'text-capitalization-compatibility'
  | 'text-kerning-compatibility'
  | 'text-baseline-compatibility'
  | 'text-bullet-compatibility'
  | 'unsupported-table'

export interface HtmlConversionWarning {
  code: HtmlWarningCode
  message: string
  elementId?: string
}

export interface HtmlElementSource {
  tag: string
  path: string
  className?: string
  /** Stable animation target emitted by the presentation compiler. */
  anchor?: string
  nativeLayoutObject?: { layout: string; name: string; scope?: 'layout' | 'master' }
  role?: 'slide-background'
  pseudo?: 'before' | 'after'
}

interface HtmlElementBase {
  id: string
  box: HtmlBox
  order: number
  zIndex: number
  opacity: number
  source: HtmlElementSource
  /** Retained on fallback fragments so native shapes cannot hide semantic loss. */
  structure?: { kind: 'table'; ownerId: string; requiredRepresentation: 'native-table' }
}

export type HtmlShapeKind = 'rect' | 'roundRect' | 'ellipse' | 'chevron' | 'freeform'

export interface HtmlShapeElement extends HtmlElementBase {
  kind: 'shape'
  shape: HtmlShapeKind
  geometry?: NativePaths
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
  /** Display mode; text remains the original editable string. */
  capitalization?: 'none' | 'all' | 'small' | undefined
  fontFamily: string
  /** Explicit script faces measured from a generated source-layout text run. */
  fontFamilies?: { latin?: string | undefined; ea?: string | undefined; cs?: string | undefined } | undefined
  fontSizePx: number
  fontWeight: number
  fontStyle: 'normal' | 'italic'
  lineHeightPx: number
  letterSpacingPx: number
  /** Source baseline shift as a percentage of the declared font size. */
  kerningThresholdPx?: number | undefined
  baselinePercent?: number
  color: HtmlColor
  align: 'left' | 'center' | 'right' | 'justify'
  decoration: Array<'underline' | 'line-through'>
  direction: 'ltr' | 'rtl'
  language?: string
  alternativeLanguage?: string
}

export interface HtmlTextElement extends HtmlElementBase {
  kind: 'text'
  text: string
  style: HtmlTextStyle
  /** One-based paragraph level from an explicit source-layout text block. */
  paragraphLevel?: number | undefined
  /** Explicit text frame; paragraph breaks and soft line breaks stay distinct. */
  paragraphs?: HtmlTextParagraph[] | undefined
  /** Measured source placeholder frame; insets are canvas pixels. */
  textFrame?: { insetsPx: { left: number; right: number; top: number; bottom: number }; wrap: boolean } | undefined
  metrics?: {
    advancePx: number
    graphemeCount: number
  }
  verticalAlign?: 'top' | 'middle' | 'bottom'
  rotation?: number
  hyperlink?: string
}

export interface HtmlTextParagraph {
  tabLayout?: TextTabLayout | undefined
  decimalTab?: DecimalTab | null | undefined
  defaultTabSizePx?: number | undefined
  tabStopsPx?: Array<{ position: number; align: 'left' | 'center' | 'right' | 'decimal' }> | undefined
  /** Local restart intent, separate from the reusable template starting value. */
  numberingRestart?: number | undefined
  bullet?: TextBullet | undefined
  bulletFont?: TextBulletFont | undefined
  bulletColor?: TextBulletColor | undefined
  bulletSize?: { kind: 'text' } | { kind: 'pixels'; value: number } | { kind: 'percent'; value: number } | undefined
  level: number
  style: HtmlTextStyle
  marginLeftPx: number
  marginRightPx: number
  indentPx: number
  spaceBeforePx: number
  spaceAfterPx: number
  runs: Array<{ text: string; style: HtmlTextStyle; hyperlink?: string | undefined }>
}

export interface HtmlImageElement extends HtmlElementBase {
  kind: 'image'
  data?: string
  path?: string
  /** Original image URL retained for provenance and selective export replacement. */
  assetKey?: string
  alt?: string
  rotation?: number
  /** Fractions removed from each edge of the original rendered image. */
  crop?: { left: number; top: number; right: number; bottom: number }
}

/** N1a rectangular grid. Merged cells are explicitly deferred to N1b. */
export interface HtmlTableElement extends HtmlElementBase {
  kind: 'table'
  columnWidthsPx: number[]
  rowHeightsPx: number[]
  cells: HtmlTableCell[]
}

export interface HtmlTableCell {
  id: string
  row: number
  column: number
  header: boolean
  text: string
  style: HtmlTextStyle
  runs: Array<{ text: string; style: HtmlTextStyle; hyperlink?: string }>
  fill?: HtmlColor
  /** Clockwise from top. Transparent/zero-width sides are explicit. */
  borders: Array<{ color: HtmlColor; widthPx: number }>
  insetsPx: { top: number; right: number; bottom: number; left: number }
  verticalAlign: 'top' | 'middle' | 'bottom'
}

export type HtmlSlideElement =
  HtmlShapeElement | HtmlLineElement | HtmlTextElement | HtmlImageElement | HtmlTableElement

export interface HtmlSlideSnapshot {
  version: HtmlSnapshotVersion
  id: string
  width: number
  height: number
  elements: HtmlSlideElement[]
  warnings: HtmlConversionWarning[]
}

export interface HtmlDeckSnapshot {
  version: HtmlSnapshotVersion
  source: 'slidev' | 'html'
  slides: HtmlSlideSnapshot[]
  warnings: HtmlConversionWarning[]
}

/** Evidence from operations actually emitted for a captured source object. */
export interface HtmlObjectRenderReport {
  slideId: string
  elementId: string
  source: HtmlElementSource
  kind: HtmlSlideElement['kind']
  nativeCount: number
  imageCount: number
  imageKinds?: { vector: number; raster: number; unknown: number }
  status: 'native' | 'image' | 'mixed' | 'missing'
  editableRequired: boolean
  semanticKind?: 'table'
  requiredRepresentation?: 'native-table'
  representation?: HtmlRepresentation
  semanticPreserved?: boolean
  structureOwnerId?: string
  childIds?: string[]
  /** Object name survives serialization and is resolved against the actual package. */
  pptxObjectName?: string
  verification?: { structure: 'passed' | 'unverified'; visual: 'unverified'; application: 'unverified' }
  /** CSS requests versus emitted DrawingML faces; does not prove browser glyph selection. */
  fonts?: { requested: string[]; emitted: string[]; substituted: boolean }
  layoutRepair?: { source: HtmlBox; proposed: HtmlBox; applied: boolean }
  reasons: string[]
}
