import {
  measureNaturalWidth,
  prepareWithSegments,
} from '@chenglou/pretext'

import { unionBoxes } from './geometry.js'

import type { HtmlBox } from './types.js'

export interface TextGraphemeRange {
  start: number
  end: number
  text: string
}

export interface TextLineFragment {
  text: string
  box: HtmlBox
  advancePx: number
  graphemeCount: number
}

export function textGraphemeRanges(text: string): TextGraphemeRange[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  return [...segmenter.segment(text)].map((segment) => ({
    start: segment.index,
    end: segment.index + segment.segment.length,
    text: segment.segment,
  }))
}

export function canvasFont(style: CSSStyleDeclaration): string {
  const stretch =
    style.fontStretch && style.fontStretch !== 'normal'
      ? `${style.fontStretch} `
      : ''
  return `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${stretch}${style.fontSize} ${style.fontFamily}`
}

export function measureTextAdvance(
  text: string,
  style: CSSStyleDeclaration,
): number {
  if (!text) return 0
  const letterSpacing = Number.parseFloat(style.letterSpacing)
  const font = canvasFont(style)
  try {
    const prepared = prepareWithSegments(text, font, {
      whiteSpace: pretextWhiteSpace(style.whiteSpace),
      wordBreak: style.wordBreak === 'keep-all' ? 'keep-all' : 'normal',
      ...(Number.isFinite(letterSpacing) && letterSpacing !== 0
        ? { letterSpacing }
        : {}),
    })
    return measureNaturalWidth(prepared)
  } catch {
    const context = document.createElement('canvas').getContext('2d')
    if (!context) return 0
    context.font = font
    const graphemeCount = textGraphemeRanges(text).length
    return (
      context.measureText(text).width +
      Math.max(0, graphemeCount - 1) *
        (Number.isFinite(letterSpacing) ? letterSpacing : 0)
    )
  }
}

export function fontSafeLineBox(
  box: HtmlBox,
  lineHeightPx: number,
  precision = 4,
): HtmlBox {
  if (box.height >= lineHeightPx) return box
  const extraHeight = lineHeightPx - box.height
  const factor = 10 ** precision
  return {
    x: box.x,
    y: Math.round((box.y - extraHeight / 2) * factor) / factor,
    width: box.width,
    height: Math.round(lineHeightPx * factor) / factor,
  }
}

export function mergeTextGrapheme(
  fragments: TextLineFragment[],
  grapheme: string,
  box: HtmlBox,
  advancePx: number,
  precision = 4,
): void {
  const previous = fragments.at(-1)
  if (previous && sameRenderedLine(previous.box, box)) {
    previous.text += grapheme
    previous.box = unionBoxes(previous.box, box, precision)
    previous.advancePx += advancePx
    previous.graphemeCount += 1
    return
  }
  fragments.push({
    text: grapheme,
    box,
    advancePx,
    graphemeCount: 1,
  })
}

function pretextWhiteSpace(
  value: string,
): 'normal' | 'pre-wrap' {
  return value === 'pre' || value === 'pre-wrap' || value === 'break-spaces'
    ? 'pre-wrap'
    : 'normal'
}

function sameRenderedLine(first: HtmlBox, second: HtmlBox): boolean {
  const firstCenter = first.y + first.height / 2
  const secondCenter = second.y + second.height / 2
  const firstRight = first.x + first.width
  const secondRight = second.x + second.width
  const horizontalGap = Math.max(
    0,
    Math.max(first.x, second.x) - Math.min(firstRight, secondRight),
  )
  return (
    Math.abs(firstCenter - secondCenter) <=
      Math.max(1, Math.min(first.height, second.height) * 0.3) &&
    horizontalGap <= Math.max(2, Math.min(first.height, second.height) * 0.5)
  )
}
