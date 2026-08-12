/**
 * Rasterized decorative patterns: dotGrid, stripes, and waveDivider.
 * Each produces pure SVG without foreignObject, then a PNG through Canvas.
 */
import { svgToPngDataUrl, inchesToPx } from '../utils/svg'
import { normalizeHex } from '../utils/color'

/* ─── DOT GRID ─────────────────────────────────────────────────────── */

export function dotGridSvg({
  widthPx = 800,
  heightPx = 600,
  cellSize = 24,
  dotRadius = 1.2,
  color = '#ffffff',
  opacity = 0.25,
  bg = null, // null = transparent
}) {
  const dots = []
  for (let y = cellSize / 2; y < heightPx; y += cellSize) {
    for (let x = cellSize / 2; x < widthPx; x += cellSize) {
      dots.push(`<circle cx="${x}" cy="${y}" r="${dotRadius}"/>`)
    }
  }
  const bgRect = bg
    ? `<rect width="${widthPx}" height="${heightPx}" fill="#${normalizeHex(bg)}"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
    ${bgRect}
    <g fill="#${normalizeHex(color)}" fill-opacity="${opacity}">${dots.join('')}</g>
  </svg>`
}

export async function dotGridToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    dotGridSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}

/* ─── STRIPES ──────────────────────────────────────────────────────── */

export function stripesSvg({
  widthPx = 800,
  heightPx = 600,
  angle = 45,
  stripeWidth = 16,
  gap = 16,
  color = '#ffffff',
  opacity = 0.15,
  bg = null,
}) {
  const tile = stripeWidth + gap
  const id = 'stripes_' + Math.random().toString(36).slice(2, 8)
  const bgRect = bg
    ? `<rect width="${widthPx}" height="${heightPx}" fill="#${normalizeHex(bg)}"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
    <defs>
      <pattern id="${id}" width="${tile}" height="${tile}" patternUnits="userSpaceOnUse" patternTransform="rotate(${angle})">
        <rect width="${stripeWidth}" height="${tile}" fill="#${normalizeHex(color)}" fill-opacity="${opacity}"/>
      </pattern>
    </defs>
    ${bgRect}
    <rect width="${widthPx}" height="${heightPx}" fill="url(#${id})"/>
  </svg>`
}

export async function stripesToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    stripesSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}

/* ─── WAVE DIVIDER ─────────────────────────────────────────────────── */
/**
 * Sine wave used as a section divider.
 * Set flip=true to reverse it vertically.
 */
export function waveDividerSvg({
  widthPx = 1200,
  heightPx = 200,
  amplitude = 40,
  frequency = 1.8,
  strokeColor = '#6366f1',
  strokeWidth = 3,
  fillColor = null, // when set, fills the area below the curve
  fillOpacity = 1,
  flip = false,
  phase = 0,
}) {
  const steps = 64
  const pts = []
  const midY = heightPx / 2
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * widthPx
    const t = (i / steps) * Math.PI * 2 * frequency + phase
    const y = midY + Math.sin(t) * amplitude
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`)
  }

  const strokePath = `M${pts.join(' L')}`
  const fillPath = `M0,${heightPx} L${pts.join(' L')} L${widthPx},${heightPx} Z`

  const group = [
    fillColor
      ? `<path d="${fillPath}" fill="#${normalizeHex(fillColor)}" fill-opacity="${fillOpacity}"/>`
      : '',
    `<path d="${strokePath}" fill="none" stroke="#${normalizeHex(strokeColor)}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`,
  ].join('')

  const transform = flip
    ? `transform="translate(0,${heightPx}) scale(1,-1)"`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
    <g ${transform}>${group}</g>
  </svg>`
}

export async function waveDividerToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    waveDividerSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}
