import { svgToPngDataUrl, inchesToPx } from '../utils/svg'
import { normalizeHex } from '../utils/color'
import * as LucideIcons from 'lucide'

/**
 * Icon — rasterizes an SVG icon to a PNG that can be embedded in a slide.
 *
 * Accepts four input formats, ordered from simplest to lowest-level:
 *   1. name: 'arrow-right' or 'ArrowRight'                — Lucide lookup
 *   2. svg: '<svg>...</svg>'                              — raw markup
 *   3. lucide: [['path', {d:'...'}], ...]                 — Lucide children format
 *   4. paths: ['M12 2L2 7...', ...]                       — SVG path list
 *
 * Styling such as color and strokeWidth is applied uniformly.
 */

/** Converts 'arrow-right' or 'ArrowRight' to the Lucide key 'ArrowRight'. */
function lucideKey(name) {
  if (!name) return null
  if (/^[A-Z]/.test(name) && !name.includes('-')) return name
  return name
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join('')
}

/** Returns Lucide children for a name, or null when the icon is unknown. */
export function lookupLucide(name) {
  const key = lucideKey(name)
  if (!key) return null
  const icon = LucideIcons[key]
  if (!icon) return null
  // Lucide node format: array of [tag, attrs] or [tag, attrs, children]
  return icon
}
export function iconSvg({
  name, // 'arrow-right' | 'ArrowRight' — lookup Lucide
  svg, // raw SVG markup
  lucide, // format lucide-icons : array of [tag, attrs] children
  paths, // array de `d` strings
  color = '#000000',
  strokeWidth = 2,
  fill = 'none',
  widthPx = 64,
  heightPx = 64,
  viewBox = '0 0 24 24',
}) {
  const stroke = `#${normalizeHex(color)}`
  const fillColor = fill === 'none' || !fill ? 'none' : `#${normalizeHex(fill)}`

  // Case 1: Lucide name.
  if (name) {
    const children = lookupLucide(name)
    if (children) {
      const svgChildren = renderLucideChildren(children)
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${widthPx}" height="${heightPx}"
             fill="${fillColor}" stroke="${stroke}" stroke-width="${strokeWidth}"
             stroke-linecap="round" stroke-linejoin="round">${svgChildren}</svg>`
    }
    // Continue silently when the icon is missing; a warning is emitted below.
    // eslint-disable-next-line no-console
    console.warn(
      `[Slidewave:addIcon] Lucide icon "${name}" not found. See https://lucide.dev/icons`,
    )
  }

  // Case 2: provided raw SVG.
  if (svg) {
    return wrapColoredSvg(
      svg,
      stroke,
      fillColor,
      strokeWidth,
      widthPx,
      heightPx,
    )
  }

  // Case 3: Lucide node as a children array.
  if (lucide) {
    // Support both [['path', {...}], ...] and ['svg', attrs, children].
    const children =
      Array.isArray(lucide) && Array.isArray(lucide[2]) ? lucide[2] : lucide
    const svgChildren = renderLucideChildren(children)
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${widthPx}" height="${heightPx}"
             fill="${fillColor}" stroke="${stroke}" stroke-width="${strokeWidth}"
             stroke-linecap="round" stroke-linejoin="round">${svgChildren}</svg>`
  }

  // Case 4: path array.
  if (paths) {
    const pathEls = paths.map((d) => `<path d="${d}"/>`).join('')
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${widthPx}" height="${heightPx}"
             fill="${fillColor}" stroke="${stroke}" stroke-width="${strokeWidth}"
             stroke-linecap="round" stroke-linejoin="round">${pathEls}</svg>`
  }

  // Fallback: square placeholder.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${widthPx}" height="${heightPx}">
    <rect x="2" y="2" width="20" height="20" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"/>
  </svg>`
}

function renderLucideChildren(children) {
  return children
    .map((node) => {
      if (!Array.isArray(node)) return ''
      const [tag, attrs = {}] = node
      const attrStr = Object.entries(attrs)
        .map(([k, v]) => `${k}="${String(v).replace(/"/g, '&quot;')}"`)
        .join(' ')
      return `<${tag} ${attrStr}/>`
    })
    .join('')
}

function wrapColoredSvg(svgMarkup, stroke, fill, strokeWidth, w, h) {
  // Replace top-level stroke/fill attributes to recolor the icon.
  let cleaned = svgMarkup
    .replace(/\swidth="[^"]*"/g, '')
    .replace(/\sheight="[^"]*"/g, '')
  // Enforce attributes through a wrapper <g>.
  const inner = cleaned.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
  const vbMatch = svgMarkup.match(/viewBox="([^"]+)"/)
  const vb = vbMatch ? vbMatch[1] : '0 0 24 24'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}"
           fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"
           stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
}

export async function iconToPng(opts, widthInches, heightInches) {
  const wPx = inchesToPx(widthInches)
  const hPx = inchesToPx(heightInches)
  const svg = iconSvg({ ...opts, widthPx: wPx, heightPx: hPx })
  return svgToPngDataUrl(svg, wPx, hPx)
}
