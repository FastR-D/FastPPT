import { svgToPngDataUrl, inchesToPx } from '../utils/svg'
import { normalizeHex } from '../utils/color'

/**
 * Noise Gradient — a linear, radial, or mesh gradient with a native SVG
 * feTurbulence noise overlay. Produces a risograph/print feel for editorial slides.
 */
export function noiseGradientSvg({
  colors = ['#6366f1', '#ec4899'],
  angle = 135,
  type = 'linear', // 'linear' | 'radial'
  noiseOpacity = 0.25,
  noiseScale = 0.9, // 0.4 = gros grain, 2 = fin
  noiseOctaves = 2,
  monochrome = true,
  widthPx = 800,
  heightPx = 500,
}) {
  const stops = colors
    .map((c, i) => {
      const offset = (i / Math.max(1, colors.length - 1)) * 100
      return `<stop offset="${offset}%" stop-color="#${normalizeHex(c)}"/>`
    })
    .join('')

  const rad = ((angle - 90) * Math.PI) / 180
  const x2 = 50 + Math.cos(rad) * 50
  const y2 = 50 + Math.sin(rad) * 50

  const grad =
    type === 'radial'
      ? `<radialGradient id="g" cx="50%" cy="50%" r="70%">${stops}</radialGradient>`
      : `<linearGradient id="g" x1="${100 - x2}%" y1="${100 - y2}%" x2="${x2}%" y2="${y2}%">${stops}</linearGradient>`

  const colorMatrix = monochrome
    ? `<feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${noiseOpacity} 0"/>`
    : `<feColorMatrix type="matrix" values="0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 ${noiseOpacity} 0"/>`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthPx} ${heightPx}" width="${widthPx}" height="${heightPx}">
    <defs>
      ${grad}
      <filter id="noise" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="${noiseScale}" numOctaves="${noiseOctaves}" seed="4" stitchTiles="stitch"/>
        ${colorMatrix}
      </filter>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect width="100%" height="100%" filter="url(#noise)"/>
  </svg>`
}

export async function noiseGradientToPng(opts, widthInches, heightInches) {
  const wPx = inchesToPx(widthInches)
  const hPx = inchesToPx(heightInches)
  const svg = noiseGradientSvg({ ...opts, widthPx: wPx, heightPx: hPx })
  return svgToPngDataUrl(svg, wPx, hPx)
}
