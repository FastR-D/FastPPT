import { svgToPngDataUrl, inchesToPx } from '../utils/svg'
import { normalizeHex } from '../utils/color'

/**
 * Isometric Grid — three directions at 30°, 150°, and 90°.
 * Ideal for technology, architecture, and editorial-print backgrounds.
 */
export function isometricGridSvg({
  cellSize = 40, // pixels between lines
  lineColor = '#ffffff',
  lineOpacity = 0.15,
  lineWidth = 1,
  bgColor, // optionnel ; sinon transparent
  axes = ['h', 'a', 'b'], // 'h' horizontal, 'a' -30°, 'b' +30°
  widthPx = 800,
  heightPx = 500,
}) {
  const stroke = normalizeHex(lineColor)
  const bg = bgColor
    ? `<rect width="100%" height="100%" fill="#${normalizeHex(bgColor)}"/>`
    : ''

  const lines = []
  const diag = Math.hypot(widthPx, heightPx)
  const step = cellSize

  // direction +30° (y = x * tan30)
  // direction -30°
  // 90° direction (horizontal).
  if (axes.includes('h')) {
    for (let y = 0; y <= heightPx; y += step) {
      lines.push(`<line x1="0" y1="${y}" x2="${widthPx}" y2="${y}"/>`)
    }
  }
  if (axes.includes('a')) {
    // Lines at -30° (slope dy/dx = -tan30 ≈ -0.577).
    const slope = Math.tan(Math.PI / 6)
    const spacing = step / Math.cos(Math.PI / 6)
    for (let c = -diag; c <= diag; c += spacing) {
      // Line y = -slope*x + c through (0, c) and (widthPx, -slope*widthPx+c).
      const y1 = c
      const y2 = -slope * widthPx + c
      lines.push(`<line x1="0" y1="${y1}" x2="${widthPx}" y2="${y2}"/>`)
    }
  }
  if (axes.includes('b')) {
    const slope = Math.tan(Math.PI / 6)
    const spacing = step / Math.cos(Math.PI / 6)
    for (let c = -diag; c <= diag; c += spacing) {
      const y1 = c
      const y2 = slope * widthPx + c
      lines.push(`<line x1="0" y1="${y1}" x2="${widthPx}" y2="${y2}"/>`)
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthPx} ${heightPx}" width="${widthPx}" height="${heightPx}">
    ${bg}
    <g stroke="#${stroke}" stroke-opacity="${lineOpacity}" stroke-width="${lineWidth}" fill="none">
      ${lines.join('')}
    </g>
  </svg>`
}

export async function isometricGridToPng(opts, widthInches, heightInches) {
  const wPx = inchesToPx(widthInches)
  const hPx = inchesToPx(heightInches)
  const svg = isometricGridSvg({ ...opts, widthPx: wPx, heightPx: hPx })
  return svgToPngDataUrl(svg, wPx, hPx)
}
