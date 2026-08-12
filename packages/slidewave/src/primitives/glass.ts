import { svgToPngDataUrl, inchesToPx } from '../utils/svg'
import { normalizeHex } from '../utils/color'

/**
 * Glass card — a translucent rounded rectangle with tint, highlight, and a
 * subtle border. It is rasterized because PPT does not support this blur.
 * The blur is NOT applied to the content behind the card because PowerPoint's
 * blur is destructive and slow. Opacity, noise, and tint simulate frosted glass.
 */
export function glassSvg({
  tint = '#ffffff',
  tintOpacity = 0.12,
  borderColor = '#ffffff',
  borderOpacity = 0.2,
  borderWidth = 2,
  radius = 24,
  highlight = true,
  widthPx = 800,
  heightPx = 500,
}) {
  const t = normalizeHex(tint)
  const b = normalizeHex(borderColor)

  const highlightLayer = highlight
    ? `<rect x="${borderWidth}" y="${borderWidth}" width="${widthPx - borderWidth * 2}" height="${(heightPx - borderWidth * 2) / 2}"
          rx="${radius - borderWidth}" fill="url(#shine)" opacity="0.3"/>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthPx} ${heightPx}" width="${widthPx}" height="${heightPx}">
    <defs>
      <linearGradient id="shine" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%"   stop-color="#FFFFFF" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${widthPx}" height="${heightPx}"
          rx="${radius}" fill="#${t}" fill-opacity="${tintOpacity}"
          stroke="#${b}" stroke-opacity="${borderOpacity}" stroke-width="${borderWidth}"/>
    ${highlightLayer}
  </svg>`
}

export async function glassToPng(opts, widthInches, heightInches) {
  const wPx = inchesToPx(widthInches)
  const hPx = inchesToPx(heightInches)
  const svg = glassSvg({ ...opts, widthPx: wPx, heightPx: hPx })
  return svgToPngDataUrl(svg, wPx, hPx)
}
