import type { HtmlShapeElement } from '../snapshot-types.js'

export function preciseRoundedRectSvgDataUrl(
  element: HtmlShapeElement,
): string {
  const width = Math.max(0.01, element.box.width)
  const height = Math.max(0.01, element.box.height)
  const strokeWidth = Math.max(0, element.stroke?.widthPx ?? 0)
  const inset = strokeWidth / 2
  const radius = Math.min(
    Math.max(0, element.radiusPx ?? 0),
    Math.max(0, (width - strokeWidth) / 2),
    Math.max(0, (height - strokeWidth) / 2),
  )
  const gradient = element.gradient
  let definitions = ''
  let fill = element.fill ? `#${element.fill.hex}` : 'none'
  let fillOpacity = element.fill?.alpha ?? 1

  if (gradient) {
    const radians = (gradient.angle * Math.PI) / 180
    const dx = Math.sin(radians)
    const dy = -Math.cos(radians)
    const stops = gradient.stops
      .map(
        (stop) =>
          `<stop offset="${svgNumber(stop.offset * 100)}%" stop-color="#${stop.color.hex}" stop-opacity="${svgNumber(stop.color.alpha)}"/>`,
      )
      .join('')
    definitions = `<defs><linearGradient id="g" x1="${svgNumber(50 - dx * 50)}%" y1="${svgNumber(50 - dy * 50)}%" x2="${svgNumber(50 + dx * 50)}%" y2="${svgNumber(50 + dy * 50)}%">${stops}</linearGradient></defs>`
    fill = 'url(#g)'
    fillOpacity = 1
  }

  const stroke = element.stroke
    ? ` stroke="#${element.stroke.color.hex}" stroke-opacity="${svgNumber(element.stroke.color.alpha)}" stroke-width="${svgNumber(strokeWidth)}"`
    : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgNumber(width)} ${svgNumber(height)}">${definitions}<rect x="${svgNumber(inset)}" y="${svgNumber(inset)}" width="${svgNumber(Math.max(0.01, width - strokeWidth))}" height="${svgNumber(Math.max(0.01, height - strokeWidth))}" rx="${svgNumber(radius)}" fill="${fill}" fill-opacity="${svgNumber(fillOpacity)}"${stroke}/></svg>`
  return svgToDataUrl(svg)
}

export function gradientSvgDataUrl(element: HtmlShapeElement): string {
  const width = Math.max(0.01, element.box.width)
  const height = Math.max(0.01, element.box.height)
  const radians = (element.gradient!.angle * Math.PI) / 180
  const dx = Math.sin(radians)
  const dy = -Math.cos(radians)
  const x1 = 50 - dx * 50
  const y1 = 50 - dy * 50
  const x2 = 50 + dx * 50
  const y2 = 50 + dy * 50
  const stops = element
    .gradient!.stops.map(
      (stop) =>
        `<stop offset="${svgNumber(stop.offset * 100)}%" stop-color="#${stop.color.hex}" stop-opacity="${svgNumber(stop.color.alpha)}"/>`,
    )
    .join('')
  const paint =
    element.shape === 'ellipse'
      ? `<ellipse cx="${svgNumber(width / 2)}" cy="${svgNumber(height / 2)}" rx="${svgNumber(width / 2)}" ry="${svgNumber(height / 2)}" fill="url(#g)"/>`
      : element.shape === 'chevron'
        ? `<polygon points="0,0 ${svgNumber(width * 0.95)},0 ${svgNumber(width)},${svgNumber(height / 2)} ${svgNumber(width * 0.95)},${svgNumber(height)} 0,${svgNumber(height)} ${svgNumber(width * 0.05)},${svgNumber(height / 2)}" fill="url(#g)"/>`
        : `<rect width="${svgNumber(width)}" height="${svgNumber(height)}" rx="${svgNumber(element.shape === 'roundRect' ? Math.max(0, element.radiusPx ?? 0) : 0)}" fill="url(#g)"/>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgNumber(width)} ${svgNumber(height)}"><defs><linearGradient id="g" x1="${svgNumber(x1)}%" y1="${svgNumber(y1)}%" x2="${svgNumber(x2)}%" y2="${svgNumber(y2)}%">${stops}</linearGradient></defs>${paint}</svg>`
  return svgToDataUrl(svg)
}

function svgNumber(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}
