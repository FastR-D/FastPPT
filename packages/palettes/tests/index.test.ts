import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { PaletteLibrary } from '../src/index.js'

describe('palette library', () => {
  const library = new PaletteLibrary()
  it('loads sourced palettes with exact colors and unique identifiers', async () => {
    const entries = await library.entries()
    expect(entries.length).toBeGreaterThan(2000)
    expect(new Set(entries.map((item) => item.id)).size).toBe(entries.length)
    expect(
      new Set(entries.map((item) => item.source)).size,
    ).toBeGreaterThanOrEqual(8)
    expect(
      entries.every(
        (item) =>
          item.colors.length >= 2 && item.sourceUrl.startsWith('https://'),
      ),
    ).toBe(true)
  })
  it('searches bilingual design intent, exact color, source and paginated results', async () => {
    const intent = await library.search({ query: '科技发布', limit: 5 })
    expect(intent.items).toHaveLength(5)
    const source = await library.search({
      source: 'ColorBrewer',
      count: 5,
      limit: 5,
    })
    expect(
      source.items.every(
        (item) => item.source === 'ColorBrewer' && item.colors.length === 5,
      ),
    ).toBe(true)
    const first = await library.search({ limit: 4 }),
      second = await library.search({ limit: 4, offset: 4 })
    expect(
      second.items.some((item) =>
        first.items.find((other) => other.id === item.id),
      ),
    ).toBe(false)
    const color = first.items[0]!.colors[0]!
    expect(
      (await library.search({ query: color, limit: 1 })).items[0]!.colors,
    ).toContain(color)
    expect(
      (await library.search({ query: 'zzzz_unmatched_19837' })).items,
    ).toEqual([])
    await expect(library.read('../secret')).rejects.toThrow(
      'Invalid palette id',
    )
  })
  it('uses model-ranked real candidates and rejects fabricated recommendations', async () => {
    const result = await library.recommend('科研图表', (prompt) => {
      const candidates = JSON.parse(prompt.split('\n候选：')[1]!) as Array<{
        id: string
      }>
      expect(candidates.length).toBeGreaterThan(0)
      return Promise.resolve(
        '```json\n' +
          JSON.stringify({
            recommendations: [
              { id: candidates[0]!.id, reason: '颜色层次清晰，适合比较分组。' },
            ],
          }) +
          '\n```',
      )
    })
    expect(result.recommendations).toHaveLength(1)
    expect(await library.read(result.recommendations[0]!.palette.id)).toEqual(
      result.recommendations[0]!.palette,
    )
    await expect(
      library.recommend('商务', () =>
        Promise.resolve(
          '{"recommendations":[{"id":"invented","reason":"fake"}]}',
        ),
      ),
    ).rejects.toThrow('候选库之外')
    await expect(
      library.recommend('商务', () => Promise.resolve('not JSON')),
    ).rejects.toThrow()
  })
  it('reloads a modified local index and supports an external library root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fastppt-palette-'))
    try {
      const entry = (await library.entries())[0]!
      await writeFile(
        join(root, 'index.json'),
        JSON.stringify({ version: 1, entries: [entry] }),
      )
      const external = new PaletteLibrary(root)
      expect((await external.entries())[0]!.title).toBe(entry.title)
      await writeFile(
        join(root, 'index.json'),
        JSON.stringify({
          version: 1,
          entries: [{ ...entry, title: 'Updated local palette' }],
        }),
      )
      expect((await external.entries())[0]!.title).toBe('Updated local palette')
      expect(await readFile(join(root, 'index.json'), 'utf8')).toContain(
        'Updated local palette',
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
