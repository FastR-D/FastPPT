import type { GradientOptions, Position } from './types'

/**
 * Slidewave — Input validation & warnings
 *
 * Goal: catch common mistakes BEFORE they silently produce a broken .pptx file.
 *
 * Validation emits console warnings instead of throwing so pipelines keep
 * running, except when strict mode is enabled.
 */

let STRICT_MODE = false
let SILENT_MODE = false

export function setStrict(value: boolean): void {
  STRICT_MODE = value
}
export function setSilent(value: boolean): void {
  SILENT_MODE = value
}

const SLIDE_MAX_W = 56 // inches (well beyond any realistic layout)
const SLIDE_MAX_H = 56
const FONT_MIN = 1
const FONT_MAX = 500

function warn(message: string, context: string): void {
  if (SILENT_MODE) return
  const prefix = context ? `[Slidewave:${context}]` : '[Slidewave]'
  // eslint-disable-next-line no-console
  console.warn(`${prefix} ${message}`)
  if (STRICT_MODE) throw new Error(`${prefix} ${message}`)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Validates a primitive's x/y/w/h coordinates.
 * Emits a warning for:
 *   - non-finite values (NaN or undefined)
 *   - negative x or y coordinates outside the slide
 *   - w or h <= 0
 *   - unusually large dimensions
 */
export function validateRect(
  { x, y, w, h }: Partial<Position>,
  context = 'rect',
): void {
  if (!isFiniteNumber(x)) warn(`x must be a finite number, got ${x}`, context)
  if (!isFiniteNumber(y)) warn(`y must be a finite number, got ${y}`, context)
  if (w !== undefined && (!isFiniteNumber(w) || w <= 0)) {
    warn(`w must be > 0, got ${w}`, context)
  }
  if (h !== undefined && (!isFiniteNumber(h) || h <= 0)) {
    warn(`h must be > 0, got ${h}`, context)
  }
  if (isFiniteNumber(x) && x < -0.5) {
    warn(`x=${x} is off-slide (< 0). Intended?`, context)
  }
  if (isFiniteNumber(y) && y < -0.5) {
    warn(`y=${y} is off-slide (< 0). Intended?`, context)
  }
  if (isFiniteNumber(w) && w > SLIDE_MAX_W) {
    warn(
      `w=${w} seems too large (> ${SLIDE_MAX_W}in). Unit is inches, not px.`,
      context,
    )
  }
  if (isFiniteNumber(h) && h > SLIDE_MAX_H) {
    warn(
      `h=${h} seems too large (> ${SLIDE_MAX_H}in). Unit is inches, not px.`,
      context,
    )
  }
}

export interface TextValidationOptions {
  fontSize?: unknown
  charSpacing?: unknown
  lineSpacingMultiple?: unknown
}

/**
 * Validates text options such as fontSize and charSpacing.
 *   - fontSize: 1..500 points
 *   - charSpacing: points; warns above 20 or below -5
 */
export function validateText(
  opts: TextValidationOptions = {},
  context = 'text',
): void {
  const { fontSize, charSpacing, lineSpacingMultiple } = opts
  if (fontSize !== undefined) {
    if (
      !isFiniteNumber(fontSize) ||
      fontSize < FONT_MIN ||
      fontSize > FONT_MAX
    ) {
      warn(
        `fontSize=${fontSize} out of range [${FONT_MIN}..${FONT_MAX}] pt`,
        context,
      )
    }
  }
  if (charSpacing !== undefined) {
    if (!isFiniteNumber(charSpacing)) {
      warn(
        `charSpacing=${charSpacing} must be a number (in POINTS, not em/px)`,
        context,
      )
    } else if (charSpacing > 20 || charSpacing < -5) {
      warn(
        `charSpacing=${charSpacing}pt is unusual. Reminder: value is in POINTS (typical: -1..6).`,
        context,
      )
    }
  }
  if (lineSpacingMultiple !== undefined) {
    if (
      !isFiniteNumber(lineSpacingMultiple) ||
      lineSpacingMultiple <= 0 ||
      lineSpacingMultiple > 5
    ) {
      warn(
        `lineSpacingMultiple=${lineSpacingMultiple} unusual (typical: 0.8..2.0)`,
        context,
      )
    }
  }
}

/** Validates a hex, rgb, or rgba color. */
export function validateColor(color: unknown, context = 'color'): void {
  if (color === undefined || color === null) return
  if (typeof color !== 'string') {
    warn(`color must be a string, got ${typeof color}`, context)
    return
  }
  const s = color.trim().toLowerCase()
  const isHex = /^#?[0-9a-f]{3,8}$/.test(s)
  const isRgb = /^rgba?\s*\(/.test(s)
  if (!isHex && !isRgb) {
    warn(`color "${color}" is not a valid hex or rgb(a) value`, context)
  }
}

/** Validates a gradient array such as ['#xxx', '#yyy', ...]. */
export function validateGradient(
  gradient: GradientOptions | string[] | null | undefined,
  context = 'gradient',
): void {
  if (!gradient) return
  const arr = Array.isArray(gradient) ? gradient : gradient.colors
  if (!arr || !Array.isArray(arr) || arr.length < 2) {
    warn(
      `gradient needs at least 2 colors, got ${arr ? arr.length : 0}`,
      context,
    )
    return
  }
  arr.forEach((c, i) => validateColor(c, `${context}[${i}]`))
}

/** Wraps an async function and warns instead of crashing. */
export async function safeRun<T>(
  fn: () => T | Promise<T>,
  context = 'primitive',
): Promise<T | null> {
  try {
    return await fn()
  } catch (error) {
    if (STRICT_MODE) throw error
    const message = error instanceof Error ? error.message : String(error)
    warn(`raster failed: ${message}`, context)
    return null
  }
}
