import { DEFAULT_DECOR_DATA } from './decor-catalog.mjs'
import {
  IMAGE_DATA_FIELDS,
  normalizeImageData,
  pickImageDataFields,
} from './image-config.mjs'

/**
 * @typedef {Record<string, unknown>} PlainRecord
 * @typedef {{ cols?: number | [number, number], rows?: number | [number, number], ratio?: number | [number, number], aspectRatio?: number | [number, number] }} DecorSize
 * @typedef {PlainRecord & {
 *   id: string
 *   src: string
 *   sizes?: DecorSize[]
 *   cols?: number | [number, number]
 *   rows?: number | [number, number]
 *   ratio?: number | [number, number]
 *   aspectRatio?: number | [number, number]
 *   meaning?: string
 *   meanings?: string[]
 *   tone?: string
 *   tones?: string[]
 *   tags?: string[]
 *   image?: Partial<import('./image-config.mjs').ImageDataInput>
 * }} DecorCatalogVariant
 * @typedef {{ variants: readonly DecorCatalogVariant[], byId: Map<string, DecorCatalogVariant> }} NormalizedDecorCatalog
 * @typedef {{ cols?: number, rows?: number, label?: string }} DecorFootprint
 * @typedef {{ meaning: string, tone: string }} DecorQuery
 * @typedef {{ variant: DecorCatalogVariant, size: number, tone: number, meaning: number }} DecorScore
 * @typedef {{
 *   catalog?: readonly object[] | NormalizedDecorCatalog
 *   themeDecors?: readonly object[]
 *   footprint?: DecorFootprint
 *   seed?: string
 *   warn?: (message: string) => void
 *   label?: string
 * }} DecorResolveOptions
 */

const DECOR_FIELDS = new Set(['src', 'id', 'meaning', 'tone', 'tags', ...IMAGE_DATA_FIELDS])

/**
 * @param {unknown} value
 * @returns {value is PlainRecord}
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeList(value) {
  return Array.isArray(value)
    ? value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean)
    : []
}

/**
 * @param {unknown} input
 */
export function hasDecorInput(input) {
  if (!isPlainObject(input))
    return false

  return Object.entries(input).some(([key, value]) => {
    if (!DECOR_FIELDS.has(key))
      return false

    if (key === 'src')
      return true

    if (key === 'id' || key === 'meaning' || key === 'tone')
      return typeof value === 'string' && Boolean(value.trim())

    if (value === undefined || value === null)
      return false

    return typeof value === 'string' ? Boolean(value.trim()) : true
  })
}

/**
 * @param {{
 *   decor?: object | null
 *   tone: string
 *   contrast: boolean
 * }} input
 * @returns {PlainRecord & { meaning: string, tone: string, color: string, opacity: number }}
 */
export function resolveAgendaDecor({ decor, tone, contrast }) {
  return {
    meaning: 'agenda',
    tone,
    color: contrast ? 'var(--theme-color-light-0)' : 'var(--theme-color-dark-0)',
    opacity: 0.85,
    ...(isPlainObject(decor) ? decor : {}),
  }
}

/**
 * @param {PlainRecord} variant
 * @param {string} id
 * @returns {DecorCatalogVariant}
 */
function normalizeCatalogVariant(variant, id) {
  const normalized = /** @type {PlainRecord} */ ({ ...variant, id })

  if ((!Array.isArray(normalized.sizes) || normalized.sizes.length === 0)
    && normalized.cols !== undefined
    && normalized.rows !== undefined) {
    normalized.sizes = [{
      cols: normalized.cols,
      rows: normalized.rows,
      ratio: normalized.ratio ?? normalized.aspectRatio,
    }]
  }

  if (Array.isArray(normalized.sizes)) {
    normalized.sizes = normalized.sizes
      .filter(isPlainObject)
      .map((size) => {
        const normalizedSize = { ...size }
        normalizedSize.ratio ??= normalizedSize.aspectRatio
        delete normalizedSize.aspectRatio

        return normalizedSize
      })
  }

  if (normalizeList(normalized.meanings).length === 0 && typeof normalized.meaning === 'string' && normalized.meaning.trim())
    normalized.meanings = [normalized.meaning.trim()]

  if (normalizeList(normalized.tones).length === 0 && typeof normalized.tone === 'string' && normalized.tone.trim())
    normalized.tones = [normalized.tone.trim()]

  const toneTags = normalizeList(normalized.tones)
  const explicitTags = normalizeList(normalized.tags)
  normalized.tags = [...new Set([...explicitTags, ...toneTags])]

  return /** @type {DecorCatalogVariant} */ (normalized)
}

/**
 * @param {number} value
 * @param {unknown} range
 */
function sizeRangeDistance(value, range) {
  if (typeof range === 'number')
    return Math.abs(value - range)

  if (!Array.isArray(range) || range.length !== 2)
    return Number.POSITIVE_INFINITY

  const [min, max] = range.map(Number)

  if (!Number.isFinite(min) || !Number.isFinite(max))
    return Number.POSITIVE_INFINITY

  if (value >= min && value <= max) {
    const center = (min + max) / 2
    return Math.abs(value - center)
  }

  return Math.min(Math.abs(value - min), Math.abs(value - max))
}

/**
 * @param {number} value
 * @param {unknown} range
 */
function ratioRangeDistance(value, range) {
  if (range === undefined || range === null || range === '')
    return 0

  if (typeof range === 'number')
    return Number.isFinite(range) && range > 0 ? Math.abs(value - range) : Number.POSITIVE_INFINITY

  if (!Array.isArray(range) || range.length !== 2)
    return Number.POSITIVE_INFINITY

  const [first, second] = range.map(Number)

  if (!Number.isFinite(first) || !Number.isFinite(second) || first <= 0 || second <= 0)
    return Number.POSITIVE_INFINITY

  const min = Math.min(first, second)
  const max = Math.max(first, second)

  if (value < min || value > max)
    return Number.POSITIVE_INFINITY

  return 0
}

/**
 * @param {DecorCatalogVariant} variant
 * @param {DecorFootprint | undefined} footprint
 */
function sizeDistance(variant, footprint) {
  const cols = Number(footprint?.cols)
  const rows = Number(footprint?.rows)

  if (!Number.isFinite(cols) || !Number.isFinite(rows))
    return 0

  const sizes = Array.isArray(variant?.sizes) ? variant.sizes : []

  if (sizes.length === 0)
    return Number.POSITIVE_INFINITY

  return Math.min(
    ...sizes.map((size) => {
      const ratio = cols / rows

      return sizeRangeDistance(cols, size?.cols)
        + sizeRangeDistance(rows, size?.rows)
        + ratioRangeDistance(ratio, size?.ratio)
    }),
  )
}

/**
 * @param {DecorCatalogVariant} variant
 * @param {DecorQuery} query
 * @param {DecorFootprint | undefined} footprint
 * @returns {DecorScore}
 */
function scoreVariant(variant, query, footprint) {
  const tags = normalizeList(variant?.tags)
  const tones = normalizeList(variant?.tones)
  const searchableToneTags = tags.length ? tags : tones
  const meanings = normalizeList(variant?.meanings)

  return {
    variant,
    size: sizeDistance(variant, footprint),
    tone: query.tone && searchableToneTags.includes(query.tone) ? 1 : 0,
    meaning: query.meaning && meanings.includes(query.meaning) ? 1 : 0,
  }
}

/**
 * @param {DecorScore} a
 * @param {DecorScore} b
 */
function compareScores(a, b) {
  return a.size - b.size || b.tone - a.tone || b.meaning - a.meaning
}

/**
 * @param {DecorScore} left
 * @param {DecorScore} right
 */
function sameScore(left, right) {
  return left.size === right.size
    && left.tone === right.tone
    && left.meaning === right.meaning
}

/**
 * @param {unknown} value
 */
function hashSeed(value) {
  const normalized = String(value ?? '')
  let hash = 2166136261

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

/**
 * @param {DecorScore[]} candidates
 * @param {unknown} seed
 */
function selectCandidate(candidates, seed) {
  const finiteCandidates = candidates.filter(candidate => Number.isFinite(candidate.size))
  const pool = finiteCandidates.length ? finiteCandidates : candidates
  /** @type {DecorScore | null} */
  let best = null
  /** @type {DecorScore[]} */
  let ties = []

  for (const candidate of pool) {
    if (!best || compareScores(candidate, best) < 0) {
      best = candidate
      ties = [candidate]
      continue
    }

    if (sameScore(candidate, best))
      ties.push(candidate)
  }

  if (!best)
    return null

  return ties[hashSeed(seed) % ties.length].variant
}

/**
 * @param {DecorCatalogVariant} variant
 * @param {Partial<import('./image-config.mjs').ImageDataInput>} overrides
 * @param {string} label
 */
function normalizeVariantImage(variant, overrides, label) {
  return normalizeImageData(
    {
      src: variant.src,
      ...(isPlainObject(variant.image) ? variant.image : {}),
      ...overrides,
    },
    {},
    label,
  )
}

/**
 * @param {DecorFootprint | undefined} footprint
 */
function formatFootprint(footprint) {
  const label = footprint?.label ?? 'unknown'
  const cols = Number(footprint?.cols)
  const rows = Number(footprint?.rows)
  const dimensions = Number.isFinite(cols) && Number.isFinite(rows) ? `${cols}x${rows}` : 'unknown size'

  return `${label} (${dimensions})`
}

/**
 * @param {DecorQuery} query
 * @param {DecorResolveOptions} options
 * @param {DecorCatalogVariant} selected
 */
function warnFallback(query, options, selected) {
  const warn = typeof options.warn === 'function' ? options.warn : null

  if (!warn)
    return

  const label = options.label ?? 'decor'
  const parts = [query.meaning, query.tone].filter(Boolean).join(', ') || 'no semantic query'
  const selectedId = typeof selected?.id === 'string' ? selected.id : 'unknown'

  warn(`[${label}] using fallback decor "${selectedId}" for ${parts} in ${formatFootprint(options.footprint)}.`)
}

/**
 * @param {string} id
 * @param {DecorResolveOptions} options
 */
function warnMissingPinnedId(id, options) {
  const warn = typeof options.warn === 'function' ? options.warn : null

  if (!warn)
    return

  const label = options.label ?? 'decor'

  warn(`[${label}] missing pinned decor id "${id}" in ${formatFootprint(options.footprint)}; using fallback decor.`)
}

/**
 * @param {readonly object[]} [baseCatalog]
 * @param {readonly object[]} [extensionCatalog]
 * @returns {DecorCatalogVariant[]}
 */
export function mergeDecorCatalogs(baseCatalog = [], extensionCatalog = []) {
  /** @type {Map<string, DecorCatalogVariant>} */
  const variantsById = new Map()

  for (const variant of [...baseCatalog, ...extensionCatalog]) {
    if (!isPlainObject(variant) || typeof variant.id !== 'string' || !variant.id.trim())
      continue

    const id = variant.id.trim()
    variantsById.set(id, normalizeCatalogVariant(variant, id))
  }

  return [...variantsById.values()]
}

/**
 * @param {readonly object[]} [baseCatalog]
 * @param {readonly object[]} [extensionCatalog]
 * @returns {NormalizedDecorCatalog}
 */
export function normalizeDecorCatalog(baseCatalog = [], extensionCatalog = []) {
  const variants = Object.freeze(mergeDecorCatalogs(baseCatalog, extensionCatalog))

  return Object.freeze({
    variants,
    byId: new Map(variants.filter(item => item.id).map(item => [item.id, item])),
  })
}

/**
 * @param {unknown} value
 * @returns {value is NormalizedDecorCatalog}
 */
function isNormalizedDecorCatalog(value) {
  return isPlainObject(value)
    && Array.isArray(value.variants)
    && value.byId instanceof Map
}

/**
 * @param {DecorResolveOptions} options
 * @returns {NormalizedDecorCatalog}
 */
function resolveCatalog(options) {
  const baseCatalog = isNormalizedDecorCatalog(options.catalog)
    ? options.catalog
    : normalizeDecorCatalog(Array.isArray(options.catalog) ? options.catalog : [])

  if (!Array.isArray(options.themeDecors) || options.themeDecors.length === 0)
    return baseCatalog

  return normalizeDecorCatalog([...baseCatalog.variants], options.themeDecors)
}

export const DEFAULT_DECOR_CATALOG = normalizeDecorCatalog(DEFAULT_DECOR_DATA)

/**
 * @param {unknown} input
 * @param {DecorResolveOptions} [options]
 * @returns {import('./image-config.mjs').NormalizedImageData | null}
 */
export function resolveDecorImage(input, options = {}) {
  const label = options.label ?? 'decor'

  if (!isPlainObject(input))
    throw new Error(`[${label}] decor must be a plain object.`)

  if (!hasDecorInput(input))
    return null

  if (Object.prototype.hasOwnProperty.call(input, 'src')) {
    return normalizeImageData(
      /** @type {import('./image-config.mjs').ImageDataInput} */ (input),
      {},
      label,
    )
  }

  const catalog = resolveCatalog(options)
  const overrides = pickImageDataFields(input)

  if (typeof input.id === 'string' && input.id.trim()) {
    const id = input.id.trim()
    const variant = catalog.byId.get(id)

    if (variant)
      return normalizeVariantImage(variant, overrides, label)

    warnMissingPinnedId(id, options)
  }

  if (catalog.variants.length === 0)
    throw new Error(`[${label}] decor catalog is empty.`)

  const query = {
    meaning: typeof input.meaning === 'string' ? input.meaning.trim() : '',
    tone: typeof input.tone === 'string' ? input.tone.trim() : '',
  }
  const candidates = catalog.variants.map(variant => scoreVariant(variant, query, options.footprint))
  const hasSemanticQuery = Boolean(query.meaning || query.tone)
  const hasMeaningMatch = Boolean(query.meaning) && candidates.some(candidate => candidate.meaning)
  const hasToneMatch = Boolean(query.tone) && candidates.some(candidate => candidate.tone)
  const hasSemanticMatch = hasMeaningMatch || hasToneMatch
  const selectableCandidates = hasSemanticQuery && hasSemanticMatch
    ? candidates.filter(candidate => hasMeaningMatch ? candidate.meaning : candidate.tone)
    : candidates
  const selected = selectCandidate(selectableCandidates, options.seed)

  if (!selected)
    throw new Error(`[${label}] decor catalog is empty.`)

  if (hasSemanticQuery && !hasSemanticMatch)
    warnFallback(query, options, selected)

  return normalizeVariantImage(selected, overrides, label)
}
