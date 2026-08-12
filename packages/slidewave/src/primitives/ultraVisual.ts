/**
 * Ultra-Visual Pack v0.6 — cinematic raster primitives.
 *   - neonGlow        : text or shape with a layered neon halo
 *   - liquidGradient  : organic multi-focus fluid gradient
 *   - holoFoil        : iridescent holographic card texture
 *   - particleField   : particles, stars, or confetti
 *   - cinematicBars   : top/bottom letterbox bars with an optional vignette
 *   - glitchBands     : horizontal RGB-shift and scanline glitch effect
 *   - duotone         : photographic two-tone SVG overlay
 *   - gradientMesh    : CSS-grid-style mesh gradient with 4–9 color points
 */
import { svgToPngDataUrl, inchesToPx } from '../utils/svg'
import { normalizeHex } from '../utils/color'

/* ─── NEON GLOW ────────────────────────────────────────────────────── */
/**
 * Text with a layered neon halo.
 * Can also be used as an overlay on a dark background.
 */
export function neonGlowSvg({
  widthPx = 1200,
  heightPx = 400,
  text = '',
  fontFamily = 'Inter, system-ui, sans-serif',
  fontSize = 120,
  fontWeight = 700,
  color = '#00fff7', // primary neon color
  glowColor = null, // defaults to color
  glowLayers = 4, // number of blur passes
  glowMaxBlur = 32,
  glowOpacity = 0.8,
  bg = null,
  align = 'center',
  letterSpacing = 0,
}) {
  const gc = glowColor || color
  const cx =
    align === 'center' ? widthPx / 2 : align === 'right' ? widthPx - 40 : 40
  const anchor =
    align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start'
  const cy = heightPx / 2

  const id = 'ng_' + Math.random().toString(36).slice(2, 8)
  const filters = Array.from({ length: glowLayers }, (_, i) => {
    const blur = (glowMaxBlur / glowLayers) * (i + 1)
    const fid = `${id}_f${i}`
    return `<filter id="${fid}" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="${blur.toFixed(1)}" result="blur"/>
    </filter>`
  }).join('')

  const glowTexts = Array.from({ length: glowLayers }, (_, i) => {
    const blur = (glowMaxBlur / glowLayers) * (i + 1)
    const op = (glowOpacity * (1 - i / glowLayers)).toFixed(2)
    const fid = `${id}_f${i}`
    return `<text x="${cx}" y="${cy}" text-anchor="${anchor}" dominant-baseline="central"
      font-family="${fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}"
      letter-spacing="${letterSpacing}"
      fill="#${normalizeHex(gc)}" opacity="${op}"
      filter="url(#${fid})">${escapeXml(text)}</text>`
  }).join('')

  const mainText = text
    ? `<text x="${cx}" y="${cy}" text-anchor="${anchor}" dominant-baseline="central"
    font-family="${fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}"
    letter-spacing="${letterSpacing}"
    fill="#${normalizeHex(color)}">${escapeXml(text)}</text>`
    : ''

  const bgRect = bg
    ? `<rect width="${widthPx}" height="${heightPx}" fill="#${normalizeHex(bg)}"/>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
    <defs>${filters}</defs>
    ${bgRect}
    ${glowTexts}
    ${mainText}
  </svg>`
}

export async function neonGlowToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    neonGlowSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}

/* ─── LIQUID GRADIENT ──────────────────────────────────────────────── */
/**
 * Fluid gradient with organic, liquid-ink contours.
 * Layers rotated blurred ellipses to create a living-flow effect.
 */
export function liquidGradientSvg({
  widthPx = 1200,
  heightPx = 800,
  bg = '#000000',
  stops = null, // [{color, x, y, rx, ry, rotate, opacity}] ratio 0..1
  blur = 80,
  saturation = 1.4,
}) {
  const defaults = [
    {
      color: '#FF006E',
      x: 0.25,
      y: 0.3,
      rx: 0.55,
      ry: 0.4,
      rotate: -20,
      opacity: 0.9,
    },
    {
      color: '#8338EC',
      x: 0.7,
      y: 0.35,
      rx: 0.5,
      ry: 0.45,
      rotate: 30,
      opacity: 0.9,
    },
    {
      color: '#3A86FF',
      x: 0.5,
      y: 0.7,
      rx: 0.6,
      ry: 0.35,
      rotate: 10,
      opacity: 0.85,
    },
    {
      color: '#FB5607',
      x: 0.15,
      y: 0.75,
      rx: 0.35,
      ry: 0.5,
      rotate: -40,
      opacity: 0.7,
    },
    {
      color: '#FFBE0B',
      x: 0.8,
      y: 0.75,
      rx: 0.4,
      ry: 0.35,
      rotate: 20,
      opacity: 0.7,
    },
  ]
  const list = stops ?? defaults
  const id = 'lq_' + Math.random().toString(36).slice(2, 8)

  const ellipses = list
    .map((s) => {
      const cx = s.x * widthPx,
        cy = s.y * heightPx
      const rx = (s.rx * widthPx) / 2,
        ry = (s.ry * heightPx) / 2
      return `<ellipse cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" rx="${rx.toFixed(0)}" ry="${ry.toFixed(0)}"
      fill="#${normalizeHex(s.color)}" opacity="${s.opacity ?? 0.85}"
      transform="rotate(${s.rotate ?? 0} ${cx.toFixed(0)} ${cy.toFixed(0)})"/>`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
    <defs>
      <filter id="${id}" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="${blur}"/>
        <feColorMatrix type="saturate" values="${saturation}"/>
      </filter>
    </defs>
    <rect width="${widthPx}" height="${heightPx}" fill="#${normalizeHex(bg)}"/>
    <g filter="url(#${id})">${ellipses}</g>
  </svg>`
}

export async function liquidGradientToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    liquidGradientSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}

/* ─── HOLO FOIL ────────────────────────────────────────────────────── */
/**
 * Iridescent holographic trading-card texture.
 * Uses multicolor diagonal bands with a rainbow gradient.
 */
export function holoFoilSvg({
  widthPx = 800,
  heightPx = 600,
  angle = 45,
  stripeWidth = 60,
  colors = [
    '#FF006E',
    '#FF6B35',
    '#FFBE0B',
    '#00F5D4',
    '#3A86FF',
    '#8338EC',
    '#FF006E',
  ],
  opacity = 0.75,
  bg = null,
  blur = 0,
  shimmer = true, // adds a bright diagonal overlay
}) {
  const id = 'hf_' + Math.random().toString(36).slice(2, 8)
  const total = stripeWidth * colors.length
  const gradStops = colors
    .map(
      (c, i) =>
        `<stop offset="${((i / (colors.length - 1)) * 100).toFixed(1)}%" stop-color="#${normalizeHex(c)}"/>`,
    )
    .join('')

  const shimmerGrad = shimmer
    ? `
    <linearGradient id="${id}_sh" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="35%" stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="50%" stop-color="#ffffff" stop-opacity="0.6"/>
      <stop offset="65%" stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>`
    : ''

  const blurF =
    blur > 0
      ? `<filter id="${id}_bl"><feGaussianBlur stdDeviation="${blur}"/></filter>`
      : ''

  const bgRect = bg
    ? `<rect width="${widthPx}" height="${heightPx}" fill="#${normalizeHex(bg)}"/>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
    <defs>
      <linearGradient id="${id}_g" x1="0" y1="0" x2="1" y2="0" gradientTransform="rotate(${angle},0.5,0.5)">${gradStops}</linearGradient>
      ${shimmerGrad}${blurF}
    </defs>
    ${bgRect}
    <rect width="${widthPx}" height="${heightPx}" fill="url(#${id}_g)" opacity="${opacity}" ${blur > 0 ? `filter="url(#${id}_bl)"` : ''}/>
    ${shimmer ? `<rect width="${widthPx}" height="${heightPx}" fill="url(#${id}_sh)"/>` : ''}
  </svg>`
}

export async function holoFoilToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    holoFoilSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}

/* ─── PARTICLE FIELD ───────────────────────────────────────────────── */
/**
 * Particle field for stars, confetti, or cosmic dust.
 */
export function particleFieldSvg({
  widthPx = 1200,
  heightPx = 800,
  count = 200,
  seed = 42,
  bg = null,
  colors = ['#ffffff'],
  minR = 0.8,
  maxR = 3,
  minOpacity = 0.2,
  maxOpacity = 0.9,
  shape = 'circle', // 'circle' | 'square' | 'cross' | 'mixed'
  connected = false, // connect nearby particles as a constellation
  connectionDist = 80,
  connectionOpacity = 0.12,
  connectionColor = '#ffffff',
}) {
  // Deterministic Mulberry32 PRNG.
  let s = seed >>> 0
  const rng = () => {
    s ^= s << 13
    s ^= s >> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }

  const pts = Array.from({ length: count }, () => ({
    x: rng() * widthPx,
    y: rng() * heightPx,
    r: minR + rng() * (maxR - minR),
    op: minOpacity + rng() * (maxOpacity - minOpacity),
    c: colors[Math.floor(rng() * colors.length)],
    sh:
      shape === 'mixed'
        ? ['circle', 'square', 'cross'][Math.floor(rng() * 3)]
        : shape,
  }))

  const lines = connected
    ? pts.flatMap((a, i) =>
        pts
          .slice(i + 1)
          .filter((b) => Math.hypot(a.x - b.x, a.y - b.y) < connectionDist)
          .map(
            (b) =>
              `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="#${normalizeHex(connectionColor)}" stroke-opacity="${connectionOpacity}" stroke-width="0.8"/>`,
          ),
      )
    : []

  const dots = pts.map((p) => {
    const fill = `#${normalizeHex(p.c)}`
    if (p.sh === 'square')
      return `<rect x="${(p.x - p.r).toFixed(1)}" y="${(p.y - p.r).toFixed(1)}" width="${(p.r * 2).toFixed(1)}" height="${(p.r * 2).toFixed(1)}" fill="${fill}" opacity="${p.op.toFixed(2)}"/>`
    if (p.sh === 'cross')
      return `<path d="M${(p.x - p.r * 1.4).toFixed(1)},${p.y.toFixed(1)} h${(p.r * 2.8).toFixed(1)} M${p.x.toFixed(1)},${(p.y - p.r * 1.4).toFixed(1)} v${(p.r * 2.8).toFixed(1)}" stroke="${fill}" stroke-width="${p.r.toFixed(1)}" stroke-opacity="${p.op.toFixed(2)}"/>`
    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.r.toFixed(2)}" fill="${fill}" opacity="${p.op.toFixed(2)}"/>`
  })

  const bgRect = bg
    ? `<rect width="${widthPx}" height="${heightPx}" fill="#${normalizeHex(bg)}"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
    ${bgRect}${lines.join('')}${dots.join('')}
  </svg>`
}

export async function particleFieldToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    particleFieldSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}

/* ─── CINEMATIC BARS ───────────────────────────────────────────────── */
/**
 * Cinematic top and bottom letterbox bars with an optional vignette.
 */
export function cinematicBarsSvg({
  widthPx = 1200,
  heightPx = 800,
  barRatio = 0.12, // bar height / slide height
  color = '#000000',
  vignette = true,
  vignetteOpacity = 0.5,
  vignetteRadius = 0.85,
}) {
  const barH = Math.round(heightPx * barRatio)
  const id = 'cb_' + Math.random().toString(36).slice(2, 8)

  const vig = vignette
    ? `
    <defs>
      <radialGradient id="${id}" cx="50%" cy="50%" r="${(vignetteRadius * 100).toFixed(0)}%">
        <stop offset="0%" stop-color="#000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000" stop-opacity="${vignetteOpacity}"/>
      </radialGradient>
    </defs>
    <rect width="${widthPx}" height="${heightPx}" fill="url(#${id})"/>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
    ${vig}
    <rect x="0" y="0" width="${widthPx}" height="${barH}" fill="#${normalizeHex(color)}"/>
    <rect x="0" y="${heightPx - barH}" width="${widthPx}" height="${barH}" fill="#${normalizeHex(color)}"/>
  </svg>`
}

export async function cinematicBarsToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    cinematicBarsSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}

/* ─── GLITCH BANDS ─────────────────────────────────────────────────── */
/**
 * Horizontal glitch effect with RGB shift, scanlines, and distortion bands.
 * Layered over a colored background or image.
 */
export function glitchBandsSvg({
  widthPx = 1200,
  heightPx = 800,
  bg = '#0b0b0f',
  bands = 8,
  seed = 99,
  rgbShift = 6, // red/blue channel shift in pixels
  scanlineOpacity = 0.07,
  scanlineSpacing = 4,
  color = '#00fff7',
}) {
  let s = seed >>> 0
  const rng = () => {
    s ^= s << 13
    s ^= s >> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }

  const glitchRects = Array.from({ length: bands }, () => {
    const y = rng() * heightPx
    const h = 4 + rng() * 28
    const shift = (rng() - 0.5) * rgbShift * 4
    const op = 0.3 + rng() * 0.5
    return `<rect x="${shift.toFixed(1)}" y="${y.toFixed(1)}" width="${widthPx}" height="${h.toFixed(1)}" fill="#${normalizeHex(color)}" opacity="${op.toFixed(2)}"/>`
  })

  const scanlines = Array.from(
    { length: Math.floor(heightPx / scanlineSpacing) },
    (_, i) =>
      `<line x1="0" y1="${i * scanlineSpacing}" x2="${widthPx}" y2="${i * scanlineSpacing}" stroke="#000" stroke-opacity="${scanlineOpacity}"/>`,
  )

  const id = 'gl_' + Math.random().toString(36).slice(2, 8)
  const rShift = `<rect x="${rgbShift}" y="0" width="${widthPx}" height="${heightPx}" fill="red" opacity="0.04" style="mix-blend-mode:screen"/>`
  const bShift = `<rect x="-${rgbShift}" y="0" width="${widthPx}" height="${heightPx}" fill="blue" opacity="0.04" style="mix-blend-mode:screen"/>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
    <rect width="${widthPx}" height="${heightPx}" fill="#${normalizeHex(bg)}"/>
    ${glitchRects.join('')}
    ${scanlines.join('')}
    ${rShift}${bShift}
  </svg>`
}

export async function glitchBandsToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    glitchBandsSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}

/* ─── DUOTONE ───────────────────────────────────────────────────────── */
/**
 * Photographic duotone overlay. Without a source image, it creates a pure
 * duotone background using a bidirectional gradient and simulated desaturation.
 */
export function duotoneSvg({
  widthPx = 1200,
  heightPx = 800,
  colorDark = '#1D1160',
  colorLight = '#FF0050',
  angle = 135,
  opacity = 1,
  bg = null,
}) {
  const id = 'dt_' + Math.random().toString(36).slice(2, 8)
  const rad = (angle * Math.PI) / 180
  const x2 = (Math.cos(rad) * 0.5 + 0.5).toFixed(4)
  const y2 = (Math.sin(rad) * 0.5 + 0.5).toFixed(4)
  const bgRect = bg
    ? `<rect width="${widthPx}" height="${heightPx}" fill="#${normalizeHex(bg)}"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
    <defs>
      <linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">
        <stop offset="0%" stop-color="#${normalizeHex(colorDark)}"/>
        <stop offset="100%" stop-color="#${normalizeHex(colorLight)}"/>
      </linearGradient>
    </defs>
    ${bgRect}
    <rect width="${widthPx}" height="${heightPx}" fill="url(#${id})" opacity="${opacity}"/>
  </svg>`
}

export async function duotoneToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    duotoneSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}

/* ─── GRADIENT MESH (CSS-grid style) ──────────────────────────────── */
/**
 * Discrete-point mesh gradient inspired by Illustrator and Figma.
 * Uses an N×M color-point grid with approximate bilinear interpolation through
 * blurred SVG rectangles.
 */
export function gradientMeshSvg({
  widthPx = 1200,
  heightPx = 800,
  colors = [
    ['#FF006E', '#8338EC', '#3A86FF'],
    ['#FFBE0B', '#FF006E', '#8338EC'],
    ['#3A86FF', '#FFBE0B', '#FF006E'],
  ],
  blur = 90,
  bg = '#000000',
  opacity = 1,
}) {
  const rows = colors.length
  const cols = Math.max(...colors.map((r) => r.length))
  const cellW = widthPx / (cols - 1 || 1)
  const cellH = heightPx / (rows - 1 || 1)
  const id = 'gm_' + Math.random().toString(36).slice(2, 8)
  const size = Math.max(cellW, cellH) * 1.5

  const circles = colors
    .flatMap((row, ri) =>
      row.map((c, ci) => {
        const cx = ci * cellW,
          cy = ri * cellH
        return `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${size.toFixed(0)}" fill="#${normalizeHex(c)}" opacity="${opacity}"/>`
      }),
    )
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
    <defs>
      <filter id="${id}" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="${blur}"/>
      </filter>
    </defs>
    <rect width="${widthPx}" height="${heightPx}" fill="#${normalizeHex(bg)}"/>
    <g filter="url(#${id})">${circles}</g>
  </svg>`
}

export async function gradientMeshToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    gradientMeshSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}

/* ─── helper ───────────────────────────────────────────────────────── */
function escapeXml(s) {
  return String(s).replace(
    /[<>&"']/g,
    (c) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;',
      })[c],
  )
}
