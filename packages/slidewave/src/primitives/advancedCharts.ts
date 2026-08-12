/**
 * Advanced Charts Pack v0.6 — data visualizations that PowerPoint cannot create natively.
 *   - sankeyDiagram    : flow between nodes (Sankey/alluvial)
 *   - treemap          : proportional hierarchical rectangles
 *   - bubbleChart      : proportional circle cloud (size = value)
 *   - ganttChart       : dated horizontal-bar schedule
 *   - orgChart         : organizational hierarchy with boxes and connectors
 *   - waterfallChart   : cumulative change (green positive / red negative)
 *   - calendarHeatmap  : GitHub-style activity (52 weeks × 7 days)
 */
import { svgToPngDataUrl, inchesToPx } from '../utils/svg'
import { normalizeHex } from '../utils/color'

/* ─── SANKEY DIAGRAM ────────────────────────────────────────────────── */
/**
 * nodes: [{ id, label, color? }]
 * links: [{ source (id), target (id), value }]
 */
export function sankeySvg({
  widthPx = 1000,
  heightPx = 600,
  nodes = [],
  links = [],
  nodeWidth = 18,
  nodePadding = 18,
  palette = [
    '#7C3AED',
    '#3B82F6',
    '#10B981',
    '#F59E0B',
    '#EF4444',
    '#EC4899',
    '#06B6D4',
    '#8B5CF6',
  ],
  fontFamily = 'Inter, system-ui, sans-serif',
  fontSize = 12,
  fontColor = '#1a1a1a',
  bg = null,
  linkOpacity = 0.35,
}) {
  if (!nodes.length || !links.length) return emptysvg(widthPx, heightPx)
  // Simple layout with one source column and one target column.
  const pad = 40
  const srcNodes = [...new Set(links.map((l) => l.source))]
  const tgtNodes = [...new Set(links.map((l) => l.target))]
  const allNodes = [...new Set([...srcNodes, ...tgtNodes])]

  const colorMap = {}
  allNodes.forEach((n, i) => {
    const found = nodes.find((nd) => nd.id === n)
    colorMap[n] = found?.color || palette[i % palette.length]
  })

  const srcTotal = (id) =>
    links.filter((l) => l.source === id).reduce((a, l) => a + l.value, 0)
  const tgtTotal = (id) =>
    links.filter((l) => l.target === id).reduce((a, l) => a + l.value, 0)

  const totalValue = links.reduce((a, l) => a + l.value, 0)
  const drawH = heightPx - pad * 2

  // Position source and target columns.
  const srcH = drawH - nodePadding * (srcNodes.length - 1)
  const tgtH = drawH - nodePadding * (tgtNodes.length - 1)

  const scale = (v, total, availH) => (v / total) * availH

  let srcY = pad
  const srcPos = {}
  srcNodes.forEach((id) => {
    const h = scale(srcTotal(id), totalValue, srcH)
    srcPos[id] = { x: pad, y: srcY, h }
    srcY += h + nodePadding
  })

  let tgtY = pad
  const tgtPos = {}
  tgtNodes.forEach((id) => {
    const h = scale(tgtTotal(id), totalValue, tgtH)
    tgtPos[id] = { x: widthPx - pad - nodeWidth, y: tgtY, h }
    tgtY += h + nodePadding
  })

  // Draw flow bands.
  const srcOffset = { ...Object.fromEntries(srcNodes.map((id) => [id, 0])) }
  const tgtOffset = { ...Object.fromEntries(tgtNodes.map((id) => [id, 0])) }

  const paths = links.map((l) => {
    const src = srcPos[l.source],
      tgt = tgtPos[l.target]
    if (!src || !tgt) return ''
    const sw = scale(l.value, totalValue, src.h) // source width
    const tw = scale(l.value, totalValue, tgt.h)
    const sy0 = src.y + srcOffset[l.source]
    const ty0 = tgt.y + tgtOffset[l.target]
    srcOffset[l.source] += sw
    tgtOffset[l.target] += tw
    const x1 = pad + nodeWidth,
      x2 = widthPx - pad - nodeWidth
    const cpx = (x1 + x2) / 2
    const color = colorMap[l.source]
    return `<path d="M${x1},${sy0.toFixed(1)} C${cpx},${sy0.toFixed(1)} ${cpx},${ty0.toFixed(1)} ${x2},${ty0.toFixed(1)}
      L${x2},${(ty0 + tw).toFixed(1)} C${cpx},${(ty0 + tw).toFixed(1)} ${cpx},${(sy0 + sw).toFixed(1)} ${x1},${(sy0 + sw).toFixed(1)} Z"
      fill="#${normalizeHex(color)}" opacity="${linkOpacity}"/>`
  })

  // Nodes.
  const nodeRects = [
    ...srcNodes.map((id) => {
      const p = srcPos[id]
      const label = nodes.find((n) => n.id === id)?.label || id
      return `<rect x="${p.x}" y="${p.y.toFixed(1)}" width="${nodeWidth}" height="${p.h.toFixed(1)}" fill="#${normalizeHex(colorMap[id])}" rx="3"/>
        <text x="${pad + nodeWidth + 6}" y="${(p.y + p.h / 2).toFixed(1)}" font-family="${fontFamily}" font-size="${fontSize}" fill="#${normalizeHex(fontColor)}" dominant-baseline="central">${escapeXml(label)}</text>`
    }),
    ...tgtNodes.map((id) => {
      const p = tgtPos[id]
      const label = nodes.find((n) => n.id === id)?.label || id
      return `<rect x="${p.x}" y="${p.y.toFixed(1)}" width="${nodeWidth}" height="${p.h.toFixed(1)}" fill="#${normalizeHex(colorMap[id])}" rx="3"/>
        <text x="${p.x - 6}" y="${(p.y + p.h / 2).toFixed(1)}" font-family="${fontFamily}" font-size="${fontSize}" fill="#${normalizeHex(fontColor)}" dominant-baseline="central" text-anchor="end">${escapeXml(label)}</text>`
    }),
  ]

  const bgRect = bg
    ? `<rect width="${widthPx}" height="${heightPx}" fill="#${normalizeHex(bg)}"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
    ${bgRect}${paths.join('')}${nodeRects.join('')}
  </svg>`
}

export async function sankeyToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    sankeySvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}

/* ─── TREEMAP ──────────────────────────────────────────────────────── */
/**
 * data: [{ label, value, color? }] — simplified squarified algorithm
 */
export function treemapSvg({
  widthPx = 900,
  heightPx = 600,
  data = [],
  palette = [
    '#7C3AED',
    '#8B5CF6',
    '#A855F7',
    '#C084FC',
    '#DDD6FE',
    '#3B82F6',
    '#60A5FA',
    '#93C5FD',
  ],
  fontFamily = 'Inter, system-ui, sans-serif',
  fontSize = 14,
  fontColor = '#ffffff',
  gap = 3,
  bg = null,
  showValues = true,
  radius = 4,
}) {
  if (!data.length) return emptysvg(widthPx, heightPx)
  const total = data.reduce((a, d) => a + d.value, 0)
  const sorted = [...data].sort((a, b) => b.value - a.value)
  const pad = 0

  // Naive horizontal subdivision, sufficient for editorial use.
  const rects = []
  const layoutRow = (items, x, y, w, h) => {
    if (!items.length) return
    if (items.length === 1) {
      rects.push({ ...items[0], x, y, w, h })
      return
    }
    const half = Math.ceil(items.length / 2)
    const firstSum = items.slice(0, half).reduce((a, d) => a + d.value, 0)
    const ratio = firstSum / items.reduce((a, d) => a + d.value, 0)
    if (w > h) {
      layoutRow(items.slice(0, half), x, y, w * ratio - gap, h)
      layoutRow(
        items.slice(half),
        x + w * ratio + gap / 2,
        y,
        w * (1 - ratio) - gap / 2,
        h,
      )
    } else {
      layoutRow(items.slice(0, half), x, y, w, h * ratio - gap)
      layoutRow(
        items.slice(half),
        x,
        y + h * ratio + gap / 2,
        w,
        h * (1 - ratio) - gap / 2,
      )
    }
  }

  layoutRow(sorted, pad, pad, widthPx - pad * 2, heightPx - pad * 2)

  const cells = rects.map((r, i) => {
    const fill = r.color || palette[i % palette.length]
    const fs = Math.max(9, Math.min(fontSize, r.h * 0.28, r.w * 0.18))
    const valText =
      showValues && r.w > 60
        ? `<text x="${(r.x + r.w / 2).toFixed(0)}" y="${(r.y + r.h / 2 + fs * 0.7).toFixed(0)}" font-family="${fontFamily}" font-size="${Math.round(fs * 0.75)}" fill="${fontColor}" fill-opacity="0.7" text-anchor="middle">${r.value.toLocaleString()}</text>`
        : ''
    const label =
      r.w > 40 && r.h > 28
        ? `<text x="${(r.x + r.w / 2).toFixed(0)}" y="${(r.y + r.h / 2).toFixed(0)}" font-family="${fontFamily}" font-size="${fs.toFixed(1)}" font-weight="600" fill="${fontColor}" text-anchor="middle" dominant-baseline="central">${escapeXml(r.label)}</text>`
        : ''
    return `<rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${Math.max(0, r.w).toFixed(1)}" height="${Math.max(0, r.h).toFixed(1)}" fill="#${normalizeHex(fill)}" rx="${radius}"/>${label}${valText}`
  })

  const bgRect = bg
    ? `<rect width="${widthPx}" height="${heightPx}" fill="#${normalizeHex(bg)}"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">${bgRect}${cells.join('')}</svg>`
}

export async function treemapToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    treemapSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}

/* ─── BUBBLE CHART ─────────────────────────────────────────────────── */
/**
 * bubbles: [{ label, value, x?, y?, color? }] — value maps to radius
 */
export function bubbleChartSvg({
  widthPx = 900,
  heightPx = 600,
  bubbles = [],
  palette = ['#7C3AED', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899'],
  fontFamily = 'Inter, system-ui, sans-serif',
  fontSize = 13,
  fontColor = '#ffffff',
  bg = null,
  minR = 24,
  maxR = 110,
  showLabels = true,
  seed = 42,
}) {
  if (!bubbles.length) return emptysvg(widthPx, heightPx)
  let s = seed >>> 0
  const rng = () => {
    s ^= s << 13
    s ^= s >> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }

  const max = Math.max(...bubbles.map((b) => b.value))
  const min = Math.min(...bubbles.map((b) => b.value))

  const placed = bubbles.map((b, i) => {
    const t = max === min ? 0.5 : (b.value - min) / (max - min)
    const r = minR + t * (maxR - minR)
    const x = b.x != null ? b.x * widthPx : rng() * (widthPx - r * 2) + r
    const y = b.y != null ? b.y * heightPx : rng() * (heightPx - r * 2) + r
    const fill = b.color || palette[i % palette.length]
    return { ...b, r, x, y, fill }
  })

  const circles = placed.map((b) => {
    const fs = Math.max(9, Math.min(fontSize, b.r * 0.45))
    const label = showLabels
      ? `<text x="${b.x.toFixed(0)}" y="${b.y.toFixed(0)}" font-family="${fontFamily}" font-size="${fs.toFixed(1)}" font-weight="600" fill="#${normalizeHex(fontColor)}" text-anchor="middle" dominant-baseline="central">${escapeXml(b.label)}</text>`
      : ''
    return `<circle cx="${b.x.toFixed(0)}" cy="${b.y.toFixed(0)}" r="${b.r.toFixed(1)}" fill="#${normalizeHex(b.fill)}" opacity="0.9"/>${label}`
  })

  const bgRect = bg
    ? `<rect width="${widthPx}" height="${heightPx}" fill="#${normalizeHex(bg)}"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">${bgRect}${circles.join('')}</svg>`
}

export async function bubbleChartToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    bubbleChartSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}

/* ─── GANTT CHART ──────────────────────────────────────────────────── */
/**
 * tasks: [{ label, start (0..1), end (0..1), color?, group? }]
 */
export function ganttChartSvg({
  widthPx = 1100,
  heightPx = 500,
  tasks = [],
  palette = ['#7C3AED', '#3B82F6', '#10B981', '#F59E0B', '#EF4444'],
  fontFamily = 'Inter, system-ui, sans-serif',
  fontSize = 12,
  fontColor = '#1a1a1a',
  trackColor = '#F3F4F6',
  headerLabels = [], // ex: ['Q1','Q2','Q3','Q4']
  bg = null,
  barRadius = 6,
  barOpacity = 1,
}) {
  if (!tasks.length) return emptysvg(widthPx, heightPx)
  const labelW = 160,
    pad = 16
  const headerH = headerLabels.length ? 32 : 0
  const rowH = Math.max(28, (heightPx - headerH - pad * 2) / tasks.length)
  const trackW = widthPx - labelW - pad

  // Header
  const headers = headerLabels
    .map((lbl, i) => {
      const x = labelW + (i / headerLabels.length) * trackW
      const w = trackW / headerLabels.length
      return `<rect x="${x}" y="${pad}" width="${w}" height="${headerH}" fill="${i % 2 === 0 ? '#F9FAFB' : '#F3F4F6'}" opacity="0.5"/>
      <text x="${(x + w / 2).toFixed(0)}" y="${pad + headerH / 2}" font-family="${fontFamily}" font-size="${fontSize}" fill="#6B7280" text-anchor="middle" dominant-baseline="central">${escapeXml(lbl)}</text>
      <line x1="${x}" y1="${pad}" x2="${x}" y2="${heightPx - pad}" stroke="#E5E7EB" stroke-width="1"/>`
    })
    .join('')

  const rows = tasks
    .map((t, i) => {
      const y = pad + headerH + i * rowH
      const x = labelW + t.start * trackW
      const w = (t.end - t.start) * trackW
      const fill = t.color || palette[i % palette.length]
      return `
      <rect x="${labelW}" y="${y + 2}" width="${trackW}" height="${rowH - 4}" fill="${trackColor}" rx="${barRadius}"/>
      <rect x="${x.toFixed(1)}" y="${y + 5}" width="${Math.max(4, w).toFixed(1)}" height="${rowH - 10}" fill="#${normalizeHex(fill)}" rx="${barRadius}" opacity="${barOpacity}"/>
      <text x="${pad}" y="${y + rowH / 2}" font-family="${fontFamily}" font-size="${fontSize}" fill="#${normalizeHex(fontColor)}" dominant-baseline="central">${escapeXml(t.label)}</text>
    `
    })
    .join('')

  const bgRect = bg
    ? `<rect width="${widthPx}" height="${heightPx}" fill="#${normalizeHex(bg)}"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">${bgRect}${headers}${rows}</svg>`
}

export async function ganttChartToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    ganttChartSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}

/* ─── ORG CHART ────────────────────────────────────────────────────── */
/**
 * nodes: [{ id, label, role?, parentId?, color? }]
 */
export function orgChartSvg({
  widthPx = 1000,
  heightPx = 600,
  nodes = [],
  accentColor = '#7C3AED',
  fontFamily = 'Inter, system-ui, sans-serif',
  fontSize = 13,
  fontColor = '#1a1a1a',
  bg = null,
  boxW = 160,
  boxH = 54,
  levelGap = 90,
  siblingGap = 20,
}) {
  if (!nodes.length) return emptysvg(widthPx, heightPx)

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))
  const children = (id) => nodes.filter((n) => n.parentId === id)
  const roots = nodes.filter((n) => !n.parentId)

  // Assign positions recursively
  const positions: Record<string, { x?: number; y?: number }> = {}
  const assignX = (id, x) => {
    const kids = children(id)
    if (!kids.length) {
      positions[id] = { ...positions[id], x }
      return boxW
    }
    let totalW = 0
    const kidWidths = kids.map((k) => {
      const w = assignX(k.id, 0)
      return w
    })
    kidWidths.forEach((w) => (totalW += w + siblingGap))
    totalW -= siblingGap
    let kx = x - totalW / 2 + boxW / 2
    kids.forEach((k, i) => {
      positions[k.id] = { ...positions[k.id], x: kx }
      kx += kidWidths[i] + siblingGap
    })
    positions[id] = { ...positions[id], x }
    return totalW
  }
  const assignY = (id, depth) => {
    positions[id] = { ...positions[id], y: depth * (boxH + levelGap) }
    children(id).forEach((k) => assignY(k.id, depth + 1))
  }

  const totalRootW =
    roots.reduce((a, r) => {
      const w = assignX(r.id, 0)
      return a + w + siblingGap
    }, 0) - siblingGap

  let rx = widthPx / 2
  roots.forEach((r, i) => {
    positions[r.id] = { x: rx, y: 0 }
    assignY(r.id, 0)
    rx += boxW + siblingGap * 2
  })
  roots.forEach((r) => assignY(r.id, 0))

  // Normalize to fit
  const allX = Object.values(positions).map((p) => p.x)
  const allY = Object.values(positions).map((p) => p.y)
  const minX = Math.min(...allX),
    maxX = Math.max(...allX)
  const maxY = Math.max(...allY)
  const rangeX = maxX - minX + boxW
  const rangeY = maxY + boxH
  const scaleX = (widthPx - 40) / (rangeX || 1)
  const scaleY = (heightPx - 40) / (rangeY || 1)
  const sc = Math.min(scaleX, scaleY, 1)
  Object.keys(positions).forEach((id) => {
    positions[id].x = 20 + (positions[id].x - minX) * sc
    positions[id].y = 20 + positions[id].y * sc
  })
  const bw = boxW * sc,
    bh = boxH * sc

  // Draw connections
  const lines = nodes
    .filter((n) => n.parentId && positions[n.id] && positions[n.parentId])
    .map((n) => {
      const p = positions[n.id],
        pp = positions[n.parentId]
      const x1 = pp.x + bw / 2,
        y1 = pp.y + bh
      const x2 = p.x + bw / 2,
        y2 = p.y
      const mid = (y1 + y2) / 2
      return `<path d="M${x1.toFixed(0)},${y1.toFixed(0)} C${x1.toFixed(0)},${mid.toFixed(0)} ${x2.toFixed(0)},${mid.toFixed(0)} ${x2.toFixed(0)},${y2.toFixed(0)}" fill="none" stroke="#${normalizeHex(accentColor)}" stroke-opacity="0.5" stroke-width="1.5"/>`
    })

  const boxes = nodes
    .filter((n) => positions[n.id])
    .map((n, i) => {
      const { x, y } = positions[n.id]
      const fill = n.color || accentColor
      const fs = Math.max(9, Math.min(fontSize * sc, fontSize))
      return `
      <rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${bw.toFixed(0)}" height="${bh.toFixed(0)}" fill="#${normalizeHex(fill)}" opacity="0.15" rx="6"/>
      <rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="4" height="${bh.toFixed(0)}" fill="#${normalizeHex(fill)}" rx="2"/>
      <text x="${(x + bw / 2).toFixed(0)}" y="${(y + bh * 0.38).toFixed(0)}" font-family="${fontFamily}" font-size="${fs.toFixed(1)}" font-weight="700" fill="#${normalizeHex(fontColor)}" text-anchor="middle">${escapeXml(n.label)}</text>
      ${n.role ? `<text x="${(x + bw / 2).toFixed(0)}" y="${(y + bh * 0.68).toFixed(0)}" font-family="${fontFamily}" font-size="${(fs * 0.8).toFixed(1)}" fill="#6B7280" text-anchor="middle">${escapeXml(n.role)}</text>` : ''}
    `
    })

  const bgRect = bg
    ? `<rect width="${widthPx}" height="${heightPx}" fill="#${normalizeHex(bg)}"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">${bgRect}${lines.join('')}${boxes.join('')}</svg>`
}

export async function orgChartToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    orgChartSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}

/* ─── WATERFALL CHART ──────────────────────────────────────────────── */
/**
 * items: [{ label, value }] — positive = increase, negative = decrease, 'total' = recompute
 */
export function waterfallChartSvg({
  widthPx = 1000,
  heightPx = 500,
  items = [],
  upColor = '#10B981',
  downColor = '#EF4444',
  totalColor = '#7C3AED',
  fontFamily = 'Inter, system-ui, sans-serif',
  fontSize = 12,
  fontColor = '#1a1a1a',
  bg = null,
  padding = 24,
  barGap = 0.25,
  showValues = true,
  showConnectors = true,
}) {
  if (!items.length) return emptysvg(widthPx, heightPx)
  let running = 0
  const bars = items.map((item, i) => {
    const isTotal = item.total === true
    const start = isTotal ? 0 : running
    const val = item.value
    if (!isTotal) running += val
    const end = isTotal ? running : running
    return { ...item, start, end: isTotal ? end : start + val, isTotal }
  })

  const allVals = bars.flatMap((b) => [b.start, b.end])
  const minV = Math.min(0, ...allVals),
    maxV = Math.max(0, ...allVals)
  const range = maxV - minV || 1
  const colW = (widthPx - padding * 2) / bars.length
  const barW = colW * (1 - barGap)
  const chartH = heightPx - padding * 3
  const toY = (v) => padding + chartH * (1 - (v - minV) / range)

  const rects = bars.map((b, i) => {
    const x = padding + i * colW + (colW * barGap) / 2
    const y1 = toY(Math.max(b.start, b.end))
    const y2 = toY(Math.min(b.start, b.end))
    const h = Math.max(2, y2 - y1)
    const fill = b.isTotal ? totalColor : b.end > b.start ? upColor : downColor
    const val = b.isTotal ? b.end : b.value
    const valTxt = showValues
      ? `<text x="${(x + barW / 2).toFixed(0)}" y="${(y1 - 5).toFixed(0)}" font-family="${fontFamily}" font-size="${fontSize}" fill="#${normalizeHex(fontColor)}" text-anchor="middle" font-weight="600">${val > 0 ? '+' : ''}${val}</text>`
      : ''
    const lblTxt = `<text x="${(x + barW / 2).toFixed(0)}" y="${heightPx - padding / 2}" font-family="${fontFamily}" font-size="${fontSize}" fill="#${normalizeHex(fontColor)}" text-anchor="middle">${escapeXml(b.label)}</text>`
    const connector =
      showConnectors && i > 0 && !bars[i - 1].isTotal
        ? `<line x1="${(padding + (i - 1) * colW + barW + (colW * barGap) / 2).toFixed(0)}" y1="${toY(b.start).toFixed(0)}" x2="${x.toFixed(0)}" y2="${toY(b.start).toFixed(0)}" stroke="#D1D5DB" stroke-width="1" stroke-dasharray="4 2"/>`
        : ''
    return `${connector}<rect x="${x.toFixed(0)}" y="${y1.toFixed(0)}" width="${barW.toFixed(0)}" height="${h.toFixed(0)}" fill="#${normalizeHex(fill)}" rx="3"/>${valTxt}${lblTxt}`
  })

  // Zero line
  const zeroY = toY(0)
  const bgRect = bg
    ? `<rect width="${widthPx}" height="${heightPx}" fill="#${normalizeHex(bg)}"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
    ${bgRect}
    <line x1="${padding}" y1="${zeroY.toFixed(0)}" x2="${widthPx - padding}" y2="${zeroY.toFixed(0)}" stroke="#9CA3AF" stroke-width="1"/>
    ${rects.join('')}
  </svg>`
}

export async function waterfallChartToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    waterfallChartSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}

/* ─── CALENDAR HEATMAP (GitHub style) ─────────────────────────────── */
/**
 * data: { 'YYYY-MM-DD': value } — displays 52 weeks
 */
export function calendarHeatmapSvg({
  widthPx = 900,
  heightPx = 180,
  data = {},
  colorLow = '#eef2ff',
  colorHigh = '#4338ca',
  cellSize = null, // auto si null
  cellGap = 3,
  startDate = null, // Date or null to begin 52 weeks before today
  fontFamily = 'Inter, system-ui, sans-serif',
  fontSize = 10,
  fontColor = '#6B7280',
  bg = null,
  monthLabels = true,
  dayLabels = true,
}) {
  const DAY_MS = 86400000
  const now = startDate ? new Date(startDate) : new Date()
  // Start on the Monday from 52 weeks ago.
  const start = new Date(now.getTime() - 52 * 7 * DAY_MS)
  // Move backward to Monday.
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))

  const weeks = 53
  const days = 7
  const labelW = dayLabels ? 24 : 0
  const labelH = monthLabels ? 20 : 0
  const cs = cellSize ?? Math.floor((widthPx - labelW) / weeks) - cellGap
  const actualW = cs + cellGap

  const vals = (Object.values(data) as number[]).filter((v) => v > 0)
  const maxVal = Math.max(...vals, 1)

  const lerpHex = (t) => {
    const ah = normalizeHex(colorLow),
      bh = normalizeHex(colorHigh)
    const ar = parseInt(ah.slice(0, 2), 16),
      ag = parseInt(ah.slice(2, 4), 16),
      ab = parseInt(ah.slice(4, 6), 16)
    const br = parseInt(bh.slice(0, 2), 16),
      bg2 = parseInt(bh.slice(2, 4), 16),
      bb = parseInt(bh.slice(4, 6), 16)
    const r = Math.round(ar + (br - ar) * t),
      g = Math.round(ag + (bg2 - ag) * t),
      b = Math.round(ab + (bb - ab) * t)
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
  }

  const cells = []
  const monthsSeen = new Set()
  const monthLbls = []

  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < days; d++) {
      const date = new Date(start.getTime() + (w * 7 + d) * DAY_MS)
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      const val = data[key] || 0
      const t = val / maxVal
      const fill = lerpHex(t)
      const x = labelW + w * actualW
      const y = labelH + d * actualW
      cells.push(
        `<rect x="${x}" y="${y}" width="${cs}" height="${cs}" fill="${fill}" rx="2"/>`,
      )
      // Month label
      if (monthLabels && d === 0) {
        const monthKey = `${date.getFullYear()}-${date.getMonth()}`
        if (!monthsSeen.has(monthKey)) {
          monthsSeen.add(monthKey)
          const months = [
            'Jan',
            'Feb',
            'Mar',
            'Apr',
            'May',
            'Jun',
            'Jul',
            'Aug',
            'Sep',
            'Oct',
            'Nov',
            'Dec',
          ]
          monthLbls.push(
            `<text x="${x}" y="${labelH - 4}" font-family="${fontFamily}" font-size="${fontSize}" fill="#${normalizeHex(fontColor)}">${months[date.getMonth()]}</text>`,
          )
        }
      }
    }
  }

  const dayLblEls = dayLabels
    ? ['M', '', 'W', '', 'F', '', 'S']
        .map((l, i) =>
          l
            ? `<text x="${labelW - 4}" y="${labelH + i * actualW + cs / 2}" font-family="${fontFamily}" font-size="${fontSize}" fill="#${normalizeHex(fontColor)}" text-anchor="end" dominant-baseline="central">${l}</text>`
            : '',
        )
        .join('')
    : ''

  const bgRect = bg
    ? `<rect width="${widthPx}" height="${heightPx}" fill="#${normalizeHex(bg)}"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
    ${bgRect}${monthLbls.join('')}${dayLblEls}${cells.join('')}
  </svg>`
}

export async function calendarHeatmapToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    calendarHeatmapSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}

/* ─── helpers ──────────────────────────────────────────────────────── */
function emptysvg(w, h) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"></svg>`
}
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
