/**
 * Color utilities for Slidewave.
 * pptxgenjs expects HEX colors without "#", so values are normalized here.
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

export function normalizeHex(color: unknown): string {
  if (!color) return '000000'
  if (typeof color !== 'string') return '000000'
  return color.replace('#', '').toUpperCase().padEnd(6, '0').slice(0, 6)
}

export function hexToRgb(hex: string): Rgb {
  const h = normalizeHex(hex)
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0')
  return (toHex(r) + toHex(g) + toHex(b)).toUpperCase()
}

export function mix(hexA: string, hexB: string, t = 0.5): string {
  const a = hexToRgb(hexA)
  const b = hexToRgb(hexB)
  return rgbToHex(
    a.r + (b.r - a.r) * t,
    a.g + (b.g - a.g) * t,
    a.b + (b.b - a.b) * t,
  )
}
