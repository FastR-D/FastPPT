import { describe, expect, it } from 'vitest'

import {
  overviewRenderComplete,
  renderedOverviewPageCount,
} from '../../src/browser/readiness'

describe('Slidev overview readiness', () => {
  it('accepts sized blank slides without requiring child elements', () => {
    expect(
      renderedOverviewPageCount([
        { width: 980, height: 551.25, display: 'block', visibility: 'visible' },
        { width: 980, height: 551.25, display: 'block', visibility: 'visible' },
      ]),
    ).toBe(2)
  })

  it('ignores hidden and zero-sized Slidev roots', () => {
    expect(
      renderedOverviewPageCount([
        { width: 980, height: 551.25, display: 'none', visibility: 'visible' },
        { width: 0, height: 0, display: 'block', visibility: 'visible' },
        { width: 980, height: 551.25, display: 'block', visibility: 'hidden' },
      ]),
    ).toBe(0)
  })

  it('does not accept a stable first page before every print container renders', () => {
    expect(overviewRenderComplete(1, 12)).toBe(false)
    expect(overviewRenderComplete(12, 12)).toBe(true)
    expect(overviewRenderComplete(1, 0)).toBe(false)
  })
})
