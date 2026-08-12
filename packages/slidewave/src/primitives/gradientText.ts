import { svgToPngDataUrl, inchesToPx } from '../utils/svg'
import { normalizeHex } from '../utils/color'

/**
 * Gradient-filled text rasterized to PNG because pptxgenjs does not expose this
 * effect well. The text is no longer editable, but gains a magazine-style look
 * that is otherwise unavailable.
 *
 * @param {object} opts
 * @param {string} opts.text
 * @param {string} opts.fontFamily   — for example "Fraunces, Georgia, serif"
 * @param {number} opts.fontSize     — pixels at the target-size scale
 * @param {number} opts.fontWeight
 * @param {string} opts.fontStyle    — "normal" | "italic"
 * @param {[string,string]} opts.gradient — [from, to]
 * @param {number} opts.angle        — gradient angle in degrees
 * @param {number} opts.letterSpacing - em
 * @param {number} opts.lineHeight
 * @param {"left"|"center"|"right"} opts.align
 * @param {number} opts.widthPx
 * @param {number} opts.heightPx
 */
export function gradientTextSvg({
  text,
  fontFamily = 'Inter, system-ui, sans-serif',
  fontSize = 120,
  fontWeight = 700,
  fontStyle = 'normal',
  gradient = ['#6366f1', '#ec4899'],
  angle = 135,
  letterSpacing = 0,
  lineHeight = 1.1,
  align = 'left',
  widthPx = 1200,
  heightPx = 300,
}) {
  const rad = (angle * Math.PI) / 180
  const x1 = 50 - Math.cos(rad) * 50
  const y1 = 50 - Math.sin(rad) * 50
  const x2 = 50 + Math.cos(rad) * 50
  const y2 = 50 + Math.sin(rad) * 50

  // Split into lines while preserving explicit newlines.
  const lines = String(text).split('\n')
  const lh = fontSize * lineHeight
  const anchor =
    { left: 'start', center: 'middle', right: 'end' }[align] || 'start'
  const xPos =
    { left: 20, center: widthPx / 2, right: widthPx - 20 }[align] || 20

  const tspans = lines
    .map((line, i) => {
      const y = fontSize + i * lh
      return `<text x="${xPos}" y="${y}" text-anchor="${anchor}"
      font-family="${fontFamily}"
      font-size="${fontSize}"
      font-weight="${fontWeight}"
      font-style="${fontStyle}"
      letter-spacing="${letterSpacing}em"
      fill="url(#gt)">${escapeXml(line)}</text>`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthPx} ${heightPx}" width="${widthPx}" height="${heightPx}">
    <defs>
      <linearGradient id="gt" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">
        <stop offset="0%"   stop-color="#${normalizeHex(gradient[0])}"/>
        <stop offset="100%" stop-color="#${normalizeHex(gradient[1])}"/>
      </linearGradient>
    </defs>
    ${tspans}
  </svg>`
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export async function gradientTextToPng(opts, widthInches, heightInches) {
  const wPx = inchesToPx(widthInches)
  const hPx = inchesToPx(heightInches)
  const svg = gradientTextSvg({ ...opts, widthPx: wPx, heightPx: hPx })
  return svgToPngDataUrl(svg, wPx, hPx)
}
