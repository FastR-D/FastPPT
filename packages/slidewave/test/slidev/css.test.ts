import { describe, expect, it } from 'vitest'

import {
  cssDash,
  cssFontFamilies,
  cssFontFamily,
  cssFontWeight,
  compositeHtmlColor,
  firstVisibleGradientColor,
  parseCssLinearGradient,
  parseCssColor,
} from '../../src/slidev/css'

describe('Slidev CSS normalization', () => {
  it('parses browser color formats without losing alpha', () => {
    expect(parseCssColor('#1234')).toEqual({ hex: '112233', alpha: 4 / 15 })
    expect(parseCssColor('rgb(12 34 56 / 50%)')).toEqual({ hex: '0C2238', alpha: 0.5 })
    expect(parseCssColor('transparent')).toEqual({ hex: '000000', alpha: 0 })
  })

  it('parses computed color-mix colors returned as color(srgb)', () => {
    expect(parseCssColor('color(srgb 0.9725 0.6373 0.7373 / 0.22)')).toEqual({
      hex: 'F8A3BC',
      alpha: 0.22,
    })
  })

  it('selects a stable editable approximation for a gradient', () => {
    expect(firstVisibleGradientColor('linear-gradient(90deg, transparent, rgba(37, 99, 235, .75))'))
      .toEqual({ hex: '2563EB', alpha: 0.75 })
  })

  it('preserves CSS gradient direction, stops, and alpha', () => {
    expect(parseCssLinearGradient('linear-gradient(to right bottom in oklch, rgba(59, 153, 212, .1) 0%, rgba(255, 255, 255, .7) 50%, rgba(65, 182, 230, .05) 100%)'))
      .toEqual({
        angle: 135,
        stops: [
          { offset: 0, color: { hex: '3B99D4', alpha: 0.1 } },
          { offset: 0.5, color: { hex: 'FFFFFF', alpha: 0.7 } },
          { offset: 1, color: { hex: '41B6E6', alpha: 0.05 } },
        ],
      })
  })

  it('precomposites translucent component fills against their captured backdrop', () => {
    expect(compositeHtmlColor({ hex: '3B99D4', alpha: 0.2 }, { hex: 'FFFFFF', alpha: 1 }))
      .toEqual({ hex: 'D8EBF6', alpha: 1 })
    expect(compositeHtmlColor({ hex: 'F3F4F6', alpha: 0.5 }, { hex: 'FFFFFF', alpha: 1 }))
      .toEqual({ hex: 'F9FAFB', alpha: 1 })
  })

  it('normalizes computed typography and border styles', () => {
    expect(cssFontFamily('"Source Han Sans", sans-serif')).toBe('Source Han Sans')
    expect(cssFontFamilies('Inter, "Microsoft YaHei", sans-serif')).toEqual([
      'Inter',
      'Microsoft YaHei',
      'sans-serif',
    ])
    expect(cssFontFamilies('"Font, With Comma", Arial')).toEqual([
      'Font, With Comma',
      'Arial',
    ])
    expect(cssFontWeight('bold')).toBe(700)
    expect(cssFontWeight('550')).toBe(550)
    expect(cssDash('dotted')).toBe('dot')
  })
})
