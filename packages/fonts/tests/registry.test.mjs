import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { FONT_FILES, resolveFontPath } from '../src/registry.mjs'

describe('@fastppt/fonts registry', () => {
  it('resolves every registered family to an existing bundled binary', () => {
    const families = Object.keys(FONT_FILES)
    expect(families.length).toBeGreaterThanOrEqual(13)
    for (const family of families) {
      const path = resolveFontPath(family)
      expect(path, `path for ${family}`).toBeTruthy()
      expect(existsSync(path), `binary exists for ${family}`).toBe(true)
    }
  })

  it('returns undefined for an unknown family so the embedder can warn', () => {
    expect(resolveFontPath('Definitely Not A Font')).toBeUndefined()
  })
})
