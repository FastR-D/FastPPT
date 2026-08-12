/**
 * Sparkline: compact inline line chart rasterized from pure SVG to PNG.
 * Ideal for showing a trend inside a stat card.
 */
import { svgToPngDataUrl, inchesToPx } from '../utils/svg'
import { normalizeHex } from '../utils/color'

export function sparklineSvg({
  widthPx = 300,
  heightPx = 80,
  values = [],
  strokeColor = '#6366f1',
  strokeWidth = 2.5,
  fillColor = null, // fill below the line
  fillOpacity = 0.2,
  showDots = false,
  dotColor = null, // defaults to strokeColor
  dotRadius = 3,
  showLast = true, // highlight the last point
  smooth = true, // smoothed Catmull-Rom curve
  padding = 6,
  min = null,
  max = null,
}) {
  if (!values.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}"></svg>`
  }

  const lo = min ?? Math.min(...values)
  const hi = max ?? Math.max(...values)
  const range = hi - lo || 1

  const innerW = widthPx - padding * 2
  const innerH = heightPx - padding * 2

  const pts = values.map((v, i) => ({
    x:
      padding +
      (values.length === 1 ? innerW / 2 : (i / (values.length - 1)) * innerW),
    y: padding + innerH - ((v - lo) / range) * innerH,
  }))

  const path =
    smooth && pts.length > 2
      ? catmullRomPath(pts)
      : 'M' + pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' L')

  const fillPath = fillColor
    ? path +
      ` L${pts[pts.length - 1].x.toFixed(2)},${heightPx - padding} L${pts[0].x.toFixed(2)},${heightPx - padding} Z`
    : null

  const dc = normalizeHex(dotColor || strokeColor)
  const dotsMarkup = showDots
    ? pts
        .map(
          (p) =>
            `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${dotRadius}" fill="#${dc}"/>`,
        )
        .join('')
    : ''
  const last = pts[pts.length - 1]
  const lastMarkup =
    showLast && !showDots
      ? `<circle cx="${last.x.toFixed(2)}" cy="${last.y.toFixed(2)}" r="${dotRadius + 1}" fill="#${dc}"/>`
      : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
    ${fillPath ? `<path d="${fillPath}" fill="#${normalizeHex(fillColor)}" fill-opacity="${fillOpacity}"/>` : ''}
    <path d="${path}" fill="none" stroke="#${normalizeHex(strokeColor)}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>
    ${dotsMarkup}
    ${lastMarkup}
  </svg>`
}

/** Catmull-Rom path: a smooth curve passing through every point. */
function catmullRomPath(pts) {
  if (pts.length < 2) return ''
  let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`
  }
  return d
}

export async function sparklineToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    sparklineSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}
