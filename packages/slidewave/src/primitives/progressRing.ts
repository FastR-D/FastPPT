/**
 * Circular progress ring rasterized from SVG to PNG.
 * A dashboard staple with a large central value and progress arc.
 */
import { svgToPngDataUrl, inchesToPx } from '../utils/svg'
import { normalizeHex } from '../utils/color'

export function progressRingSvg({
  widthPx = 400,
  heightPx = 400,
  value = 0.7, // 0..1
  thickness = 18,
  trackColor = '#1f2937',
  trackOpacity = 1,
  progressColor = '#6366f1',
  progressGradient = null, // ['#a', '#b'] override progressColor
  label = null, // for example '70%'; generated automatically when null
  labelColor = '#ffffff',
  labelFontFamily = 'system-ui, sans-serif',
  labelFontSize = null, // automatic when null
  labelFontWeight = 700,
  sublabel = null, // ex. 'adoption'
  sublabelColor = '#9ca3af',
  startAngle = -90, // °, -90 = 12h (top)
  rounded = true,
}) {
  const size = Math.min(widthPx, heightPx)
  const cx = widthPx / 2,
    cy = heightPx / 2
  const r = size / 2 - thickness / 2 - 4
  const v = Math.max(0, Math.min(1, value))
  const circumference = 2 * Math.PI * r
  const dash = circumference * v
  const gapDash = circumference - dash

  const gradId = 'pr_' + Math.random().toString(36).slice(2, 8)
  const progressStroke = progressGradient
    ? `url(#${gradId})`
    : `#${normalizeHex(progressColor)}`

  const gradDef = progressGradient
    ? `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="1">
        ${progressGradient
          .map(
            (c, i, a) =>
              `<stop offset="${((i / (a.length - 1)) * 100).toFixed(1)}%" stop-color="#${normalizeHex(c)}"/>`,
          )
          .join('')}
      </linearGradient></defs>`
    : ''

  const lbl = label != null ? label : `${Math.round(v * 100)}%`
  const fs = labelFontSize ?? Math.round(size * 0.26)
  const subFs = Math.round(fs * 0.28)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
    ${gradDef}
    <circle cx="${cx}" cy="${cy}" r="${r}"
            fill="none"
            stroke="#${normalizeHex(trackColor)}" stroke-opacity="${trackOpacity}"
            stroke-width="${thickness}"
            ${rounded ? 'stroke-linecap="round"' : ''}/>
    <circle cx="${cx}" cy="${cy}" r="${r}"
            fill="none"
            stroke="${progressStroke}"
            stroke-width="${thickness}"
            ${rounded ? 'stroke-linecap="round"' : ''}
            stroke-dasharray="${dash.toFixed(2)} ${gapDash.toFixed(2)}"
            transform="rotate(${startAngle} ${cx} ${cy})"/>
    <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"
          fill="#${normalizeHex(labelColor)}"
          font-family="${labelFontFamily}"
          font-size="${fs}"
          font-weight="${labelFontWeight}">${lbl}</text>
    ${
      sublabel
        ? `<text x="${cx}" y="${cy + fs * 0.55}" text-anchor="middle"
          fill="#${normalizeHex(sublabelColor)}"
          font-family="${labelFontFamily}"
          font-size="${subFs}"
          letter-spacing="2">${sublabel}</text>`
        : ''
    }
  </svg>`
}

export async function progressRingToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    progressRingSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}
