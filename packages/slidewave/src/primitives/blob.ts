import { svgToPngDataUrl, inchesToPx } from '../utils/svg'
import { normalizeHex } from '../utils/color'

/**
 * Mulberry32 PRNG — deterministic from a seed.
 */
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Generates an organic blob shape as SVG.
 *
 * @param {object} opts
 * @param {number} opts.points      — number of control points (default: 8)
 * @param {number} opts.irregularity — contour irregularity from 0 to 1 (default: 0.4)
 * @param {number} opts.seed        — deterministic seed (default: 42)
 * @param {string} opts.fill        — hex color, or a gradient through fillGradient
 * @param {[string,string]?} opts.fillGradient — [colorA, colorB]
 * @param {number?} opts.gradientAngle — gradient angle in degrees (default: 135)
 * @returns {string} markup SVG
 */
export function blobSvg({
  points = 8,
  irregularity = 0.4,
  seed = 42,
  fill = '#6366f1',
  fillGradient = null,
  gradientAngle = 135,
}) {
  const rand = mulberry32(seed)
  const cx = 200,
    cy = 200,
    baseR = 160

  const pts = []
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2
    const r = baseR * (1 - irregularity / 2 + rand() * irregularity)
    pts.push({
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
    })
  }

  // Smooth Catmull-Rom to Bézier conversion.
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[(i - 1 + pts.length) % pts.length]
    const p1 = pts[i]
    const p2 = pts[(i + 1) % pts.length]
    const p3 = pts[(i + 2) % pts.length]
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  d += ' Z'

  const rad = (gradientAngle * Math.PI) / 180
  const x1 = 50 - Math.cos(rad) * 50
  const y1 = 50 - Math.sin(rad) * 50
  const x2 = 50 + Math.cos(rad) * 50
  const y2 = 50 + Math.sin(rad) * 50

  const fillAttr = fillGradient ? 'url(#blob-grad)' : `#${normalizeHex(fill)}`

  const defs = fillGradient
    ? `<defs>
         <linearGradient id="blob-grad" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">
           <stop offset="0%"  stop-color="#${normalizeHex(fillGradient[0])}"/>
           <stop offset="100%" stop-color="#${normalizeHex(fillGradient[1])}"/>
         </linearGradient>
       </defs>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
    ${defs}
    <path d="${d}" fill="${fillAttr}"/>
  </svg>`
}

/**
 * Rasterizes a blob to a PNG data URL ready for addImage.
 */
export async function blobToPng(opts, widthInches, heightInches) {
  const svg = blobSvg(opts)
  const w = inchesToPx(widthInches)
  const h = inchesToPx(heightInches)
  return svgToPngDataUrl(svg, w, h)
}
