import type { HtmlBox, HtmlColor, HtmlGradient, HtmlTextStyle } from '../types'

export interface ThemeTextCaptureContext {
  root: HTMLElement
  parent: HTMLElement
  text: string
  box: HtmlBox
  style: HtmlTextStyle
  slideId?: string
  precision: number
  rect: (element: HTMLElement) => HtmlBox
  measureReplacementBox: (element: HTMLElement, text: string) => HtmlBox
}

export interface ThemeTextCaptureAdjustment {
  text?: string
  box?: HtmlBox
  align?: HtmlTextStyle['align']
  verticalAlign?: 'top' | 'middle' | 'bottom'
}

export interface ThemeHighlightMatchContext {
  root: HTMLElement
  element: HTMLElement
  gradient: HtmlGradient
}

export interface ThemeHighlightCaptureContext extends ThemeHighlightMatchContext {
  box: HtmlBox
  precision: number
}

export interface ThemeHighlightCaptureResult {
  box: HtmlBox
  fill: HtmlColor
  radiusPx?: number
}

export interface ThemeBackgroundCaptureContext {
  root: HTMLElement
  element: HTMLElement
  box: HtmlBox
  precision: number
}

export interface ThemeGroupedCaptureContext {
  root: HTMLElement
  element: HTMLElement
  rootScaleX: number
  rootScaleY: number
}

export interface ThemeGroupedCaptureAdjustment {
  width?: number
  height?: number
  style?: Record<string, string>
}

/** Optional component-level corrections applied after generic DOM and CSS capture. */
export interface SlidevCaptureTheme {
  name: string
  matches: (root: HTMLElement) => boolean
  adjustText?: (
    context: ThemeTextCaptureContext,
  ) => ThemeTextCaptureAdjustment | undefined
  isTextHighlight?: (context: ThemeHighlightMatchContext) => boolean
  captureTextHighlight?: (
    context: ThemeHighlightCaptureContext,
  ) => ThemeHighlightCaptureResult
  adjustBackgroundBox?: (
    context: ThemeBackgroundCaptureContext,
  ) => HtmlBox | undefined
  captureAsGroup?: (context: ThemeGroupedCaptureContext) => boolean
  adjustGroupedCapture?: (
    context: ThemeGroupedCaptureContext,
  ) => ThemeGroupedCaptureAdjustment | undefined
}

export type SlidevCaptureThemeOption =
  'auto' | 'none' | 'academy' | 'landing' | SlidevCaptureTheme
