import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  cachedRaster,
  clearRasterCache,
  rasterCacheStats,
  setRasterCacheMax,
  stableKey,
} from '../src/cache'

describe('stableKey', () => {
  it('sorts nested object keys while preserving array order', () => {
    const first = { z: [2, 1], a: { d: 4, c: 3 } }
    const reordered = { a: { c: 3, d: 4 }, z: [2, 1] }

    expect(stableKey(first)).toBe(stableKey(reordered))
    expect(stableKey([1, 2])).not.toBe(stableKey([2, 1]))
  })

  it('rejects circular values with a useful error', () => {
    const value: Record<string, unknown> = {}
    value.self = value

    expect(() => stableKey(value)).toThrow('circular value')
  })
})

describe('cachedRaster', () => {
  beforeEach(() => {
    clearRasterCache()
    setRasterCacheMax(150)
  })

  it('reuses completed raster output', async () => {
    const rasterize = vi.fn().mockResolvedValue('data:image/png;base64,one')

    await expect(cachedRaster('blob', { seed: 1 }, 2, 3, rasterize)).resolves.toContain('one')
    await expect(cachedRaster('blob', { seed: 1 }, 2, 3, rasterize)).resolves.toContain('one')

    expect(rasterize).toHaveBeenCalledTimes(1)
    expect(rasterCacheStats()).toMatchObject({ size: 1, hits: 1, misses: 1 })
  })

  it('deduplicates concurrent requests for the same raster', async () => {
    let resolveRaster!: (value: string) => void
    const rasterize = vi.fn(() => new Promise<string>((resolve) => {
      resolveRaster = resolve
    }))

    const first = cachedRaster('grid', { color: '#fff' }, 4, 4, rasterize)
    const second = cachedRaster('grid', { color: '#fff' }, 4, 4, rasterize)

    expect(rasterize).toHaveBeenCalledTimes(1)
    resolveRaster('data:image/png;base64,same')
    await expect(Promise.all([first, second])).resolves.toEqual([
      'data:image/png;base64,same',
      'data:image/png;base64,same',
    ])
  })

  it('evicts failed and empty raster results', async () => {
    const failed = vi.fn().mockRejectedValue(new Error('failed'))
    await expect(cachedRaster('bad', {}, 1, 1, failed)).rejects.toThrow('failed')
    await expect(cachedRaster('bad', {}, 1, 1, failed)).rejects.toThrow('failed')
    expect(failed).toHaveBeenCalledTimes(2)

    const empty = vi.fn().mockResolvedValue('')
    await cachedRaster('empty', {}, 1, 1, empty)
    await cachedRaster('empty', {}, 1, 1, empty)
    expect(empty).toHaveBeenCalledTimes(2)
  })

  it('evicts least-recently-used entries when the limit shrinks', async () => {
    for (const seed of [1, 2, 3]) {
      await cachedRaster('blob', { seed }, 1, 1, async () => `png-${seed}`)
    }

    setRasterCacheMax(2)
    expect(rasterCacheStats()).toMatchObject({ size: 2, max: 2 })
  })
})
