import type { Layout } from '../types.js'
import type { HtmlConversionWarning } from '../snapshot-types.js'

export interface HtmlRenderOptions {
  fontMap?: Record<string, string>
  fallbackFont?: string
  minFontSize?: number
  precision?: number
}

export interface HtmlDeckRenderOptions extends HtmlRenderOptions {
  layout?: Layout
  title?: string
  author?: string
}

export interface HtmlRenderResult {
  warnings: HtmlConversionWarning[]
  elementCount: number
}
