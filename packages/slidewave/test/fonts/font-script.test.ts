import { expect, it } from 'vitest'
import { fontScript } from '../../src/fonts/font-script.js'
it('separates Latin, East Asian including Korean, and complex script characters', () => {
  for (const character of 'Latin09 Ελληνικά Русский') expect(fontScript(character)).toBe('latin')
  for (const character of '中文日本かなカナ한국ㄅ，') expect(fontScript(character)).toBe('ea')
  for (const character of 'عربيעבריתहिन्दीไทย') expect(fontScript(character)).toBe('cs')
})

it('keeps inherited combining marks with the preceding script in a run', () => {
  expect(fontScript('\u064b', 'cs')).toBe('cs')
  expect(fontScript('\u0301', 'latin')).toBe('latin')
  expect(fontScript('\u3099', 'ea')).toBe('ea')
  expect(fontScript('A', 'cs')).toBe('latin')
})
