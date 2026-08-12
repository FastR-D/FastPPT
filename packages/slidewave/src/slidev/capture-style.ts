import { cssDash, cssPixels, multiplyAlpha, parseCssColor } from './css'
import { averageScale, type TransformMetrics } from './transform'
import type { HtmlBox, HtmlShapeElement, HtmlShapeKind } from './types'

export function hasVisibleBackdropFilter(style: CSSStyleDeclaration): boolean {
  const webkit = style.getPropertyValue('-webkit-backdrop-filter')
  return (
    (style.backdropFilter && style.backdropFilter !== 'none') ||
    Boolean(webkit && webkit !== 'none')
  )
}

export function captureUniformBorder(
  style: CSSStyleDeclaration,
  opacity: number,
  transform: TransformMetrics,
): HtmlShapeElement['stroke'] | undefined {
  const values = [
    [style.borderTopWidth, style.borderTopStyle, style.borderTopColor],
    [style.borderRightWidth, style.borderRightStyle, style.borderRightColor],
    [style.borderBottomWidth, style.borderBottomStyle, style.borderBottomColor],
    [style.borderLeftWidth, style.borderLeftStyle, style.borderLeftColor],
  ] as const
  const [firstWidth, firstStyle, firstColor] = values[0]
  if (
    !values.every(
      ([width, borderStyle, color]) =>
        width === firstWidth &&
        borderStyle === firstStyle &&
        color === firstColor,
    )
  )
    return undefined

  const widthPx = cssPixels(firstWidth) * averageScale(transform)
  const color = parseCssColor(firstColor)
  if (widthPx <= 0 || firstStyle === 'none' || !color || color.alpha <= 0)
    return undefined
  return {
    color: multiplyAlpha(color, opacity),
    widthPx,
    dash: cssDash(firstStyle),
  }
}

export function recognizeShape(
  style: CSSStyleDeclaration,
  box: HtmlBox,
): HtmlShapeKind {
  if (/polygon\(\s*0(?:%|px)?\s+0(?:%|px)?\s*,\s*95%/i.test(style.clipPath))
    return 'chevron'
  const radius = cssPixels(style.borderTopLeftRadius)
  if (
    Math.abs(box.width - box.height) < 1 &&
    radius >= Math.min(box.width, box.height) * 0.45
  )
    return 'ellipse'
  return radius > 0 ? 'roundRect' : 'rect'
}

export function parseBoxShadow(
  value: string,
  opacity: number,
  transform: TransformMetrics,
): HtmlShapeElement['shadow'] | undefined {
  if (!value || value === 'none') return undefined
  for (const layer of splitCssLayers(value)) {
    if (layer.includes('inset')) continue
    const colorMatch = layer.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}/i)?.[0]
    const color = parseCssColor(colorMatch)
    const lengths =
      layer
        .replace(colorMatch ?? '', '')
        .match(/-?[\d.]+px/g)
        ?.map(cssPixels) ?? []
    if (!color || color.alpha <= 0 || lengths.length < 2) continue
    const offsetX = lengths[0]!
    const offsetY = lengths[1]!
    const blur = lengths[2] ?? 0
    return {
      color: multiplyAlpha(color, opacity),
      blurPx: blur * averageScale(transform),
      offsetPx: Math.hypot(offsetX, offsetY) * averageScale(transform),
      angle: ((Math.atan2(offsetY, offsetX) * 180) / Math.PI + 360) % 360,
    }
  }
  return undefined
}

function splitCssLayers(value: string): string[] {
  const layers: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '(') depth++
    else if (value[index] === ')') depth--
    else if (value[index] === ',' && depth === 0) {
      layers.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  layers.push(value.slice(start).trim())
  return layers.filter(Boolean)
}
