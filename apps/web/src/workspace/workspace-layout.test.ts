import { describe, expect, it } from 'vitest'
import { constrainWorkspaceLayout } from './use-workspace-layout.js'

describe('workspace layout bounds', () => {
  it('fits oversized saved panels around the minimum editor width', () => {
    const result = constrainWorkspaceLayout(
      { sidebar: 900, preview: 1200 },
      1200,
    )
    expect(result.sidebar).toBeGreaterThanOrEqual(220)
    expect(result.preview).toBeGreaterThanOrEqual(360)
    expect(result.sidebar + result.preview + 56 + 8 + 320).toBeLessThanOrEqual(
      1200,
    )
  })

  it('keeps panel minimums when dragged beyond their bounds', () => {
    expect(
      constrainWorkspaceLayout({ sidebar: -500, preview: -10 }, 1440),
    ).toEqual({ sidebar: 220, preview: 360 })
  })

  it('lets the preview use the collapsed sidebar space', () => {
    const result = constrainWorkspaceLayout(
      { sidebar: 260, preview: 950 },
      1440,
      false,
    )
    expect(result.preview).toBe(950)
    expect(result.preview + 56 + 8 + 320).toBeLessThanOrEqual(1440)
  })
})
