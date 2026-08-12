/**
 * SVG slide rendering for the application's live preview.
 *
 * Takes a Slide instance with its _ops log and _background, and returns an SVG
 * string. The internal unit is one inch × 96 CSS pixels.
 *
 * Visual fidelity is approximate but sufficient for layout validation before
 * generating a .pptx file. Open the generated file in PowerPoint for exact fidelity.
 */

import { normalizeHex } from '../utils/color'

const PPI = 96 // pixels per inch for the SVG viewBox

export function renderSlideToSvg(slide, size) {
  const { width, height } = size
  const vw = Math.round(width * PPI)
  const vh = Math.round(height * PPI)

  const parts = []

  // Background
  const bg = slide._background
  if (bg?.color) {
    parts.push(`<rect width="100%" height="100%" fill="#${bg.color}"/>`)
  } else if (bg?.image) {
    parts.push(
      `<image href="${escAttr(bg.image)}" x="0" y="0" width="${vw}" height="${vh}" preserveAspectRatio="none"/>`,
    )
  } else {
    parts.push(`<rect width="100%" height="100%" fill="#ffffff"/>`)
  }

  // Filters (shadows) — collecte
  const defs = []
  let filterId = 0

  for (const op of slide._ops) {
    parts.push(renderOp(op, defs, () => `f${++filterId}`))
  }

  const defsBlock = defs.length ? `<defs>${defs.join('')}</defs>` : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">${defsBlock}${parts.join('')}</svg>`
}

function renderOp(op, defs, nextId) {
  switch (op.kind) {
    case 'text':
      return renderText(op)
    case 'rect':
      return renderRect(op, defs, nextId)
    case 'shape':
      return renderShape(op)
    case 'line':
      return renderLine(op)
    case 'image':
      return renderImage(op)
    case 'chart':
      return renderChart(op)
    case 'circle':
      return renderCircle(op)
    case 'arrowhead':
      return renderArrowhead(op)
    case 'table':
      return renderTable(op)
    default:
      return ''
  }
}

// ── Table (preview approximative) ──────────────────────────
function renderTable(op) {
  const {
    x = 0,
    y = 0,
    w = 6,
    h,
    headers = [],
    rows = [],
    headerBg = '7C3AED',
    headerColor = 'FFFFFF',
    rowBg = 'FFFFFF',
    altRowBg = 'FAFAFA',
    rowColor = '1A1A1A',
    borderColor = 'E5E7EB',
    fontFace = 'Inter, system-ui, sans-serif',
    fontSize = 12,
  } = op
  const px = x * PPI,
    py = y * PPI,
    pw = w * PPI
  const nRows = (headers.length ? 1 : 0) + rows.length
  if (nRows === 0) return ''
  const rowH = h ? (h * PPI) / nRows : Math.max(28, fontSize * 2.2)
  const nCols = Math.max(headers.length, ...rows.map((r) => r.length), 1)
  const colW = pw / nCols
  const parts = []
  let rowIdx = 0
  if (headers.length) {
    const ry = py + rowIdx * rowH
    parts.push(
      `<rect x="${px}" y="${ry}" width="${pw}" height="${rowH}" fill="#${normalizeHex(headerBg)}"/>`,
    )
    headers.forEach((hText, c) => {
      const cx = px + c * colW + colW / 2
      const cy = ry + rowH / 2 + fontSize * 0.35
      parts.push(
        `<text x="${cx}" y="${cy}" font-family="${escAttr(fontFace)}" font-size="${fontSize + 1}" font-weight="700" fill="#${normalizeHex(headerColor)}" text-anchor="middle">${escHtml(String(hText))}</text>`,
      )
    })
    parts.push(
      `<line x1="${px}" y1="${ry + rowH}" x2="${px + pw}" y2="${ry + rowH}" stroke="#${normalizeHex(borderColor)}" stroke-width="0.5"/>`,
    )
    rowIdx++
  }
  rows.forEach((row, i) => {
    const ry = py + rowIdx * rowH
    const bg = i % 2 === 0 ? rowBg : altRowBg
    parts.push(
      `<rect x="${px}" y="${ry}" width="${pw}" height="${rowH}" fill="#${normalizeHex(bg)}"/>`,
    )
    row.forEach((cell, c) => {
      const cellText =
        cell && typeof cell === 'object' && 'text' in cell
          ? cell.text
          : String(cell ?? '')
      const cx = px + c * colW + 12
      const cy = ry + rowH / 2 + fontSize * 0.35
      parts.push(
        `<text x="${cx}" y="${cy}" font-family="${escAttr(fontFace)}" font-size="${fontSize}" fill="#${normalizeHex(rowColor)}">${escHtml(cellText)}</text>`,
      )
    })
    parts.push(
      `<line x1="${px}" y1="${ry + rowH}" x2="${px + pw}" y2="${ry + rowH}" stroke="#${normalizeHex(borderColor)}" stroke-width="0.5"/>`,
    )
    rowIdx++
  })
  return `<g>${parts.join('')}</g>`
}

function renderCircle(op) {
  const { cx, cy, r, fill = '#000000' } = op
  return `<circle cx="${cx * PPI}" cy="${cy * PPI}" r="${r * PPI}" fill="#${normalizeHex(fill)}"/>`
}

function renderArrowhead(op) {
  const { x, y, size = 0.18, angle = 0, color = '#000000' } = op
  const px = x * PPI,
    py = y * PPI,
    s = size * PPI
  // Upward-pointing triangle centered on (px, py), then rotated.
  const pts = `${px},${py - s / 2} ${px - s / 2},${py + s / 2} ${px + s / 2},${py + s / 2}`
  return `<polygon points="${pts}" fill="#${normalizeHex(color)}" transform="rotate(${angle} ${px} ${py})"/>`
}

// ── Chart (preview approximative) ──────────────────────────
function renderChart(op) {
  const {
    x = 0,
    y = 0,
    w = 4,
    h = 3,
    chartType = 'bar',
    data = [],
    title,
    palette,
  } = op
  const px = x * PPI,
    py = y * PPI
  const pw = w * PPI,
    ph = h * PPI
  const PALETTES = {
    editorial: [
      '#0b0b0f',
      '#6366f1',
      '#ec4899',
      '#f59e0b',
      '#10b981',
      '#ef4444',
    ],
    mono: ['#111111', '#555555', '#888888', '#aaaaaa', '#cccccc'],
    sunset: ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16'],
    ocean: ['#0369a1', '#0284c7', '#0ea5e9', '#38bdf8', '#7dd3fc'],
    pastel: ['#c7d2fe', '#fbcfe8', '#fed7aa', '#bbf7d0', '#fecaca'],
  }
  const colors = Array.isArray(palette)
    ? palette
    : PALETTES[palette] || PALETTES.editorial
  const series = data[0] || {}
  const labels = series.labels || []
  const values = series.values || []
  const maxV = Math.max(1, ...values)

  const titleH = title ? 28 : 0
  const padL = 40,
    padR = 16,
    padB = 28,
    padT = 8 + titleH
  const chartX = px + padL
  const chartY = py + padT
  const chartW = pw - padL - padR
  const chartH = ph - padT - padB

  const parts = []
  if (title) {
    parts.push(
      `<text x="${px + 8}" y="${py + 22}" font-family="Fraunces, serif" font-size="18" fill="#0b0b0f">${escHtml(title)}</text>`,
    )
  }

  if (chartType === 'pie' || chartType === 'doughnut') {
    const cx = px + pw / 2,
      cy = chartY + chartH / 2
    const r = Math.min(chartW, chartH) / 2 - 4
    const inner = chartType === 'doughnut' ? r * 0.5 : 0
    const total = values.reduce((a, b) => a + b, 0) || 1
    let angle = -Math.PI / 2
    values.forEach((v, i) => {
      const a2 = angle + (v / total) * Math.PI * 2
      const x1 = cx + Math.cos(angle) * r
      const y1 = cy + Math.sin(angle) * r
      const x2 = cx + Math.cos(a2) * r
      const y2 = cy + Math.sin(a2) * r
      const large = a2 - angle > Math.PI ? 1 : 0
      let d
      if (inner > 0) {
        const ix1 = cx + Math.cos(angle) * inner
        const iy1 = cy + Math.sin(angle) * inner
        const ix2 = cx + Math.cos(a2) * inner
        const iy2 = cy + Math.sin(a2) * inner
        d = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${inner} ${inner} 0 ${large} 0 ${ix1} ${iy1} Z`
      } else {
        d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`
      }
      parts.push(`<path d="${d}" fill="${colors[i % colors.length]}"/>`)
      angle = a2
    })
  } else if (chartType === 'line' || chartType === 'area') {
    const step = chartW / Math.max(1, values.length - 1)
    const pts = values
      .map(
        (v, i) =>
          `${chartX + i * step},${chartY + chartH - (v / maxV) * chartH}`,
      )
      .join(' ')
    if (chartType === 'area') {
      parts.push(
        `<polygon points="${chartX},${chartY + chartH} ${pts} ${chartX + chartW},${chartY + chartH}" fill="${colors[0]}" opacity="0.3"/>`,
      )
    }
    parts.push(
      `<polyline points="${pts}" fill="none" stroke="${colors[0]}" stroke-width="2"/>`,
    )
    // x labels
    labels.forEach((lbl, i) => {
      parts.push(
        `<text x="${chartX + i * step}" y="${chartY + chartH + 16}" font-size="10" fill="#6b7280" text-anchor="middle" font-family="Inter, sans-serif">${escHtml(String(lbl))}</text>`,
      )
    })
  } else {
    // bar / column
    const barW = (chartW / values.length) * 0.7
    const gap = (chartW / values.length) * 0.3
    values.forEach((v, i) => {
      const bh = (v / maxV) * chartH
      const bx = chartX + i * (barW + gap) + gap / 2
      const by = chartY + chartH - bh
      parts.push(
        `<rect x="${bx}" y="${by}" width="${barW}" height="${bh}" fill="${colors[i % colors.length]}"/>`,
      )
      if (labels[i]) {
        parts.push(
          `<text x="${bx + barW / 2}" y="${chartY + chartH + 16}" font-size="10" fill="#6b7280" text-anchor="middle" font-family="Inter, sans-serif">${escHtml(String(labels[i]))}</text>`,
        )
      }
    })
  }

  // axes baseline
  parts.push(
    `<line x1="${chartX}" y1="${chartY + chartH}" x2="${chartX + chartW}" y2="${chartY + chartH}" stroke="#e5e7eb" stroke-width="1"/>`,
  )

  return `<g>${parts.join('')}</g>`
}

// ── Text ────────────────────────────────────────────────────
function renderText(op) {
  const { text, opts = {} } = op
  const {
    x = 0,
    y = 0,
    w = 2,
    h = 0.5,
    fontSize = 18,
    fontFace = 'Arial',
    color,
    bold,
    italic,
    underline,
    align = 'left',
    valign = 'top',
    charSpacing,
    lineSpacingMultiple,
  } = opts

  const px = x * PPI,
    py = y * PPI
  const pw = w * PPI,
    ph = h * PPI
  const fs = fontSize * 1.333 // pt → px approx (1pt = 1.333px)
  const fill = color ? `#${normalizeHex(color)}` : '#111111'
  const weight = bold ? 700 : 400
  const style = italic ? 'italic' : 'normal'
  const deco = underline ? 'underline' : 'none'
  const spacing = charSpacing ? charSpacing * 1.333 : 0

  // Multiple runs (array) or a simple string.
  const runs = Array.isArray(text)
    ? text.map((r) => ({ t: r.text || '', o: r.options || {} }))
    : [{ t: String(text), o: {} }]

  // Foreign object for correct text wrapping.
  const anchorCss =
    align === 'center' ? 'center' : align === 'right' ? 'right' : 'left'
  const justifyCss =
    align === 'center'
      ? 'center'
      : align === 'right'
        ? 'flex-end'
        : 'flex-start'
  const vAlignCss =
    valign === 'middle'
      ? 'center'
      : valign === 'bottom'
        ? 'flex-end'
        : 'flex-start'
  const lh = lineSpacingMultiple || 1.2

  const html = runs
    .map((r) => {
      const o = r.o
      const c = o.color ? `#${normalizeHex(o.color)}` : fill
      const b = o.bold !== undefined ? (o.bold ? 700 : 400) : weight
      const i =
        o.italic !== undefined ? (o.italic ? 'italic' : 'normal') : style
      const fsi = o.fontSize ? o.fontSize * 1.333 : fs
      return `<span style="color:${c};font-weight:${b};font-style:${i};font-size:${fsi}px">${escHtml(r.t)}</span>`
    })
    .join('')

  return `<foreignObject x="${px}" y="${py}" width="${pw}" height="${ph}">
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;display:flex;flex-direction:column;justify-content:${vAlignCss};align-items:${justifyCss};font-family:${escAttr(fontFace)},sans-serif;font-size:${fs}px;line-height:${lh};color:${fill};font-weight:${weight};font-style:${style};text-decoration:${deco};letter-spacing:${spacing}px;text-align:${anchorCss};white-space:pre-wrap;word-break:break-word;overflow:hidden;">${html}</div>
  </foreignObject>`
}

// ── Rect ────────────────────────────────────────────────────
function renderRect(op, defs, nextId) {
  const {
    x = 0,
    y = 0,
    w = 1,
    h = 1,
    fill,
    borderColor,
    borderWidth = 0,
    radius = 0,
    shadow,
    rotate,
  } = op
  const px = x * PPI,
    py = y * PPI
  const pw = w * PPI,
    ph = h * PPI
  const rx = radius * PPI
  const fillColor = fill
    ? `#${normalizeHex(typeof fill === 'string' ? fill : fill.color || '000000')}`
    : 'none'
  const stroke = borderColor ? `#${normalizeHex(borderColor)}` : 'none'
  const sw = borderWidth || 0

  let filterAttr = ''
  if (shadow) {
    const id = nextId()
    const blur = (shadow.blur ?? 10) / 2
    const dx =
      Math.sin(((shadow.angle ?? 90) * Math.PI) / 180) * (shadow.offset ?? 4)
    const dy =
      Math.cos(((shadow.angle ?? 90) * Math.PI) / 180) * (shadow.offset ?? 4)
    const sc = shadow.color ? normalizeHex(shadow.color) : '000000'
    const op2 = shadow.opacity ?? 0.4
    defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="${blur}"/>
      <feOffset dx="${dx}" dy="${dy}" result="off"/>
      <feFlood flood-color="#${sc}" flood-opacity="${op2}"/>
      <feComposite in2="off" operator="in"/>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>`)
    filterAttr = ` filter="url(#${id})"`
  }

  const transform = rotate
    ? ` transform="rotate(${rotate} ${px + pw / 2} ${py + ph / 2})"`
    : ''

  return `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="${rx}" ry="${rx}" fill="${fillColor}" stroke="${stroke}" stroke-width="${sw}"${filterAttr}${transform}/>`
}

// ── Generic shape ──────────────────────────────────────────
function renderShape(op) {
  const { type, opts = {} } = op
  const { x = 0, y = 0, w = 1, h = 1, fill } = opts
  const px = x * PPI,
    py = y * PPI
  const pw = w * PPI,
    ph = h * PPI
  const fc = fill
    ? `#${normalizeHex(typeof fill === 'string' ? fill : fill.color || '000000')}`
    : '#cccccc'

  const t = String(type).toLowerCase()
  if (t.includes('ellipse') || t.includes('oval')) {
    return `<ellipse cx="${px + pw / 2}" cy="${py + ph / 2}" rx="${pw / 2}" ry="${ph / 2}" fill="${fc}"/>`
  }
  if (t.includes('triangle')) {
    return `<polygon points="${px + pw / 2},${py} ${px},${py + ph} ${px + pw},${py + ph}" fill="${fc}"/>`
  }
  // fallback rect
  return `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="${fc}"/>`
}

// ── Line ───────────────────────────────────────────────────
function renderLine(op) {
  const { x1, y1, x2, y2, color = '#000000', width = 1 } = op
  return `<line x1="${x1 * PPI}" y1="${y1 * PPI}" x2="${x2 * PPI}" y2="${y2 * PPI}" stroke="#${normalizeHex(color)}" stroke-width="${width}"/>`
}

// ── Image ──────────────────────────────────────────────────
function renderImage(op) {
  const { x = 0, y = 0, w = 1, h = 1, data } = op
  if (!data) return ''
  return `<image href="${escAttr(data)}" x="${x * PPI}" y="${y * PPI}" width="${w * PPI}" height="${h * PPI}" preserveAspectRatio="none"/>`
}

// ── Utils ──────────────────────────────────────────────────
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
function escAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/&/g, '&amp;')
}
