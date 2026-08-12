/**
 * Slidewave — Raster cache (LRU)
 *
 * Goal: when two rasterized primitives have the SAME parameters
 * (dimensions, colors, seed, and so on), reuse the previously generated PNG
 * instead of rasterizing it again.
 *
 * Typical gains:
 *   - A 20-slide deck with the same background blob → 1 render instead of 20
 *   - A theme-driven deck with a dot grid on every slide → 1 render
 *   - Repeated progress rings → cache hit from the second occurrence onward
 *
 * Cache key: kind + dimensions + stableKey(params).
 * stableKey is deterministic JSON with sorted keys.
 *
 * The configurable LRU (Least Recently Used) limit prevents very large decks
 * from exhausting memory.
 */

export interface RasterCacheStats {
  size: number
  max: number
  hits: number
  misses: number
  hitRate: number
}

class LruCache<K, V> {
  max: number
  readonly map: Map<K, V>
  hits: number
  misses: number

  constructor(max = 150) {
    this.max = max
    this.map = new Map()
    this.hits = 0
    this.misses = 0
  }

  get(k: K): V | undefined {
    if (!this.map.has(k)) {
      this.misses++
      return undefined
    }
    const v = this.map.get(k)
    // Re-insert to bump recency
    this.map.delete(k)
    this.map.set(k, v)
    this.hits++
    return v
  }

  set(k: K, v: V): void {
    if (this.map.has(k)) {
      this.map.delete(k)
    } else if (this.map.size >= this.max) {
      // Drop oldest
      this.evictOldest()
    }
    this.map.set(k, v)
  }

  delete(k: K): boolean {
    return this.map.delete(k)
  }

  resize(max: number): void {
    this.max = normalizeMax(max)
    while (this.map.size > this.max) this.evictOldest()
  }

  clear(): void {
    this.map.clear()
    this.hits = 0
    this.misses = 0
  }

  get size(): number {
    return this.map.size
  }

  stats(): RasterCacheStats {
    const total = this.hits + this.misses
    return {
      size: this.map.size,
      max: this.max,
      hits: this.hits,
      misses: this.misses,
      hitRate: total ? this.hits / total : 0,
    }
  }

  private evictOldest(): void {
    const oldest = this.map.keys().next()
    if (!oldest.done) this.map.delete(oldest.value)
  }
}

function normalizeMax(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
}

const cache = new LruCache<string, Promise<string>>(150)

/**
 * Serializes a value to JSON with recursively sorted object keys.
 * Guarantees that `{a:1, b:2}` and `{b:2, a:1}` produce the same key.
 */
export function stableKey(value: unknown): string {
  return serializeStable(value, new WeakSet<object>())
}

function serializeStable(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null || value === undefined) return String(value)
  if (typeof value !== 'object') return JSON.stringify(value) ?? String(value)
  if (Array.isArray(value)) {
    assertNotCircular(value, ancestors)
    const serialized =
      '[' +
      value.map((item) => serializeStable(item, ancestors)).join(',') +
      ']'
    ancestors.delete(value)
    return serialized
  }
  assertNotCircular(value, ancestors)
  const record = value as Record<string, unknown>
  const keys = Object.keys(value).sort()
  const serialized =
    '{' +
    keys
      .map(
        (key) =>
          JSON.stringify(key) + ':' + serializeStable(record[key], ancestors),
      )
      .join(',') +
    '}'
  ancestors.delete(value)
  return serialized
}

function assertNotCircular(value: object, ancestors: WeakSet<object>): void {
  if (ancestors.has(value)) {
    throw new TypeError(
      'Cannot create a stable cache key from a circular value',
    )
  }
  ancestors.add(value)
}

/**
 * Rasterization with automatic caching.
 *
 *   const png = await cachedRaster('blob', params, w, h, () => blobToPng(params, w, h))
 *
 * Returns the cached PNG when kind, dimensions, and parameters were rasterized before.
 * Otherwise runs rasterFn, caches the result, and returns the PNG.
 */
export async function cachedRaster(
  kind: string,
  params: unknown,
  w: number,
  h: number,
  rasterFn: () => Promise<string>,
): Promise<string> {
  const key = `${kind}|${w}x${h}|${stableKey(params)}`
  const hit = cache.get(key)
  if (hit !== undefined) return await hit

  const pending = Promise.resolve(rasterFn())
  cache.set(key, pending)

  try {
    const png = await pending
    if (!png) cache.delete(key)
    return png
  } catch (error) {
    cache.delete(key)
    throw error
  }
}

/** Clears the cache completely. */
export function clearRasterCache(): void {
  cache.clear()
}

/** Returns { size, max, hits, misses, hitRate }. */
export function rasterCacheStats(): RasterCacheStats {
  return cache.stats()
}

/** Updates the LRU limit (default: 150). */
export function setRasterCacheMax(n: number): void {
  cache.resize(n)
}
