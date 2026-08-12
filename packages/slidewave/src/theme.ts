/**
 * Slidewave — Global theme system
 *
 * Usage :
 *   const pres = new Pres({ theme: { primary: '#7C3AED', accent: '#06B6D4' } })
 *   // or
 *   pres.setTheme({ primary: '#7C3AED' })
 *
 *   // Primitives use theme values when an option is not specified:
 *   s.addRect({ x:1, y:1, w:2, h:1 })   // fill = theme.primary
 *   s.addText('Hi')                      // color = theme.text, fontFace = theme.fontBody
 *
 * Explicit overrides always take priority:
 *   s.addRect({ fill: '#FF0000' })       // red, not theme.primary
 */

import type { Theme } from './types'

export const DEFAULT_THEME: Theme = {
  // Primary colors
  primary: '#7C3AED', // Violet Slidewave
  primaryDark: '#5B21B6',
  primaryLight: '#A78BFA',
  accent: '#06B6D4', // Cyan
  accentBright: '#22D3EE',

  // Surfaces
  background: '#0F0F23',
  surface: '#1E1E3F',
  surfaceAlt: '#252547',

  // Text
  text: '#FAFAFA',
  textDim: '#A1A1AB',
  textMuted: '#52525B',

  // Borders
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.15)',

  // Semantic colors
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',

  // Typography
  fontDisplay: 'Fraunces, Georgia, serif',
  fontBody: 'Inter, system-ui, sans-serif',
  fontMono: 'JetBrains Mono, Consolas, monospace',

  // Signature gradients
  gradient: ['#7C3AED', '#06B6D4'],
  gradientAngle: 135,
}

/**
 * Merges a user theme with the defaults.
 * Missing keys are inherited from DEFAULT_THEME.
 */
export function mergeTheme(userTheme: Partial<Theme> = {}): Theme {
  return { ...DEFAULT_THEME, ...userTheme }
}

/**
 * Selects a value in priority order: `explicit`, `themeValue`, then `fallback`.
 *   pick('#FF0000', theme.primary, '#000')  → '#FF0000'
 *   pick(undefined,  theme.primary, '#000') → theme.primary
 *   pick(undefined,  undefined,     '#000') → '#000'
 */
export function pick<Explicit, Themed, Fallback>(
  explicit: Explicit | null | undefined,
  themeValue: Themed | null | undefined,
  fallback: Fallback,
): NonNullable<Explicit> | NonNullable<Themed> | Fallback {
  if (explicit !== undefined && explicit !== null)
    return explicit as NonNullable<Explicit>
  if (themeValue !== undefined && themeValue !== null)
    return themeValue as NonNullable<Themed>
  return fallback
}
