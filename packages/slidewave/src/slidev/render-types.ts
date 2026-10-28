import type { DiagramLayoutInput as NativeDiagramDocument } from '../primitives/diagram-layout.js'
import type { Layout, Size } from '../types.js'
import type { HtmlConversionWarning, HtmlObjectRenderReport } from '../snapshot-types.js'

export interface HtmlRenderOptions {
  textGeometry?: 'preserve' | 'expand-measured'
  diagramReplacements?: ReadonlyMap<string, NativeDiagramDocument>
  fontMap?: Record<string, string>
  fallbackFont?: string
  minFontSize?: number
  precision?: number
}

export interface HtmlDeckRenderOptions extends HtmlRenderOptions {
  slideDiagramReplacements?: ReadonlyMap<string, ReadonlyMap<string, NativeDiagramDocument>>
  layout?: Layout | Size
  title?: string
  author?: string
  notes?: readonly string[]
  master?: boolean
  themeFont?: string
}

export interface HtmlRenderResult {
  warnings: HtmlConversionWarning[]
  objects: HtmlObjectRenderReport[]
  elementCount: number
}
