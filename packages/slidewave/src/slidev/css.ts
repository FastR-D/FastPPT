import type { HtmlColor, HtmlGradient } from './types'
import { cssFontFamilies } from './font-family'

export { cssFontFamilies } from './font-family'

const NAMED_COLORS: Record<string, string> = {
  black: '000000',
  blue: '0000FF',
  gray: '808080',
  green: '008000',
  grey: '808080',
  red: 'FF0000',
  transparent: '000000',
  white: 'FFFFFF',
}

export function parseCssColor(
  value: string | null | undefined,
): HtmlColor | null {
  if (!value) return null
  const color = value.trim().toLowerCase()
  if (!color || color === 'none') return null

  if (color in NAMED_COLORS) {
    return {
      hex: NAMED_COLORS[color]!,
      alpha: color === 'transparent' ? 0 : 1,
    }
  }

  const hex = color.match(/^#([0-9a-f]{3,8})$/i)?.[1]
  if (hex) return parseHexColor(hex)

  const rgb = color.match(
    /^rgba?\(\s*([\d.]+)(?:\s+|\s*,\s*)([\d.]+)(?:\s+|\s*,\s*)([\d.]+)(?:\s*(?:\/|,)\s*([\d.]+%?))?\s*\)$/i,
  )
  if (rgb) {
    return {
      hex: [rgb[1], rgb[2], rgb[3]]
        .map((channel) => clampHex(Number(channel)))
        .join(''),
      alpha: parseAlpha(rgb[4]),
    }
  }

  const srgb = color.match(
    /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i,
  )
  if (srgb) {
    return {
      hex: [srgb[1], srgb[2], srgb[3]]
        .map((channel) => clampHex(Number(channel) * 255))
        .join(''),
      alpha: parseAlpha(srgb[4]),
    }
  }
  return null
}

function parseHexColor(hex: string): HtmlColor {
  if (hex.length === 3 || hex.length === 4) {
    const expanded = [...hex].map((character) => character + character).join('')
    return parseHexColor(expanded)
  }

  return {
    hex: hex.slice(0, 6).toUpperCase().padEnd(6, '0'),
    alpha: hex.length >= 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
  }
}

function clampHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()
}

function parseAlpha(value: string | undefined): number {
  if (value === undefined) return 1
  const parsed = value.endsWith('%')
    ? Number.parseFloat(value) / 100
    : Number.parseFloat(value)
  return Math.max(0, Math.min(1, parsed))
}

export function multiplyAlpha(color: HtmlColor, opacity: number): HtmlColor {
  return { ...color, alpha: Math.max(0, Math.min(1, color.alpha * opacity)) }
}

export function firstVisibleGradientColor(value: string): HtmlColor | null {
  const matches =
    value.match(
      /#[0-9a-f]{3,8}|rgba?\([^)]*\)|\b(?:black|blue|gray|green|grey|red|white|transparent)\b/gi,
    ) ?? []
  for (const match of matches) {
    const color = parseCssColor(match)
    if (color && color.alpha > 0) return color
  }
  return null
}

export function parseCssLinearGradient(value: string): HtmlGradient | null {
  if (!/^linear-gradient\(/i.test(value.trim())) return null
  const colorPattern =
    /#[0-9a-f]{3,8}|rgba?\([^)]*\)|\b(?:black|blue|gray|green|grey|red|white|transparent)\b/gi
  const matches = [...value.matchAll(colorPattern)]
  if (matches.length < 2) return null

  const stops = matches
    .map((match) => {
      const color = parseCssColor(match[0])
      const following = value.slice((match.index ?? 0) + match[0].length)
      const percentage = following.match(/^\s+(-?[\d.]+)%/)?.[1]
      return {
        color,
        offset:
          percentage === undefined
            ? undefined
            : clamp(Number.parseFloat(percentage) / 100),
      }
    })
    .filter((stop): stop is { color: HtmlColor; offset: number | undefined } =>
      Boolean(stop.color),
    )
  if (stops.length < 2) return null

  normalizeGradientOffsets(stops)
  return {
    angle: cssGradientAngle(value.slice(0, value.indexOf(','))),
    stops: stops.map((stop) => ({
      color: stop.color,
      offset: stop.offset ?? 0,
    })),
  }
}

export function compositeHtmlColor(
  foreground: HtmlColor,
  background: HtmlColor,
): HtmlColor {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha)
  if (alpha <= 0) return { hex: '000000', alpha: 0 }
  const foregroundChannels = hexChannels(foreground.hex)
  const backgroundChannels = hexChannels(background.hex)
  const channels = foregroundChannels.map(
    (channel, index) =>
      (channel * foreground.alpha +
        backgroundChannels[index]! *
          background.alpha *
          (1 - foreground.alpha)) /
      alpha,
  )
  return {
    hex: channels.map(clampHex).join(''),
    alpha,
  }
}

function normalizeGradientOffsets(
  stops: Array<{ offset: number | undefined }>,
): void {
  stops[0]!.offset ??= 0
  stops[stops.length - 1]!.offset ??= 1
  let anchor = 0
  for (let index = 1; index < stops.length; index++) {
    if (stops[index]!.offset === undefined) continue
    const start = stops[anchor]!.offset ?? 0
    const end = stops[index]!.offset ?? start
    const count = index - anchor
    for (let cursor = anchor + 1; cursor < index; cursor++) {
      stops[cursor]!.offset =
        start + (end - start) * ((cursor - anchor) / count)
    }
    anchor = index
  }
}

function cssGradientAngle(header: string): number {
  const degree = header.match(/(-?[\d.]+)deg/i)?.[1]
  if (degree !== undefined) return normalizeDegrees(Number.parseFloat(degree))
  const direction = header.match(/to\s+([^,)]*)/i)?.[1]
  if (!direction) return 180
  const words = direction.toLowerCase().replace(/\bin\s+.*$/, '')
  if (words.includes('top') && words.includes('right')) return 45
  if (words.includes('bottom') && words.includes('right')) return 135
  if (words.includes('bottom') && words.includes('left')) return 225
  if (words.includes('top') && words.includes('left')) return 315
  if (words.includes('right')) return 90
  if (words.includes('left')) return 270
  if (words.includes('top')) return 0
  return 180
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360
}

function hexChannels(hex: string): [number, number, number] {
  return [0, 2, 4].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16),
  ) as [number, number, number]
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function cssPixels(
  value: string | null | undefined,
  fallback = 0,
): number {
  if (!value || value === 'normal' || value === 'auto' || value === 'none')
    return fallback
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function cssFontFamily(value: string): string {
  return cssFontFamilies(value)[0] ?? 'Arial'
}

export function cssFontWeight(value: string): number {
  if (value === 'bold' || value === 'bolder') return 700
  if (value === 'normal' || value === 'lighter') return 400
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 400
}

export function cssTextAlign(
  value: string,
): 'left' | 'center' | 'right' | 'justify' {
  if (value === 'center' || value === 'right' || value === 'justify')
    return value
  return 'left'
}

export function cssDash(value: string): 'solid' | 'dash' | 'dot' {
  if (value === 'dashed') return 'dash'
  if (value === 'dotted') return 'dot'
  return 'solid'
}
