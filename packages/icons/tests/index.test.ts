import { describe, expect, it } from 'vitest'

import { listCollections, searchIcons } from '../src/index.js'

describe('@fastppt/icons', () => {
  it('lists the installed collections', async () => {
    const collections = await listCollections()
    expect(collections.map((collection) => collection.prefix)).toEqual([
      'mdi',
      'ant-design',
    ])
    for (const collection of collections) {
      expect(collection.total).toBeGreaterThan(100)
      expect(collection.name.length).toBeGreaterThan(0)
    }
  })

  it('returns an empty list for an empty query', async () => {
    expect(await searchIcons('')).toEqual([])
    expect(await searchIcons('   ')).toEqual([])
  })

  it('finds exact names first and returns inline SVG', async () => {
    const results = await searchIcons('home', { limit: 5 })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]?.name).toBe('home')
    expect(results[0]?.prefix).toBe('mdi')
    expect(results[0]?.svg).toMatch(/^<svg xmlns=/)
    expect(results[0]?.svg).toContain('viewBox="0 0 24 24"')
    expect(results[0]?.svg).toMatch(/width="1em"/)
  })

  it('searches case-insensitively', async () => {
    const results = await searchIcons('HOME')
    expect(results.some((result) => result.name === 'home')).toBe(true)
  })

  it('includes alias hits under their own name', async () => {
    const results = await searchIcons('chart-home')
    expect(results.some((result) => result.name === 'chart-home')).toBe(true)
    expect(results[0]?.svg).toContain('<svg')
  })

  it('restricts to one collection with the prefix option', async () => {
    const results = await searchIcons('home', { prefix: 'ant-design' })
    expect(results.length).toBeGreaterThan(0)
    for (const result of results) {
      expect(result.prefix).toBe('ant-design')
    }
  })

  it('clamps the limit to [1, 100]', async () => {
    expect((await searchIcons('a', { limit: 0 })).length).toBeLessThanOrEqual(1)
    expect((await searchIcons('a', { limit: 1000 })).length).toBeLessThanOrEqual(
      100,
    )
  })

  it('ignores unknown collection prefixes', async () => {
    expect(await searchIcons('home', { prefix: 'does-not-exist' })).toEqual([])
  })
})
