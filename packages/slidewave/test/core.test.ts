import { describe, expect, it } from 'vitest'

import { normalizeFill } from '../src/internal/normalizeFill'
import { DEFAULT_THEME, mergeTheme, pick } from '../src/theme'
import { hexToRgb, mix, normalizeHex, rgbToHex } from '../src/utils/color'

describe('theme utilities', () => {
  it('merges overrides without mutating the default theme', () => {
    const theme = mergeTheme({ primary: '#123456' })

    expect(theme.primary).toBe('#123456')
    expect(theme.background).toBe(DEFAULT_THEME.background)
    expect(DEFAULT_THEME.primary).toBe('#7C3AED')
  })

  it('picks the first non-nullish value', () => {
    expect(pick('#111111', '#222222', '#333333')).toBe('#111111')
    expect(pick(undefined, '#222222', '#333333')).toBe('#222222')
    expect(pick(null, undefined, '#333333')).toBe('#333333')
  })
})

describe('color utilities', () => {
  it('normalizes colors for pptxgenjs', () => {
    expect(normalizeHex('#12abef')).toBe('12ABEF')
    expect(normalizeHex(undefined)).toBe('000000')
  })

  it('converts, clamps, and mixes RGB values', () => {
    expect(hexToRgb('#FF8000')).toEqual({ r: 255, g: 128, b: 0 })
    expect(rgbToHex(300, -10, 127.6)).toBe('FF0080')
    expect(mix('#000000', '#FFFFFF')).toBe('808080')
  })
})

describe('normalizeFill', () => {
  it('normalizes solid fills and uses the first gradient color', () => {
    expect(normalizeFill('#abcdef')).toEqual({ type: 'solid', color: 'ABCDEF' })
    expect(normalizeFill({ type: 'gradient', colors: ['#123456', '#ffffff'] }))
      .toEqual({ type: 'solid', color: '123456' })
    expect(normalizeFill({ type: 'solid', color: '#abcdef', transparency: 25 }))
      .toEqual({ type: 'solid', color: 'ABCDEF', transparency: 25 })
  })

  it('maps an absent fill to none', () => {
    expect(normalizeFill(null)).toEqual({ type: 'none' })
    expect(normalizeFill({ type: 'none' })).toEqual({ type: 'none' })
  })
})
