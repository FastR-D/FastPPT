import { writeFile } from 'node:fs/promises'
import type { DecorStore, DecorVariant } from './decor-store'

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

const STRING_LIST_FIELDS = new Set(['meanings', 'tones', 'tags'])
const IMAGE_FIT_VALUES = new Set(['cover', 'contain', 'fill', 'none', 'scale-down'])
const IMAGE_FIELD_VALIDATORS: Record<string, (value: unknown) => boolean> = {
  fit: value => typeof value === 'string' && IMAGE_FIT_VALUES.has(value),
  position: value => typeof value === 'string',
  anchor: value => typeof value === 'string',
  x: isFiniteNumberOrString,
  y: isFiniteNumberOrString,
  zoom: isFiniteNumberOrString,
  rotate: isFiniteNumberOrString,
  color: value => typeof value === 'string',
  opacity: isFiniteNumberOrString,
  backgroundColor: value => typeof value === 'string',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumberOrString(value: unknown) {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
}

function sanitizeStringList(value: unknown) {
  if (!Array.isArray(value))
    return []

  return value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim())
}

function sanitizeRange(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 12)
    return value

  if (!Array.isArray(value) || value.length !== 2)
    return null

  const [from, to] = value
  if (!Number.isInteger(from) || !Number.isInteger(to))
    return null

  if (from < 1 || to > 12 || from > to)
    return null

  return from === to ? from : [from, to]
}

function sanitizeRatioRange(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0)
    return Number(value.toFixed(2))

  if (!Array.isArray(value) || value.length !== 2)
    return null

  const [from, to] = value.map(Number)
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= 0)
    return null

  const min = Number(Math.min(from, to).toFixed(2))
  const max = Number(Math.max(from, to).toFixed(2))

  return min === max ? min : [min, max]
}

function sanitizeSizes(value: unknown) {
  if (!Array.isArray(value))
    return []

  return value.flatMap((item) => {
    if (!isRecord(item))
      return []

    const cols = sanitizeRange(item.cols)
    const rows = sanitizeRange(item.rows)
    const ratio = sanitizeRatioRange(item.ratio ?? item.aspectRatio)

    if (!cols || !rows)
      return []

    return ratio ? [{ cols, rows, ratio }] : [{ cols, rows }]
  })
}

function sanitizeImage(value: unknown) {
  if (!isRecord(value))
    return {}

  return Object.fromEntries(
    Object.entries(value).filter(([key, item]) => {
      return IMAGE_FIELD_VALIDATORS[key]?.(item) ?? false
    }),
  )
}

function sanitizeVariant(value: unknown) {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.src !== 'string')
    return null

  const variant: Record<string, JsonValue> = {
    id: value.id.trim(),
    src: value.src.trim(),
  }

  if (!variant.id || !variant.src)
    return null

  for (const key of STRING_LIST_FIELDS) {
    const list = sanitizeStringList(value[key])
    if (list.length)
      variant[key] = list
  }

  const sizes = sanitizeSizes(value.sizes)
  if (sizes.length)
    variant.sizes = sizes

  const image = sanitizeImage(value.image)
  if (Object.keys(image).length)
    variant.image = image as Record<string, JsonValue>

  return variant as DecorVariant
}

function sanitizeVariants(overrides: readonly DecorVariant[]) {
  return overrides.flatMap((item) => {
    const variant = sanitizeVariant(item)
    return variant ? [variant] : []
  })
}

function quoteString(value: string) {
  return `'${value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '\\\'')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')}'`
}

function serializeValue(value: JsonValue, depth = 0): string {
  const indent = ' '.repeat(depth)
  const nestedIndent = ' '.repeat(depth + 2)

  if (typeof value === 'string')
    return quoteString(value)

  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)

  if (value === null)
    return 'null'

  if (Array.isArray(value)) {
    if (!value.length)
      return '[]'

    return `[\n${nestedIndent}${value.map(item => serializeValue(item, depth + 2)).join(`,\n${nestedIndent}`)},\n${indent}]`
  }

  const entries = Object.entries(value)
  if (!entries.length)
    return '{}'

  return `{\n${nestedIndent}${entries
    .map(([key, item]) => `${key}: ${serializeValue(item, depth + 2)}`)
    .join(`,\n${nestedIndent}`)},\n${indent}}`
}

function createOverridesModule(overrides: readonly DecorVariant[]) {
  const sanitized = sanitizeVariants(overrides)

  return {
    count: sanitized.length,
    source: `/** @type {readonly Record<string, unknown>[]} */\nexport const DECOR_TUNING_OVERRIDES = Object.freeze(${serializeValue(sanitized as unknown as JsonValue)})\n`,
  }
}

export function createFileDecorStore(input: { output: string }): DecorStore {
  return {
    async save(overrides) {
      const module = createOverridesModule(overrides)

      await writeFile(input.output, module.source, 'utf8')

      return { ok: true, count: module.count }
    },
  }
}
