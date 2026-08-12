/**
 * @typedef {'cover' | 'contain' | 'fill' | 'none' | 'scale-down'} ImageFit
 */

/**
 * @typedef {{
 *   src: string
 *   fit?: ImageFit
 *   position?: string
 *   anchor?: string
 *   x?: number | string
 *   y?: number | string
 *   zoom?: number | string
 *   rotate?: number | string
 *   color?: string
 *   opacity?: number | string
 *   backgroundColor?: string
 *   'background-color'?: string
 * }} ImageDataInput
 */

/**
 * @typedef {{
 *   src: string
 *   fit: ImageFit
 *   position: string
 *   anchor: string
 *   x: string
 *   y: string
 *   zoom: number
 *   rotate: string
 *   color: string
 *   opacity: number
 *   backgroundColor: string
 * }} NormalizedImageData
 */

/**
 * @typedef {{
 *   src: string
 *   alt?: string
 *   fit?: ImageFit
 *   position?: string
 *   anchor?: string
 *   x?: number | string
 *   y?: number | string
 *   zoom?: number | string
 *   rotate?: number | string
 *   color?: string
 *   opacity?: number | string
 *   backgroundColor?: string
 *   'background-color'?: string
 * }} ImageConfigInput
 */

/**
 * @typedef {NormalizedImageData & { alt: string }} NormalizedImageConfig
 */

const IMAGE_FITS = new Set(['cover', 'contain', 'fill', 'none', 'scale-down'])
const IMAGE_MASK_SIZE_BY_FIT = Object.freeze({
  'cover': 'cover',
  'contain': 'contain',
  'fill': '100% 100%',
  'none': 'auto',
  'scale-down': 'contain',
})

const DEFAULT_IMAGE_CONFIG = Object.freeze({
  alt: '',
  fit: 'cover',
  position: 'center',
})

const DEFAULT_IMAGE_DATA = Object.freeze({
  fit: 'cover',
  position: 'center',
  anchor: '',
  x: 0,
  y: 0,
  zoom: 1,
  rotate: 0,
  color: '',
  opacity: 1,
  backgroundColor: '',
})

export const IMAGE_DATA_FIELDS = Object.freeze([
  'fit',
  'position',
  'anchor',
  'x',
  'y',
  'zoom',
  'rotate',
  'color',
  'opacity',
  'backgroundColor',
])

export const IMAGE_SOURCE_FIELDS = Object.freeze([
  'src',
  ...IMAGE_DATA_FIELDS,
])

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * @param {unknown} input
 * @returns {Partial<ImageDataInput>}
 */
export function pickImageDataFields(input) {
  if (!isPlainObject(input))
    return {}

  const fields = new Set(IMAGE_DATA_FIELDS)
  return Object.fromEntries(
    Object.entries(input)
      .flatMap(([key, value]) => {
        if (value === undefined)
          return []

        if (fields.has(key))
          return [[key, value]]

        if (key === 'background-color')
          return [['backgroundColor', value]]

        return []
      }),
  )
}

/**
 * @param {unknown} value
 * @returns {value is ImageFit}
 */
export function isImageFit(value) {
  return typeof value === 'string' && IMAGE_FITS.has(value)
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeImagePosition(value) {
  if (typeof value !== 'string')
    return DEFAULT_IMAGE_CONFIG.position

  const normalized = value.trim().replace(/\s+/g, ' ')

  return normalized || DEFAULT_IMAGE_CONFIG.position
}

/**
 * @param {string} position
 * @returns {string}
 */
export function normalizeImageTransformOrigin(position) {
  const normalized = normalizeImagePosition(position)
  const tokens = normalized.split(' ')

  if (tokens.length === 1) {
    if (tokens[0] === 'top' || tokens[0] === 'bottom')
      return `center ${tokens[0]}`

    return `${tokens[0]} center`
  }

  if (tokens.length === 2)
    return normalized

  return 'center'
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSvgImageSource(value) {
  if (typeof value !== 'string')
    return false

  const normalized = value.trim().split(/[?#]/u, 1)[0]?.toLowerCase() ?? ''
  return normalized.endsWith('.svg')
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {ImageFit}
 */
function normalizeImageFit(value, label) {
  const normalized = typeof value === 'string' && value.trim()
    ? value.trim()
    : DEFAULT_IMAGE_CONFIG.fit

  if (!isImageFit(normalized))
    throw new Error(`[${label}] image fit "${String(value)}" is not supported.`)

  return normalized
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function resolveImageMaskSize(value) {
  const fit = normalizeImageFit(value, 'image.fit')
  return IMAGE_MASK_SIZE_BY_FIT[fit]
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function normalizeImageZoom(value, label) {
  if (value === undefined || value === null || value === '')
    return DEFAULT_IMAGE_DATA.zoom

  const normalized = Number(value)

  if (!Number.isFinite(normalized) || normalized <= 0)
    throw new Error(`[${label}] image zoom must be a positive number.`)

  return normalized
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function normalizeImageRotate(value, label) {
  if (value === undefined || value === null || value === '')
    return '0deg'

  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error(`[${label}] image rotate must be a finite number or CSS angle.`)

    return `${value}deg`
  }

  if (typeof value !== 'string')
    throw new Error(`[${label}] image rotate must be a finite number or CSS angle.`)

  const normalized = value.trim()
  if (!normalized)
    return '0deg'

  return /^[-+]?(?:\d+|\d*\.\d+)$/.test(normalized) ? `${normalized}deg` : normalized
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function normalizeImageOffset(value, label) {
  if (value === undefined || value === null || value === '')
    return '0px'

  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error(`[${label}] image offset must be a finite number or CSS length.`)

    return `${value}px`
  }

  if (typeof value !== 'string')
    throw new Error(`[${label}] image offset must be a finite number or CSS length.`)

  const normalized = value.trim()
  return normalized || '0px'
}

/**
 * @param {unknown} value
 * @param {string} position
 */
function normalizeImageAnchor(value, position) {
  if (typeof value !== 'string')
    return normalizeImageTransformOrigin(position)

  const normalized = value.trim().replace(/\s+/g, ' ')
  return normalized || normalizeImageTransformOrigin(position)
}

/**
 * @param {unknown} value
 */
function normalizeImageColor(value) {
  if (typeof value !== 'string')
    return DEFAULT_IMAGE_DATA.color

  return value.trim()
}

/**
 * @param {unknown} value
 */
function normalizeImageBackgroundColor(value) {
  if (typeof value !== 'string')
    return DEFAULT_IMAGE_DATA.backgroundColor

  return value.trim()
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function normalizeImageOpacity(value, label) {
  if (value === undefined || value === null || value === '')
    return DEFAULT_IMAGE_DATA.opacity

  const normalized = Number(value)

  if (!Number.isFinite(normalized) || normalized < 0 || normalized > 1)
    throw new Error(`[${label}] image opacity must be a number between 0 and 1.`)

  return normalized
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function normalizeImageSource(value, label) {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`[${label}] image src must be a non-empty string.`)

  return value.trim()
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function assertNoLegacyScale(value, label) {
  if (!isPlainObject(value))
    return

  if (Object.prototype.hasOwnProperty.call(value, 'scale'))
    throw new Error(`[${label}] image scale is no longer supported; use zoom instead.`)
}

/**
 * @param {string} input
 * @param {string} label
 * @returns {{ src: string } | null}
 */
function parseImageString(input, label) {
  const normalized = input.trim()

  if (!normalized)
    return null

  const tokens = normalized.split(/\s+/)

  if (tokens.length > 1 && isImageFit(tokens[1])) {
    throw new Error(
      `[${label}] image shorthand is no longer supported. Use object syntax with src, fit, position, anchor, x, y, zoom, rotate, and backgroundColor.`,
    )
  }

  return { src: normalized }
}

/**
 * @param {ImageDataInput} input
 * @param {Partial<NormalizedImageData>} [defaults]
 * @param {string} [label]
 * @returns {NormalizedImageData}
 */
export function normalizeImageData(input, defaults = {}, label = 'image') {
  if (!isPlainObject(input))
    throw new Error(`[${label}] image data must be a plain object.`)

  assertNoLegacyScale(defaults, label)
  assertNoLegacyScale(input, label)

  const merged = {
    ...DEFAULT_IMAGE_DATA,
    ...defaults,
    ...input,
  }

  const position = normalizeImagePosition(merged.position)
  const zoom = normalizeImageZoom(merged.zoom, label)
  const rotate = normalizeImageRotate(merged.rotate, label)
  const backgroundColor = normalizeImageBackgroundColor(
    Object.prototype.hasOwnProperty.call(merged, 'background-color')
      ? merged['background-color']
      : merged.backgroundColor,
  )

  return {
    src: normalizeImageSource(merged.src, label),
    fit: normalizeImageFit(merged.fit, label),
    position,
    anchor: normalizeImageAnchor(merged.anchor, position),
    x: normalizeImageOffset(merged.x, label),
    y: normalizeImageOffset(merged.y, label),
    zoom,
    rotate,
    color: normalizeImageColor(merged.color),
    opacity: normalizeImageOpacity(merged.opacity, label),
    backgroundColor,
  }
}

/**
 * @param {string | ImageDataInput | Array<string | ImageDataInput> | null | undefined} input
 * @param {Partial<NormalizedImageData>} [defaults]
 * @param {string} [label]
 * @returns {NormalizedImageData[]}
 */
export function parseImageBackgrounds(input, defaults = {}, label = 'image') {
  if (input === undefined || input === null || input === '')
    return []

  const items = Array.isArray(input) ? input : [input]

  return items.flatMap((item, index) => {
    if (item === undefined || item === null || item === '')
      return []

    let raw

    if (typeof item === 'string')
      raw = parseImageString(item, `${label}[${index}]`)
    else if (isPlainObject(item))
      raw = item
    else
      throw new Error(`[${label}[${index}]] image background must be a string or plain object.`)

    if (!raw)
      return []

    return [normalizeImageData(raw, defaults, `${label}[${index}]`)]
  })
}

/**
 * @param {string | ImageConfigInput | null | undefined} input
 * @param {Partial<NormalizedImageConfig>} [defaults]
 * @param {string} [label]
 * @returns {NormalizedImageConfig | null}
 */
export function parseImageConfig(input, defaults = {}, label = 'image') {
  if (input === undefined || input === null || input === '')
    return null

  let raw

  if (typeof input === 'string')
    raw = parseImageString(input, label)
  else if (isPlainObject(input))
    raw = input
  else
    throw new Error(`[${label}] image config must be a string or plain object.`)

  if (!raw)
    return null

  const imageData = normalizeImageData(raw, defaults, label)
  const merged = {
    ...DEFAULT_IMAGE_CONFIG,
    ...defaults,
    ...raw,
  }

  return {
    ...imageData,
    src: imageData.src,
    alt: typeof merged.alt === 'string' ? merged.alt : DEFAULT_IMAGE_CONFIG.alt,
  }
}
