import { describe, expect, it } from 'vitest'

import { resolvePreferredThemeId } from '../../src/stores/preview.js'

describe('resolvePreferredThemeId', () => {
  const themes = ['slidev-theme-academy', 'slidev-theme-landing']

  it('uses the first registered theme when no deck or recent theme exists', () => {
    expect(resolvePreferredThemeId(themes)).toBe('slidev-theme-academy')
  })

  it('prefers recent and still-registered theme selections', () => {
    expect(
      resolvePreferredThemeId(
        themes,
        'slidev-theme-landing',
        'slidev-theme-academy',
      ),
    ).toBe('slidev-theme-landing')
    expect(
      resolvePreferredThemeId(themes, undefined, 'slidev-theme-landing'),
    ).toBe('slidev-theme-landing')
  })
})
