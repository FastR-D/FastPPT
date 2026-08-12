import type { HtmlBox, HtmlTextStyle } from './types'

export interface HtmlCoordinateSpace {
  rootRect: Pick<DOMRectReadOnly, 'left' | 'top'>
  rootScaleX: number
  rootScaleY: number
  precision: number
}

export function roundTo(value: number, precision: number): number {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

export function normalizeDomRect(
  rect: Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height'>,
  space: HtmlCoordinateSpace,
): HtmlBox {
  return {
    x: roundTo(
      (rect.left - space.rootRect.left) / space.rootScaleX,
      space.precision,
    ),
    y: roundTo(
      (rect.top - space.rootRect.top) / space.rootScaleY,
      space.precision,
    ),
    width: roundTo(rect.width / space.rootScaleX, space.precision),
    height: roundTo(rect.height / space.rootScaleY, space.precision),
  }
}

export function centeredTextBox(
  textBox: HtmlBox,
  lineBox: HtmlBox,
  containerBox: HtmlBox,
  style: Pick<HtmlTextStyle, 'fontSizePx' | 'lineHeightPx'>,
  opticalOffsetY = 0,
  precision = 4,
): HtmlBox {
  const centerY =
    lineBox.height > 0
      ? lineBox.y + lineBox.height / 2
      : containerBox.y + containerBox.height / 2
  const desiredHeight = Math.max(style.lineHeightPx, style.fontSizePx * 1.25)
  const height = Math.min(containerBox.height, desiredHeight)
  const unclampedY = centerY - height / 2 + opticalOffsetY
  const y = Math.min(
    Math.max(unclampedY, containerBox.y),
    containerBox.y + containerBox.height - height,
  )
  return {
    x: textBox.x,
    y: roundTo(y, precision),
    width: textBox.width,
    height: roundTo(height, precision),
  }
}

export function boxesShareLine(first: HtmlBox, second: HtmlBox): boolean {
  return (
    Math.abs(first.y - second.y) <=
    Math.max(0.75, Math.min(first.height, second.height) * 0.15)
  )
}

export function unionBoxes(
  first: HtmlBox,
  second: HtmlBox,
  precision = 4,
): HtmlBox {
  const left = Math.min(first.x, second.x)
  const top = Math.min(first.y, second.y)
  const right = Math.max(first.x + first.width, second.x + second.width)
  const bottom = Math.max(first.y + first.height, second.y + second.height)
  return {
    x: roundTo(left, precision),
    y: roundTo(top, precision),
    width: roundTo(right - left, precision),
    height: roundTo(bottom - top, precision),
  }
}

export function isUsefulBox(box: HtmlBox): boolean {
  return box.width > 0.01 && box.height > 0.01
}
