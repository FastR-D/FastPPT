import { svgToPngDataUrl, inchesToPx } from '../utils/svg'
import { normalizeHex } from '../utils/color'

/**
 * Generates rich gradient backgrounds that are difficult to reproduce with
 * native pptxgenjs features:
 *  - "linear"   : two-color linear gradient with an exact angle
 *  - "radial"   : radial gradient, which is uncommon in PPT
 *  - "mesh"     : two or three layered radial spots with aurora-style blur
 *  - "conic"    : approximated conic gradient
 */

export function gradientSvg({
  type = 'mesh',
  colors = ['#6366f1', '#8b5cf6', '#ec4899'],
  angle = 135,
  base = '#0b0b0f',
  blur = 60,
  seed = 1,
}) {
  const W = 1280,
    H = 720

  if (type === 'linear') {
    const rad = (angle * Math.PI) / 180
    const x1 = 50 - Math.cos(rad) * 50
    const y1 = 50 - Math.sin(rad) * 50
    const x2 = 50 + Math.cos(rad) * 50
    const y2 = 50 + Math.sin(rad) * 50
    const stops = colors
      .map(
        (c, i) =>
          `<stop offset="${(i / (colors.length - 1)) * 100}%" stop-color="#${normalizeHex(c)}"/>`,
      )
      .join('')
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      <defs><linearGradient id="g" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">${stops}</linearGradient></defs>
      <rect width="${W}" height="${H}" fill="url(#g)"/>
    </svg>`
  }

  if (type === 'radial') {
    const stops = colors
      .map(
        (c, i) =>
          `<stop offset="${(i / (colors.length - 1)) * 100}%" stop-color="#${normalizeHex(c)}"/>`,
      )
      .join('')
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      <defs><radialGradient id="g" cx="50%" cy="50%" r="75%">${stops}</radialGradient></defs>
      <rect width="${W}" height="${H}" fill="url(#g)"/>
    </svg>`
  }

  // Aurora-style mesh: three layered colored blobs with blur over a base color.
  // Use a pseudo-random seed to position the blobs.
  const positions = [
    { cx: 0.25, cy: 0.3, r: 0.55 },
    { cx: 0.8, cy: 0.7, r: 0.5 },
    { cx: 0.55, cy: 0.45, r: 0.6 },
  ]

  const blobs = colors
    .map((c, i) => {
      const p = positions[i % positions.length]
      return `<circle cx="${p.cx * W}" cy="${p.cy * H}" r="${p.r * H}" fill="#${normalizeHex(c)}" opacity="0.75"/>`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <defs>
      <filter id="blur"><feGaussianBlur stdDeviation="${blur}"/></filter>
    </defs>
    <rect width="${W}" height="${H}" fill="#${normalizeHex(base)}"/>
    <g filter="url(#blur)">${blobs}</g>
  </svg>`
}

export async function gradientBgToPng(opts, widthInches, heightInches) {
  const svg = gradientSvg(opts)
  const w = inchesToPx(widthInches)
  const h = inchesToPx(heightInches)
  return svgToPngDataUrl(svg, w, h)
}
