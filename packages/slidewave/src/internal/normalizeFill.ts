import type { Fill, Hex } from '../types'
import { normalizeHex } from '../utils/color'

export type NormalizedFill =
  { type: 'none' } | { type: 'solid'; color: string; transparency?: number }

function isFill(value: unknown): value is Fill {
  return typeof value === 'object' && value !== null
}

export function normalizeFill(
  fill: Hex | Fill | Hex[] | null | undefined,
): NormalizedFill {
  if (!fill) return { type: 'none' }

  if (typeof fill === 'string') {
    return { type: 'solid', color: normalizeHex(fill) }
  }

  if (Array.isArray(fill)) {
    return { type: 'solid', color: normalizeHex(fill[0]) }
  }

  if (isFill(fill) && fill.type === 'none') {
    return { type: 'none' }
  }

  if (isFill(fill) && (fill.type === 'solid' || fill.color)) {
    const transparency = normalizeTransparency(fill.transparency)
    return {
      type: 'solid',
      color: normalizeHex(fill.color),
      ...(transparency === undefined ? {} : { transparency }),
    }
  }

  if (isFill(fill) && fill.type === 'gradient') {
    return { type: 'solid', color: normalizeHex(fill.colors?.[0]) }
  }

  return { type: 'solid', color: '000000' }
}

function normalizeTransparency(value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) return undefined
  return Math.max(0, Math.min(100, value))
}
