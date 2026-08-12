/**
 * Visual Pack — decorative raster primitives (SVG → PNG).
 *   - halftone        : dots with gradually changing size for a print effect
 *   - gridPaper       : fine grid and axes inspired by Notion/Figma
 *   - checker         : two-color checkerboard
 *   - radialBurst     : centered rays for a retro sunburst
 *   - noiseTexture    : colored grain extending generateGrainPng
 *   - auroraGradient  : organic multi-focus mesh gradient
 */
import { svgToPngDataUrl, inchesToPx } from '../utils/svg'
import { normalizeHex } from '../utils/color'

/* ─── HALFTONE ─────────────────────────────────────────────────────── */

export function halftoneSvg({
  widthPx = 800,
  heightPx = 600,
  cellSize = 18,
  color = '#0b0b0f',
  bg = null,
  direction = 'horizontal', // 'horizontal' | 'vertical' | 'radial'
  minRadius = 0.2,
  maxRadius = 0.9, // ratio de cellSize / 2
  opacity = 1,
}) {
  const dots = []
  const cx0 = widthPx / 2,
    cy0 = heightPx / 2
  const maxDist = Math.hypot(cx0, cy0)
  for (let y = cellSize / 2; y < heightPx; y += cellSize) {
    for (let x = cellSize / 2; x < widthPx; x += cellSize) {
      let t
      if (direction === 'horizontal') t = x / widthPx
      else if (direction === 'vertical') t = y / heightPx
      else t = 1 - Math.hypot(x - cx0, y - cy0) / maxDist
      t = Math.max(0, Math.min(1, t))
      const r = (minRadius + (maxRadius - minRadius) * t) * (cellSize / 2)
      if (r > 0.1)
        dots.push(
          `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}"/>`,
        )
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

export async function halftoneToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    halftoneSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}

/* ─── GRID PAPER ───────────────────────────────────────────────────── */

export function gridPaperSvg({
  widthPx = 800,
  heightPx = 600,
  cellSize = 32,
  majorEvery = 5,
  color = '#1f2937',
  majorColor = null,
  opacity = 0.18,
  majorOpacity = 0.32,
  bg = null,
  strokeWidth = 1,
}) {
  const lines = []
  const majorStroke = `#${normalizeHex(majorColor || color)}`
  const minorStroke = `#${normalizeHex(color)}`
  let i = 0
  for (let x = 0; x <= widthPx; x += cellSize, i++) {
    const isMajor = i % majorEvery === 0
    lines.push(
      `<line x1="${x}" y1="0" x2="${x}" y2="${heightPx}" stroke="${isMajor ? majorStroke : minorStroke}" stroke-opacity="${isMajor ? majorOpacity : opacity}" stroke-width="${strokeWidth}"/>`,
    )
  }
  i = 0
  for (let y = 0; y <= heightPx; y += cellSize, i++) {
    const isMajor = i % majorEvery === 0
    lines.push(
      `<line x1="0" y1="${y}" x2="${widthPx}" y2="${y}" stroke="${isMajor ? majorStroke : minorStroke}" stroke-opacity="${isMajor ? majorOpacity : opacity}" stroke-width="${strokeWidth}"/>`,
    )
  }
  const bgRect = bg
    ? `<rect width="${widthPx}" height="${heightPx}" fill="#${normalizeHex(bg)}"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">${bgRect}${lines.join('')}</svg>`
}

export async function gridPaperToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    gridPaperSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}

/* ─── CHECKER ──────────────────────────────────────────────────────── */

export function checkerSvg({
  widthPx = 800,
  heightPx = 600,
  cellSize = 40,
  colorA = '#ffffff',
  colorB = '#0b0b0f',
  opacity = 1,
}) {
  const cells = []
  for (let y = 0, row = 0; y < heightPx; y += cellSize, row++) {
    for (let x = 0, col = 0; x < widthPx; x += cellSize, col++) {
      if ((row + col) % 2 === 0) continue
      cells.push(
        `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}"/>`,
      )
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
    <rect width="${widthPx}" height="${heightPx}" fill="#${normalizeHex(colorA)}"/>
    <g fill="#${normalizeHex(colorB)}" fill-opacity="${opacity}">${cells.join('')}</g>
  </svg>`
}

export async function checkerToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    checkerSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}

/* ─── RADIAL BURST ─────────────────────────────────────────────────── */

export function radialBurstSvg({
  widthPx = 800,
  heightPx = 600,
  cx = null,
  cy = null,
  rays = 24,
  color = '#fbbf24',
  bg = null,
  opacity = 0.5,
  innerRadius = 30,
  outerRadiusRatio = 1.4, // multiplier applied to max(w, h)
  rayWidth = 0.5, // fraction of slice width (0..1)
}) {
  const w = widthPx,
    h = heightPx
  const cX = cx ?? w / 2,
    cY = cy ?? h / 2
  const outer = Math.max(w, h) * outerRadiusRatio
  const slice = (Math.PI * 2) / rays
  const halfW = (slice * rayWidth) / 2
  const wedges = []
  for (let i = 0; i < rays; i++) {
    const a = i * slice
    const a1 = a - halfW,
      a2 = a + halfW
    const x1 = cX + Math.cos(a1) * innerRadius
    const y1 = cY + Math.sin(a1) * innerRadius
    const x2 = cX + Math.cos(a2) * innerRadius
    const y2 = cY + Math.sin(a2) * innerRadius
    const x3 = cX + Math.cos(a2) * outer
    const y3 = cY + Math.sin(a2) * outer
    const x4 = cX + Math.cos(a1) * outer
    const y4 = cY + Math.sin(a1) * outer
    wedges.push(
      `<polygon points="${x1.toFixed(1)},${y1.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)} ${x3.toFixed(1)},${y3.toFixed(1)} ${x4.toFixed(1)},${y4.toFixed(1)}"/>`,
    )
  }
  const bgRect = bg
    ? `<rect width="${w}" height="${h}" fill="#${normalizeHex(bg)}"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    ${bgRect}
    <g fill="#${normalizeHex(color)}" fill-opacity="${opacity}">${wedges.join('')}</g>
  </svg>`
}

export async function radialBurstToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    radialBurstSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}

/* ─── NOISE TEXTURE (colored grain) ────────────────────────────────── */

export function noiseTextureSvg({
  widthPx = 800,
  heightPx = 600,
  baseFrequency = 0.9,
  numOctaves = 2,
  bg = null,
  tint = '#ffffff',
  opacity = 0.5,
  seed = 1,
}) {
  const id = 'nt_' + Math.random().toString(36).slice(2, 8)
  const bgRect = bg
    ? `<rect width="${widthPx}" height="${heightPx}" fill="#${normalizeHex(bg)}"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
    <defs>
      <filter id="${id}">
        <feTurbulence type="fractalNoise" baseFrequency="${baseFrequency}" numOctaves="${numOctaves}" seed="${seed}"/>
        <feColorMatrix type="matrix" values="0 0 0 0 1   0 0 0 0 1   0 0 0 0 1   0 0 0 1.2 0"/>
      </filter>
    </defs>
    ${bgRect}
    <rect width="${widthPx}" height="${heightPx}" fill="#${normalizeHex(tint)}" opacity="${opacity}" filter="url(#${id})"/>
  </svg>`
}

export async function noiseTextureToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    noiseTextureSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}

/* ─── AURORA GRADIENT ──────────────────────────────────────────────── */
/**
 * Organic mesh gradient: layers several large colored circles with strong blur
 * over a dark background to create an aurora or blurred-blob effect.
 */
export function auroraGradientSvg({
  widthPx = 1200,
  heightPx = 800,
  bg = '#0b0b0f',
  blobs = null, // [{ x, y, r, color }] en ratio 0..1
  blur = 120,
  opacity = 0.85,
}) {
  const list = blobs ?? [
    { x: 0.2, y: 0.3, r: 0.45, color: '#7C3AED' },
    { x: 0.75, y: 0.25, r: 0.4, color: '#EC4899' },
    { x: 0.55, y: 0.75, r: 0.5, color: '#06B6D4' },
    { x: 0.1, y: 0.85, r: 0.3, color: '#F59E0B' },
  ]
  const id = 'au_' + Math.random().toString(36).slice(2, 8)
  const circles = list
    .map((b) => {
      const cx = b.x * widthPx,
        cy = b.y * heightPx
      const r = b.r * Math.min(widthPx, heightPx)
      return `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${r.toFixed(0)}" fill="#${normalizeHex(b.color)}" opacity="${opacity}"/>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
    <defs><filter id="${id}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${blur}"/></filter></defs>
    <rect width="${widthPx}" height="${heightPx}" fill="#${normalizeHex(bg)}"/>
    <g filter="url(#${id})">${circles}</g>
  </svg>`
}

export async function auroraGradientToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    auroraGradientSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}
