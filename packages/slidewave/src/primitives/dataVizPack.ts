/**
 * Data Viz Pack — raster primitives for pitch decks and dashboards.
 *   - barRace      : horizontal bars with labels and values
 *   - radarChart   : multi-axis polygon radar chart
 *   - heatmap      : value-to-color grid
 *   - funnel       : conversion funnel made of trapezoids
 */
import { svgToPngDataUrl, inchesToPx } from '../utils/svg'
import { normalizeHex } from '../utils/color'

/* ─── BAR RACE (horizontal bar chart with labels) ──────────────────── */

export function barRaceSvg({
  widthPx = 800,
  heightPx = 500,
  data = [], // [{ label, value, color? }]
  trackColor = '#1f2937',
  trackOpacity = 0.18,
  barColor = '#6366f1',
  textColor = '#ffffff',
  valueColor = '#ffffff',
  fontFamily = 'Inter, system-ui, sans-serif',
  fontSize = null,
  rounded = true,
  padding = 20,
  showValue = true,
  valueFormat = null, // (v) => string
}) {
  if (!data.length)
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}"></svg>`
  const max = Math.max(...data.map((d) => d.value), 1)
  const fs = fontSize ?? Math.max(10, Math.round(heightPx / data.length / 3.5))
  const labelW = Math.max(100, widthPx * 0.22)
  const valueW = showValue ? 80 : 0
  const trackX = padding + labelW
  const trackW = widthPx - trackX - valueW - padding
  const rowH = (heightPx - padding * 2) / data.length
  const barH = rowH * 0.55
  const r = rounded ? barH / 2 : 0
  const fmt =
    valueFormat || ((v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)))
  const rows = data
    .map((d, i) => {
      const y = padding + i * rowH + (rowH - barH) / 2
      const w = (d.value / max) * trackW
      const fill = `#${normalizeHex(d.color || barColor)}`
      return `
      <text x="${padding}" y="${y + barH / 2}" font-family="${fontFamily}" font-size="${fs}" fill="#${normalizeHex(textColor)}" dominant-baseline="central">${escapeXml(d.label)}</text>
      <rect x="${trackX}" y="${y}" width="${trackW}" height="${barH}" rx="${r}" ry="${r}" fill="#${normalizeHex(trackColor)}" fill-opacity="${trackOpacity}"/>
      <rect x="${trackX}" y="${y}" width="${w.toFixed(1)}" height="${barH}" rx="${r}" ry="${r}" fill="${fill}"/>
      ${showValue ? `<text x="${trackX + trackW + 10}" y="${y + barH / 2}" font-family="${fontFamily}" font-size="${fs}" font-weight="600" fill="#${normalizeHex(valueColor)}" dominant-baseline="central">${escapeXml(fmt(d.value))}</text>` : ''}
    `
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">${rows}</svg>`
}

export async function barRaceToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    barRaceSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}

/* ─── RADAR CHART ──────────────────────────────────────────────────── */

export function radarChartSvg({
  widthPx = 600,
  heightPx = 600,
  axes = [], // ['Speed', 'Quality', ...]
  values = [], // [0..1, ...] or [[0..1], [0..1]] for two series
  rings = 4,
  axisColor = '#9ca3af',
  axisOpacity = 0.4,
  ringColor = '#9ca3af',
  ringOpacity = 0.18,
  fillColor = '#6366f1',
  fillOpacity = 0.45,
  strokeColor = '#6366f1',
  strokeWidth = 2,
  labelColor = '#1a1a1a',
  fontFamily = 'Inter, system-ui, sans-serif',
  fontSize = 13,
  bg = null,
}) {
  if (!axes.length)
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}"></svg>`
  const cx = widthPx / 2,
    cy = heightPx / 2
  const radius = Math.min(widthPx, heightPx) / 2 - 50
  const n = axes.length
  const angle = (i) => -Math.PI / 2 + (i / n) * Math.PI * 2
  const pt = (i, t) => [
    cx + Math.cos(angle(i)) * radius * t,
    cy + Math.sin(angle(i)) * radius * t,
  ]
  // rings
  const ringPaths = []
  for (let r = 1; r <= rings; r++) {
    const t = r / rings
    const pts = axes
      .map((_, i) =>
        pt(i, t)
          .map((n) => n.toFixed(1))
          .join(','),
      )
      .join(' ')
    ringPaths.push(
      `<polygon points="${pts}" fill="none" stroke="#${normalizeHex(ringColor)}" stroke-opacity="${ringOpacity}" stroke-width="1"/>`,
    )
  }
  // axes lines + labels
  const axisEls = axes
    .map((label, i) => {
      const [x2, y2] = pt(i, 1)
      const [lx, ly] = pt(i, 1.12)
      const anchor =
        Math.cos(angle(i)) > 0.2
          ? 'start'
          : Math.cos(angle(i)) < -0.2
            ? 'end'
            : 'middle'
      return `<line x1="${cx}" y1="${cy}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#${normalizeHex(axisColor)}" stroke-opacity="${axisOpacity}"/>
      <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-family="${fontFamily}" font-size="${fontSize}" fill="#${normalizeHex(labelColor)}" text-anchor="${anchor}" dominant-baseline="central">${escapeXml(label)}</text>`
    })
    .join('')
  // series
  const series = Array.isArray(values[0]) ? values : [values]
  const colors = Array.isArray(fillColor) ? fillColor : [fillColor]
  const strokes = Array.isArray(strokeColor) ? strokeColor : [strokeColor]
  const polygons = series
    .map((vals, k) => {
      const fc = colors[k] || colors[0]
      const sc = strokes[k] || strokes[0]
      const pts = vals
        .slice(0, n)
        .map((v, i) =>
          pt(i, Math.max(0, Math.min(1, v)))
            .map((n) => n.toFixed(1))
            .join(','),
        )
        .join(' ')
      return `<polygon points="${pts}" fill="#${normalizeHex(fc)}" fill-opacity="${fillOpacity}" stroke="#${normalizeHex(sc)}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`
    })
    .join('')
  const bgRect = bg
    ? `<rect width="${widthPx}" height="${heightPx}" fill="#${normalizeHex(bg)}"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">${bgRect}${ringPaths.join('')}${axisEls}${polygons}</svg>`
}

export async function radarChartToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    radarChartSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}

/* ─── HEATMAP ──────────────────────────────────────────────────────── */

export function heatmapSvg({
  widthPx = 800,
  heightPx = 400,
  data = [], // [[..], [..]] matrix (rows × columns)
  rowLabels = [],
  colLabels = [],
  colorLow = '#eef2ff',
  colorHigh = '#4338ca',
  textColor = '#1a1a1a',
  cellGap = 4,
  cornerRadius = 6,
  fontFamily = 'Inter, system-ui, sans-serif',
  fontSize = 12,
  showValues = false,
  bg = null,
}) {
  if (!data.length)
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}"></svg>`
  const rows = data.length
  const cols = Math.max(...data.map((r) => r.length))
  const labelW = rowLabels.length ? 80 : 0
  const labelH = colLabels.length ? 28 : 0
  const padding = 8
  const gridW = widthPx - labelW - padding * 2
  const gridH = heightPx - labelH - padding * 2
  const cellW = (gridW - (cols - 1) * cellGap) / cols
  const cellH = (gridH - (rows - 1) * cellGap) / rows
  const flat = data.flat()
  const max = Math.max(...flat, 0.0001)
  const min = Math.min(...flat, 0)
  const lerpColor = (t) => mixHex(colorLow, colorHigh, t)
  const cells = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < (data[r] || []).length; c++) {
      const v = data[r][c]
      const t = (v - min) / (max - min || 1)
      const x = labelW + padding + c * (cellW + cellGap)
      const y = labelH + padding + r * (cellH + cellGap)
      cells.push(
        `<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="${cornerRadius}" fill="${lerpColor(t)}"/>`,
      )
      if (showValues) {
        cells.push(
          `<text x="${x + cellW / 2}" y="${y + cellH / 2}" font-family="${fontFamily}" font-size="${fontSize}" fill="#${normalizeHex(textColor)}" text-anchor="middle" dominant-baseline="central" font-weight="600">${escapeXml(String(v))}</text>`,
        )
      }
    }
  }
  const colHeaders = colLabels
    .map((l, c) => {
      const x = labelW + padding + c * (cellW + cellGap) + cellW / 2
      return `<text x="${x}" y="${labelH / 2 + 4}" font-family="${fontFamily}" font-size="${fontSize}" fill="#${normalizeHex(textColor)}" text-anchor="middle">${escapeXml(l)}</text>`
    })
    .join('')
  const rowHeaders = rowLabels
    .map((l, r) => {
      const y = labelH + padding + r * (cellH + cellGap) + cellH / 2
      return `<text x="${labelW - 8}" y="${y}" font-family="${fontFamily}" font-size="${fontSize}" fill="#${normalizeHex(textColor)}" text-anchor="end" dominant-baseline="central">${escapeXml(l)}</text>`
    })
    .join('')
  const bgRect = bg
    ? `<rect width="${widthPx}" height="${heightPx}" fill="#${normalizeHex(bg)}"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">${bgRect}${colHeaders}${rowHeaders}${cells.join('')}</svg>`
}

export async function heatmapToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    heatmapSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}

/* ─── FUNNEL ───────────────────────────────────────────────────────── */

export function funnelSvg({
  widthPx = 700,
  heightPx = 500,
  stages = [], // [{ label, value, color? }]
  palette = ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899'],
  textColor = '#ffffff',
  labelColor = '#1a1a1a',
  fontFamily = 'Inter, system-ui, sans-serif',
  fontSize = 14,
  gap = 6,
  bg = null,
  showValues = true,
}) {
  if (!stages.length)
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}"></svg>`
  const max = Math.max(...stages.map((s) => s.value), 1)
  const labelW = 120
  const padding = 16
  const funnelW = widthPx - labelW - padding * 2
  const cx = labelW + padding + funnelW / 2
  const stageH =
    (heightPx - padding * 2 - gap * (stages.length - 1)) / stages.length
  let y = padding
  const polys = stages
    .map((s, i) => {
      const t1 = stages[i].value / max
      const t2 = (stages[i + 1]?.value ?? stages[i].value * 0.6) / max
      const w1 = funnelW * t1
      const w2 = funnelW * t2
      const x1 = cx - w1 / 2,
        x2 = cx + w1 / 2
      const x3 = cx + w2 / 2,
        x4 = cx - w2 / 2
      const fill = s.color || palette[i % palette.length]
      const points = `${x1.toFixed(1)},${y.toFixed(1)} ${x2.toFixed(1)},${y.toFixed(1)} ${x3.toFixed(1)},${(y + stageH).toFixed(1)} ${x4.toFixed(1)},${(y + stageH).toFixed(1)}`
      const cy = y + stageH / 2
      const valTxt = showValues
        ? `<text x="${cx}" y="${cy}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="700" fill="#${normalizeHex(textColor)}" text-anchor="middle" dominant-baseline="central">${escapeXml(String(s.value))}</text>`
        : ''
      const lblTxt = `<text x="${labelW + padding - 10}" y="${cy}" font-family="${fontFamily}" font-size="${fontSize}" fill="#${normalizeHex(labelColor)}" text-anchor="end" dominant-baseline="central">${escapeXml(s.label)}</text>`
      const out = `<polygon points="${points}" fill="#${normalizeHex(fill)}"/>${valTxt}${lblTxt}`
      y += stageH + gap
      return out
    })
    .join('')
  const bgRect = bg
    ? `<rect width="${widthPx}" height="${heightPx}" fill="#${normalizeHex(bg)}"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">${bgRect}${polys}</svg>`
}

export async function funnelToPng(opts, wIn, hIn) {
  const wPx = inchesToPx(wIn),
    hPx = inchesToPx(hIn)
  return svgToPngDataUrl(
    funnelSvg({ ...opts, widthPx: wPx, heightPx: hPx }),
    wPx,
    hPx,
  )
}

/* ─── helpers ──────────────────────────────────────────────────────── */

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

function mixHex(a, b, t) {
  const ah = normalizeHex(a),
    bh = normalizeHex(b)
  const ar = parseInt(ah.slice(0, 2), 16),
    ag = parseInt(ah.slice(2, 4), 16),
    ab = parseInt(ah.slice(4, 6), 16)
  const br = parseInt(bh.slice(0, 2), 16),
    bg = parseInt(bh.slice(2, 4), 16),
    bb = parseInt(bh.slice(4, 6), 16)
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`
}
