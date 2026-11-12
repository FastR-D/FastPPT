import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  FONT_FILES,
  resolveFontDescriptor,
  resolveFontPath,
} from '../src/registry.mjs'

describe('@fastppt/fonts registry', () => {
  it('resolves every registered family to an existing bundled binary', () => {
    const families = Object.keys(FONT_FILES)
    expect(families.length).toBeGreaterThanOrEqual(13)
    for (const family of families) {
      const path = resolveFontPath(family)
      expect(path, `path for ${family}`).toBeTruthy()
      expect(existsSync(path), `binary exists for ${family}`).toBe(true)
      const descriptor = resolveFontDescriptor(family)
      expect(descriptor.path).toBe(path)
      for (const [face, entry] of Object.entries(descriptor.faces ?? {})) {
        expect(
          existsSync(entry.path),
          `binary exists for ${family} ${face}`,
        ).toBe(true)
      }
    }
  })

  it('returns undefined for an unknown family so the embedder can warn', () => {
    expect(resolveFontPath('Definitely Not A Font')).toBeUndefined()
  })
})
